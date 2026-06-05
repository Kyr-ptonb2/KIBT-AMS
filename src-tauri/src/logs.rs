// logs.rs — Audit log system.
// Every significant action in the system writes a log entry.
// Logs are append-only — they cannot be edited or deleted by anyone.

use crate::auth::AuthState;
use crate::db::{open, AppDataDir};
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ── Schema ────────────────────────────────────────────────────────────────────

pub const LOGS_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT,                   -- user ID (NULL for system events)
    actor_name  TEXT,                   -- username at time of action
    action      TEXT NOT NULL,          -- e.g. "event.create", "scan.gemini"
    category    TEXT NOT NULL,          -- "auth" | "event" | "participant" | "scan" | "user" | "export" | "config"
    target_id   TEXT,                   -- ID of the affected record (if any)
    target_name TEXT,                   -- Human-readable target description
    detail      TEXT,                   -- Extra JSON or text context
    ip_note     TEXT,                   -- "local" always for desktop app
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_occurred_at ON audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_actor_id    ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_logs_category    ON audit_logs(category);
"#;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    pub id: String,
    pub actor_id: Option<String>,
    pub actor_name: Option<String>,
    pub action: String,
    pub category: String,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub detail: Option<String>,
    pub occurred_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilter {
    pub category: Option<String>,
    pub actor_id: Option<String>,
    pub action: Option<String>,
    pub from_date: Option<String>,   // YYYY-MM-DD
    pub to_date: Option<String>,     // YYYY-MM-DD
    pub limit: Option<u32>,
}

// ── Core write function ───────────────────────────────────────────────────────

/// Write an audit log entry. Called from all command handlers.
/// Fails silently — a logging error must never break a real operation.
pub fn write_log(
    app_data_dir: &std::path::Path,
    actor_id: Option<&str>,
    actor_name: Option<&str>,
    action: &str,
    category: &str,
    target_id: Option<&str>,
    target_name: Option<&str>,
    detail: Option<&str>,
) {
    let Ok(conn) = open(app_data_dir) else { return };
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = conn.execute(
        r#"INSERT INTO audit_logs
           (id, actor_id, actor_name, action, category, target_id, target_name, detail, ip_note, occurred_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'local',?9)"#,
        params![id, actor_id, actor_name, action, category, target_id, target_name, detail, now],
    );
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Get audit logs with optional filters. Admin+ only.
#[tauri::command]
pub fn get_logs(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    filter: LogFilter,
) -> Result<Vec<AuditLog>, String> {
    crate::auth::require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let limit = filter.limit.unwrap_or(500).min(2000);

    let mut sql = String::from(
        r#"SELECT id, actor_id, actor_name, action, category,
                  target_id, target_name, detail, occurred_at
           FROM audit_logs WHERE 1=1"#,
    );
    let mut bind: Vec<String> = Vec::new();

    if let Some(ref v) = filter.category {
        sql.push_str(" AND category = ?"); bind.push(v.clone());
    }
    if let Some(ref v) = filter.actor_id {
        sql.push_str(" AND actor_id = ?"); bind.push(v.clone());
    }
    if let Some(ref v) = filter.action {
        sql.push_str(" AND action LIKE ?"); bind.push(format!("%{}%", v));
    }
    if let Some(ref v) = filter.from_date {
        sql.push_str(" AND occurred_at >= ?"); bind.push(format!("{}T00:00:00Z", v));
    }
    if let Some(ref v) = filter.to_date {
        sql.push_str(" AND occurred_at <= ?"); bind.push(format!("{}T23:59:59Z", v));
    }

    sql.push_str(&format!(" ORDER BY occurred_at DESC LIMIT {}", limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let logs = stmt.query_map(
        rusqlite::params_from_iter(bind.iter()),
        |r| Ok(AuditLog {
            id:          r.get(0)?,
            actor_id:    r.get(1)?,
            actor_name:  r.get(2)?,
            action:      r.get(3)?,
            category:    r.get(4)?,
            target_id:   r.get(5)?,
            target_name: r.get(6)?,
            detail:      r.get(7)?,
            occurred_at: r.get(8)?,
        }),
    ).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(logs)
}

/// Return a summary count grouped by category for the last 30 days.
#[tauri::command]
pub fn get_log_summary(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
) -> Result<Vec<(String, i64)>, String> {
    crate::auth::require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();

    let mut stmt = conn.prepare(
        "SELECT category, COUNT(*) FROM audit_logs WHERE occurred_at >= ?1 GROUP BY category ORDER BY COUNT(*) DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![cutoff], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
