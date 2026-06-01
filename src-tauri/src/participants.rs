// participants.rs — Participant CRUD with flexible column support + audit logging.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String, pub event_id: String, pub name: String,
    pub business_type: Option<String>, pub age_category: Option<String>,
    pub gender: Option<String>, pub phone: Option<String>,
    pub consent: Option<String>, pub location: Option<String>,
    pub extra_fields: Option<String>, pub added_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantInput {
    pub name: String, pub business_type: Option<String>,
    pub age_category: Option<String>, pub gender: Option<String>,
    pub phone: Option<String>, pub consent: Option<String>,
    pub location: Option<String>, pub extra_fields: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantFilter {
    pub event_id: Option<String>, pub financial_year: Option<String>,
    pub region: Option<String>, pub gender: Option<String>,
    pub age_category: Option<String>, pub consent: Option<String>,
    pub query: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn session_actor(auth: &State<'_, AuthState>) -> (Option<String>, Option<String>) {
    match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_participants(
    state: State<'_, AppDataDir>,
    filter: ParticipantFilter,
) -> Result<Vec<Participant>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let mut sql = String::from(r#"
        SELECT p.id, p.event_id, p.name, p.business_type, p.age_category,
               p.gender, p.phone, p.consent, p.location, p.extra_fields, p.added_at
        FROM participants p
        JOIN events e ON e.id = p.event_id
        WHERE 1=1
    "#);
    let mut bind: Vec<String> = Vec::new();

    if let Some(ref v) = filter.event_id       { sql.push_str(" AND p.event_id = ?");        bind.push(v.clone()); }
    if let Some(ref v) = filter.financial_year  { sql.push_str(" AND e.financial_year = ?"); bind.push(v.clone()); }
    if let Some(ref v) = filter.region          { sql.push_str(" AND e.region = ?");         bind.push(v.clone()); }
    if let Some(ref v) = filter.gender          { sql.push_str(" AND p.gender = ?");         bind.push(v.clone()); }
    if let Some(ref v) = filter.age_category    { sql.push_str(" AND p.age_category = ?");   bind.push(v.clone()); }
    if let Some(ref v) = filter.consent         { sql.push_str(" AND p.consent = ?");        bind.push(v.clone()); }
    if let Some(ref v) = filter.query {
        sql.push_str(" AND (p.name LIKE ? OR p.phone LIKE ? OR p.location LIKE ?)");
        let p = format!("%{}%", v);
        bind.push(p.clone()); bind.push(p.clone()); bind.push(p);
    }
    sql.push_str(" ORDER BY p.added_at DESC");

    let limit = filter.limit.unwrap_or(500).min(5000);
    let offset = filter.offset.unwrap_or(0).max(0);
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(bind.iter()), |row| {
            Ok(Participant {
                id: row.get(0)?, event_id: row.get(1)?, name: row.get(2)?,
                business_type: row.get(3)?, age_category: row.get(4)?,
                gender: row.get(5)?, phone: row.get(6)?, consent: row.get(7)?,
                location: row.get(8)?, extra_fields: row.get(9)?, added_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn save_participants(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    event_id: String,
    rows: Vec<ParticipantInput>,
) -> Result<usize, String> {
    let mut conn = open(&state.0).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut saved = 0usize;

    for row in &rows {
        if row.name.trim().is_empty() { continue; }
        let id = Uuid::new_v4().to_string();
        tx.execute(
            r#"INSERT INTO participants
               (id, event_id, name, business_type, age_category, gender, phone,
                consent, location, extra_fields, added_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
            params![id, event_id, row.name.trim(), row.business_type, row.age_category,
                    row.gender, row.phone, row.consent, row.location, row.extra_fields, now],
        ).map_err(|e| e.to_string())?;
        saved += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = session_actor(&auth);
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "participant.save_batch", "participant", Some(&event_id),
        Some(&format!("{} participants saved", saved)), None);

    Ok(saved)
}

#[tauri::command]
pub fn update_participant(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    participant_id: String,
    input: ParticipantInput,
) -> Result<bool, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute(
        r#"UPDATE participants SET name=?1, business_type=?2, age_category=?3,
           gender=?4, phone=?5, consent=?6, location=?7, extra_fields=?8
           WHERE id=?9"#,
        params![input.name.trim(), input.business_type, input.age_category,
                input.gender, input.phone, input.consent, input.location,
                input.extra_fields, participant_id],
    ).map_err(|e| e.to_string())?;

    if rows > 0 {
        let (actor_id, actor_name) = session_actor(&auth);
        write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
            "participant.update", "participant",
            Some(&participant_id), Some(input.name.trim()), None);
    }
    Ok(rows > 0)
}

#[tauri::command]
pub fn delete_participant(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    participant_id: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // Fetch name before deleting for the log
    let name: Option<String> = conn.query_row(
        "SELECT name FROM participants WHERE id=?1", params![participant_id], |r| r.get(0)
    ).ok();

    let rows = conn.execute("DELETE FROM participants WHERE id=?1", params![participant_id])
        .map_err(|e| e.to_string())?;

    if rows > 0 {
        let (actor_id, actor_name) = session_actor(&auth);
        write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
            "participant.delete", "participant",
            Some(&participant_id), name.as_deref(), None);
    }
    Ok(rows > 0)
}

// ── Bulk import from CSV/Excel parse result ───────────────────────────────────

/// Import participants from a pre-parsed list (frontend parses the CSV/Excel file,
/// sends rows as ParticipantInput array with source="import").
#[tauri::command]
pub fn import_participants(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    event_id: String,
    session_id: Option<String>,
    rows: Vec<ParticipantInput>,
) -> Result<usize, String> {
    let mut conn = open(&state.0).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut saved = 0usize;

    for row in &rows {
        if row.name.trim().is_empty() { continue; }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            r#"INSERT INTO participants
               (id, event_id, session_id, name, business_type, age_category, gender, phone,
                consent, location, extra_fields, source, added_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'import',?12)"#,
            params![
                id, event_id, session_id, row.name.trim(),
                row.business_type, row.age_category, row.gender, row.phone,
                row.consent, row.location, row.extra_fields, now
            ],
        ).map_err(|e| e.to_string())?;
        saved += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = session_actor(&auth);
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "participant.import", "participant", Some(&event_id),
        Some(&format!("{} participants imported", saved)), None);

    Ok(saved)
}
