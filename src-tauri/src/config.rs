// config.rs — Application settings, OS keychain API key storage, backup/restore.

use crate::auth::{AuthState, require_admin};
use crate::db::{db_path, open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use keyring::Entry;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

const KEYRING_SERVICE: &str = "kibt-ams";
const KEYRING_USER: &str = "gemini-api-key";

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Gemini API key (loaded from OS keychain, NOT from database).
    pub gemini_api_key: Option<String>,
    pub default_region: Option<String>,
    pub auto_update: bool,
    pub database_path: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Return current application configuration.
/// Reads the Gemini API key from the OS keychain.
#[tauri::command]
pub fn get_config(state: State<'_, AppDataDir>) -> Result<AppConfig, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let default_region = get_setting(&conn, "default_region");
    let auto_update: bool = get_setting(&conn, "auto_update")
        .map(|v| v == "true")
        .unwrap_or(true);

    let gemini_api_key = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.get_password())
        .ok();

    let db_path_str = db_path(&state.0).to_string_lossy().to_string();

    Ok(AppConfig {
        gemini_api_key,
        default_region,
        auto_update,
        database_path: Some(db_path_str),
    })
}

/// Save application configuration.
/// Stores the Gemini API key in the OS keychain; everything else in the database.
#[tauri::command]
pub fn save_config(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    config: AppConfig,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // Store API key in OS keychain
    if let Some(ref key) = config.gemini_api_key {
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        if key.is_empty() {
            let _ = entry.delete_password(); // clear the key
        } else {
            entry.set_password(key).map_err(|e| e.to_string())?;
        }
    }

    // Store other settings in the database
    if let Some(ref r) = config.default_region {
        set_setting(&conn, "default_region", r).map_err(|e| e.to_string())?;
    }
    set_setting(
        &conn,
        "auto_update",
        if config.auto_update { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;

    write_log(&state.0, None, None, "config.save", "config", None, None, None);
    Ok(true)
}

/// Copy the database file to a user-chosen destination. Returns true on success.
#[tauri::command]
pub fn backup_database(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    destination_path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let src = db_path(&state.0);
    std::fs::copy(&src, &destination_path).map_err(|e| e.to_string())?;
    write_log(&state.0, None, None, "config.backup", "config", None,
        Some(&destination_path), None);
    Ok(true)
}

/// Replace the database file with a backup. App must restart to fully apply.
#[tauri::command]
pub fn restore_database(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    source_path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let dest = db_path(&state.0);
    // Validate that the source is a valid SQLite file before overwriting
    let test_conn = rusqlite::Connection::open(&source_path).map_err(|e| e.to_string())?;
    let _: i64 = test_conn
        .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
        .map_err(|_| "Source file is not a valid database".to_string())?;
    drop(test_conn);

    std::fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    write_log(&state.0, None, None, "config.restore", "config", None,
        Some(&source_path), None);
    Ok(true)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_config WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}
