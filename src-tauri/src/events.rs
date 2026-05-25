// events.rs — Event CRUD Tauri commands + audit logging.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub date: String,
    pub region: String,
    pub venue: Option<String>,
    pub financial_year: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub participant_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventInput {
    pub title: String,
    pub date: String,
    pub region: String,
    pub venue: Option<String>,
    pub notes: Option<String>,
}

// ── Kenya FY computation ──────────────────────────────────────────────────────

pub fn financial_year_for_date(date: &NaiveDate) -> String {
    let year = date.year();
    let month = date.month();
    if month >= 7 { format!("{}/{}", year, year + 1) }
    else          { format!("{}/{}", year - 1, year) }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn session_actor(auth: &State<'_, AuthState>) -> (Option<String>, Option<String>) {
    match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_events(
    state: State<'_, AppDataDir>,
    fy: Option<String>,
    region: Option<String>,
) -> Result<Vec<Event>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let mut sql = String::from(r#"
        SELECT e.id, e.title, e.date, e.region, e.venue,
               e.financial_year, e.notes, e.created_at,
               COUNT(p.id) AS participant_count
        FROM events e
        LEFT JOIN participants p ON p.event_id = e.id
        WHERE 1=1
    "#);
    let mut bind_vals: Vec<String> = Vec::new();

    if let Some(ref f) = fy    { sql.push_str(" AND e.financial_year = ?"); bind_vals.push(f.clone()); }
    if let Some(ref r) = region { sql.push_str(" AND e.region = ?");        bind_vals.push(r.clone()); }
    sql.push_str(" GROUP BY e.id ORDER BY e.date DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let events = stmt
        .query_map(rusqlite::params_from_iter(bind_vals.iter()), |row| {
            Ok(Event {
                id: row.get(0)?, title: row.get(1)?, date: row.get(2)?,
                region: row.get(3)?, venue: row.get(4)?, financial_year: row.get(5)?,
                notes: row.get(6)?, created_at: row.get(7)?, participant_count: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(events)
}

#[tauri::command]
pub fn create_event(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: CreateEventInput,
) -> Result<Event, String> {
    let date = NaiveDate::parse_from_str(&input.date, "%Y-%m-%d")
        .map_err(|_| "Invalid date format — expected YYYY-MM-DD".to_string())?;

    let fy  = financial_year_for_date(&date);
    let id  = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO events (id, title, date, region, venue, financial_year, notes, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, input.title, input.date, input.region, input.venue, fy, input.notes, now],
    ).map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = session_actor(&auth);
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "event.create", "event", Some(&id),
        Some(&input.title),
        Some(&format!("region={} date={} fy={}", input.region, input.date, fy)));

    Ok(Event {
        id, title: input.title, date: input.date, region: input.region,
        venue: input.venue, financial_year: fy, notes: input.notes,
        created_at: now, participant_count: Some(0),
    })
}

#[tauri::command]
pub fn delete_event(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    event_id: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // Fetch title before deleting for the log
    let title: Option<String> = conn.query_row(
        "SELECT title FROM events WHERE id=?1", params![event_id], |r| r.get(0)
    ).ok();

    let rows = conn.execute("DELETE FROM events WHERE id=?1", params![event_id])
        .map_err(|e| e.to_string())?;

    if rows > 0 {
        let (actor_id, actor_name) = session_actor(&auth);
        write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
            "event.delete", "event", Some(&event_id), title.as_deref(), None);
    }
    Ok(rows > 0)
}

#[tauri::command]
pub fn get_financial_years(state: State<'_, AppDataDir>) -> Result<Vec<String>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT financial_year FROM events ORDER BY financial_year DESC")
        .map_err(|e| e.to_string())?;
    let years = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let current_fy = financial_year_for_date(&chrono::Utc::now().date_naive());
    let mut result = years;
    if !result.contains(&current_fy) { result.insert(0, current_fy); }
    Ok(result)
}
