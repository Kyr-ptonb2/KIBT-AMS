// events.rs — Event + Session CRUD with audit logging.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use chrono::NaiveDate;
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
    pub start_date: String,
    pub end_date: String,
    pub region: String,
    pub venue: Option<String>,
    pub financial_year: String,
    pub event_type: String,    // "in-person" | "online" | "hybrid"
    pub notes: Option<String>,
    pub created_at: String,
    pub participant_count: Option<i64>,
    pub session_count: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EventSession {
    pub id: String,
    pub event_id: String,
    pub session_no: i64,
    pub title: Option<String>,
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub region: Option<String>,
    pub venue: Option<String>,
    pub participant_count: Option<i64>,
    // Topics and facilitators (stored as JSON arrays)
    pub topics: Vec<String>,
    pub facilitators: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventInput {
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    pub region: String,
    pub venue: Option<String>,
    pub event_type: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub event_id: String,
    pub title: Option<String>,
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub region: Option<String>,
    pub venue: Option<String>,
    pub topics: Option<Vec<String>>,
    pub facilitators: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventStats {
    pub participant_count: i64,
    pub scan_count: i64,
    pub session_count: i64,
}

// ── FY helper ─────────────────────────────────────────────────────────────────

pub fn financial_year_for_date(date: &NaiveDate) -> String {
    let year = date.year();
    use chrono::Datelike;
    let month = date.month();
    if month >= 7 { format!("{}/{}", year, year + 1) }
    else          { format!("{}/{}", year - 1, year) }
}

fn session_actor(auth: &State<'_, AuthState>) -> (Option<String>, Option<String>) {
    match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    }
}

// ── Event Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_events(
    state: State<'_, AppDataDir>,
    fy: Option<String>,
    region: Option<String>,
) -> Result<Vec<Event>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let mut sql = String::from(r#"
        SELECT e.id, e.title,
               COALESCE(e.start_date, e.created_at) AS start_date,
               COALESCE(e.end_date,   e.created_at) AS end_date,
               e.region, e.venue, e.financial_year,
               COALESCE(e.event_type, 'in-person')  AS event_type,
               e.notes, e.created_at,
               COUNT(DISTINCT p.id)  AS participant_count,
               COUNT(DISTINCT s.id)  AS session_count
        FROM events e
        LEFT JOIN participants p ON p.event_id = e.id
        LEFT JOIN event_sessions s ON s.event_id = e.id
        WHERE 1=1
    "#);
    let mut bind: Vec<String> = Vec::new();

    if let Some(ref f) = fy {
        sql.push_str(" AND e.financial_year = ?");
        bind.push(f.clone());
    }
    if let Some(ref r) = region {
        sql.push_str(" AND e.region = ?");
        bind.push(r.clone());
    }
    sql.push_str(" GROUP BY e.id ORDER BY start_date DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let events = stmt.query_map(
        rusqlite::params_from_iter(bind.iter()), |row| {
        Ok(Event {
            id: row.get(0)?, title: row.get(1)?,
            start_date: row.get(2)?, end_date: row.get(3)?,
            region: row.get(4)?, venue: row.get(5)?,
            financial_year: row.get(6)?, event_type: row.get(7)?,
            notes: row.get(8)?, created_at: row.get(9)?,
            participant_count: row.get(10)?, session_count: row.get(11)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(events)
}

#[tauri::command]
pub fn create_event(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: CreateEventInput,
) -> Result<Event, String> {
    let start = NaiveDate::parse_from_str(&input.start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date format (YYYY-MM-DD)".to_string())?;
    let end = NaiveDate::parse_from_str(&input.end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date format (YYYY-MM-DD)".to_string())?;
    if end < start {
        return Err("End date cannot be before start date.".to_string());
    }

    let fy  = financial_year_for_date(&start);
    let id  = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let event_type = input.event_type.as_deref().unwrap_or("in-person").to_string();

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    conn.execute(
        r#"INSERT INTO events
           (id, title, start_date, end_date, region, venue, financial_year, event_type, notes, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"#,
        params![id, input.title, input.start_date, input.end_date,
                input.region, input.venue, fy, event_type, input.notes, now],
    ).map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = session_actor(&auth);
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "event.create", "event", Some(&id), Some(&input.title),
        Some(&format!("region={} start={} end={} type={} fy={}",
            input.region, input.start_date, input.end_date, event_type, fy)));

    Ok(Event {
        id, title: input.title, start_date: input.start_date, end_date: input.end_date,
        region: input.region, venue: input.venue, financial_year: fy, event_type,
        notes: input.notes, created_at: now,
        participant_count: Some(0), session_count: Some(0),
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
pub fn get_event_stats(
    state: State<'_, AppDataDir>,
    event_id: String,
) -> Result<EventStats, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let (participant_count, scan_count, session_count): (i64, i64, i64) = conn.query_row(
        r#"SELECT
            (SELECT COUNT(*) FROM participants WHERE event_id = ?1),
            (SELECT COUNT(*) FROM scans WHERE event_id = ?1),
            (SELECT COUNT(*) FROM event_sessions WHERE event_id = ?1)"#,
        params![event_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|e| e.to_string())?;
    Ok(EventStats { participant_count, scan_count, session_count })
}

#[tauri::command]
pub fn get_financial_years(state: State<'_, AppDataDir>) -> Result<Vec<String>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT financial_year FROM events ORDER BY financial_year DESC"
    ).map_err(|e| e.to_string())?;
    let mut years = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    let current_fy = financial_year_for_date(&chrono::Utc::now().date_naive());
    if !years.contains(&current_fy) { years.insert(0, current_fy); }
    Ok(years)
}

// ── Session Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_event_sessions(
    state: State<'_, AppDataDir>,
    event_id: String,
) -> Result<Vec<EventSession>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(r#"
        SELECT s.id, s.event_id, s.session_no, s.title, s.date,
               s.start_time, s.end_time, s.region, s.venue,
               COUNT(p.id) AS participant_count,
               COALESCE(s.topics_json, '[]'), COALESCE(s.facilitators_json, '[]')
        FROM event_sessions s
        LEFT JOIN participants p ON p.session_id = s.id
        WHERE s.event_id = ?1
        GROUP BY s.id
        ORDER BY s.date, s.start_time
    "#).map_err(|e| e.to_string())?;

    let sessions = stmt.query_map(params![event_id], |r| {
        let topics_json: String     = r.get(10).unwrap_or_else(|_| "[]".into());
        let facils_json: String     = r.get(11).unwrap_or_else(|_| "[]".into());
        let topics: Vec<String>     = serde_json::from_str(&topics_json).unwrap_or_default();
        let facilitators: Vec<String> = serde_json::from_str(&facils_json).unwrap_or_default();
        Ok(EventSession {
            id: r.get(0)?, event_id: r.get(1)?, session_no: r.get(2)?,
            title: r.get(3)?, date: r.get(4)?, start_time: r.get(5)?,
            end_time: r.get(6)?, region: r.get(7)?, venue: r.get(8)?,
            participant_count: r.get(9)?,
            topics, facilitators,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(sessions)
}

#[tauri::command]
pub fn create_session(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: CreateSessionInput,
) -> Result<EventSession, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // Auto-number the session
    let next_no: i64 = conn.query_row(
        "SELECT COALESCE(MAX(session_no), 0) + 1 FROM event_sessions WHERE event_id = ?1",
        params![input.event_id], |r| r.get(0),
    ).unwrap_or(1);

    let id  = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let topics_json = serde_json::to_string(&input.topics.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
    let facils_json = serde_json::to_string(&input.facilitators.unwrap_or_default()).unwrap_or_else(|_| "[]".into());

    conn.execute(
        r#"INSERT INTO event_sessions
           (id, event_id, session_no, title, date, start_time, end_time, region, venue,
            topics_json, facilitators_json, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"#,
        params![id, input.event_id, next_no, input.title, input.date,
                input.start_time, input.end_time, input.region, input.venue,
                topics_json, facils_json, now],
    ).map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = session_actor(&auth);
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "session.create", "event", Some(&id),
        Some(&format!("Session {} for event {}", next_no, input.event_id)), None);

    Ok(EventSession {
        id, event_id: input.event_id, session_no: next_no,
        title: input.title, date: input.date, start_time: input.start_time,
        end_time: input.end_time, region: input.region, venue: input.venue,
        participant_count: Some(0),
        topics: serde_json::from_str(&topics_json).unwrap_or_default(),
        facilitators: serde_json::from_str(&facils_json).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn update_session(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    session_id: String,
    title: Option<String>,
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
    region: Option<String>,
    venue: Option<String>,
    topics: Option<Vec<String>>,
    facilitators: Option<Vec<String>>,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let topics_json = serde_json::to_string(&topics.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
    let facils_json = serde_json::to_string(&facilitators.unwrap_or_default()).unwrap_or_else(|_| "[]".into());

    let rows = conn.execute(
        r#"UPDATE event_sessions SET
             title=?1, date=?2, start_time=?3, end_time=?4,
             region=?5, venue=?6, topics_json=?7, facilitators_json=?8
           WHERE id=?9"#,
        params![title, date, start_time, end_time, region, venue,
                topics_json, facils_json, session_id],
    ).map_err(|e| e.to_string())?;

    if rows > 0 {
        let (actor_id, actor_name) = session_actor(&auth);
        write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
            "session.update", "event", Some(&session_id), None, None);
    }
    Ok(rows > 0)
}

#[tauri::command]
pub fn delete_session(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    session_id: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute("DELETE FROM event_sessions WHERE id=?1", params![session_id])
        .map_err(|e| e.to_string())?;
    if rows > 0 {
        let (actor_id, actor_name) = session_actor(&auth);
        write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
            "session.delete", "event", Some(&session_id), None, None);
    }
    Ok(rows > 0)
}
