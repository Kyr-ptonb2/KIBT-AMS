// sync.rs — Offline database sync via portable .kibt file (USB transfer)
//
// EXPORT (PC1):
//   Creates a .kibt file (gzip-compressed JSON) containing all records
//   created/modified since a chosen cutoff date.
//   The file can be copied to any media (USB, SD card, email attachment).
//
// IMPORT (PC2):
//   Reads a .kibt file and merges records into the local database.
//   All inserts use INSERT OR IGNORE — existing UUIDs are skipped.
//   NO data on PC2 is ever deleted or overwritten.
//
// .kibt file format (after gzip decompress):
// {
//   "version": 1,
//   "exported_at": "2026-06-10T08:00:00Z",
//   "exported_by": "goodwin",
//   "source_machine": "PC1-Nakuru",
//   "since": "2026-01-01T00:00:00Z",   // null = full export
//   "events": [...],
//   "event_sessions": [...],
//   "participants": [...],
//   "scans": [...],
//   "custom_table_defs": [...],
//   "custom_table_rows": [...],
// }

use crate::auth::AuthState;
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::State;
use std::io::{Read, Write};

const SYNC_VERSION: u32 = 1;
const FILE_MAGIC: &[u8] = b"KIBT";   // first 4 bytes of every .kibt file

// ── Package types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPackage {
    pub version:         u32,
    pub exported_at:     String,
    pub exported_by:     String,
    pub source_label:    String,   // user-supplied label (e.g. "Nakuru office PC")
    pub since:           Option<String>,  // ISO 8601 cutoff, None = full export
    pub events:          Vec<serde_json::Value>,
    pub event_sessions:  Vec<serde_json::Value>,
    pub participants:    Vec<serde_json::Value>,
    pub scans:           Vec<serde_json::Value>,
    pub custom_table_defs: Vec<serde_json::Value>,
    pub custom_table_rows: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSyncResult {
    pub path:              String,
    pub exported_at:       String,
    pub events:            usize,
    pub event_sessions:    usize,
    pub participants:      usize,
    pub scans:             usize,
    pub custom_table_defs: usize,
    pub custom_table_rows: usize,
    pub file_size_kb:      u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSyncResult {
    pub source_label:      String,
    pub exported_at:       String,
    pub events_inserted:       usize,
    pub event_sessions_inserted: usize,
    pub participants_inserted:   usize,
    pub scans_inserted:          usize,
    pub custom_table_defs_inserted: usize,
    pub custom_table_rows_inserted: usize,
    pub events_skipped:          usize,
    pub participants_skipped:    usize,
    pub errors:                  Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPackageInfo {
    pub version:        u32,
    pub exported_at:    String,
    pub exported_by:    String,
    pub source_label:   String,
    pub since:          Option<String>,
    pub event_count:    usize,
    pub participant_count: usize,
    pub custom_table_count: usize,
    pub custom_row_count:   usize,
    pub file_size_kb:   u64,
}

// ── Export command ─────────────────────────────────────────────────────────────

/// Export records to a .kibt sync file.
/// since_date = None → full export. Some("YYYY-MM-DD") → only newer records.
/// path = destination file path chosen via save dialog on the frontend.
#[tauri::command]
pub fn export_sync_package(
    state:      State<'_, AppDataDir>,
    auth:       State<'_, AuthState>,
    path:       String,
    since_date: Option<String>,
    label:      String,
) -> Result<ExportSyncResult, String> {
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let now      = chrono::Utc::now().to_rfc3339();
    let since_ts = since_date.as_deref().map(|d| format!("{}T00:00:00Z", d));
    let cutoff   = since_ts.as_deref().unwrap_or("1970-01-01T00:00:00Z");

    // ── Read each table ────────────────────────────────────────────────────────
    let events          = dump_table(&conn, "events",
        &format!("SELECT * FROM events WHERE created_at >= '{}'", cutoff)).map_err(|e| e.to_string())?;
    let event_sessions  = dump_table(&conn, "event_sessions",
        &format!("SELECT es.* FROM event_sessions es
                  JOIN events e ON e.id = es.event_id
                  WHERE es.created_at >= '{}' OR e.created_at >= '{}'", cutoff, cutoff)).map_err(|e| e.to_string())?;
    let participants    = dump_table(&conn, "participants",
        &format!("SELECT * FROM participants WHERE added_at >= '{}'", cutoff)).map_err(|e| e.to_string())?;
    let scans           = dump_table(&conn, "scans",
        &format!("SELECT * FROM scans WHERE scanned_at >= '{}'", cutoff)).map_err(|e| e.to_string())?;
    let custom_table_defs = dump_table(&conn, "custom_table_defs",
        &format!("SELECT * FROM custom_table_defs WHERE created_at >= '{}'", cutoff)).map_err(|e| e.to_string())?;
    let custom_table_rows = dump_table(&conn, "custom_table_rows",
        &format!("SELECT ctr.* FROM custom_table_rows ctr
                  JOIN custom_table_defs ctd ON ctd.id = ctr.table_id
                  WHERE ctr.added_at >= '{}' OR ctd.created_at >= '{}'", cutoff, cutoff)).map_err(|e| e.to_string())?;

    let pkg = SyncPackage {
        version:      SYNC_VERSION,
        exported_at:  now.clone(),
        exported_by:  session.username.clone(),
        source_label: label.trim().to_string(),
        since:        since_ts,
        events:          events.clone(),
        event_sessions:  event_sessions.clone(),
        participants:    participants.clone(),
        scans:           scans.clone(),
        custom_table_defs: custom_table_defs.clone(),
        custom_table_rows: custom_table_rows.clone(),
    };

    // ── Serialise → gzip → write ───────────────────────────────────────────────
    let json = serde_json::to_vec(&pkg).map_err(|e| e.to_string())?;
    let compressed = gzip_compress(&json).map_err(|e| e.to_string())?;

    // Prepend magic bytes so we can validate on import
    let mut file_bytes = Vec::with_capacity(4 + compressed.len());
    file_bytes.extend_from_slice(FILE_MAGIC);
    file_bytes.extend_from_slice(&compressed);

    std::fs::write(&path, &file_bytes).map_err(|e| e.to_string())?;

    let file_size_kb = file_bytes.len() as u64 / 1024;

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "sync.export", "sync", None,
        Some(&format!("{} events, {} participants → {}", events.len(), participants.len(), path)),
        None);

    Ok(ExportSyncResult {
        path,
        exported_at: now,
        events:          events.len(),
        event_sessions:  event_sessions.len(),
        participants:    participants.len(),
        scans:           scans.len(),
        custom_table_defs: custom_table_defs.len(),
        custom_table_rows: custom_table_rows.len(),
        file_size_kb,
    })
}

// ── Peek command ──────────────────────────────────────────────────────────────

/// Read a .kibt file and return metadata WITHOUT importing anything.
/// Used to show the user what they are about to import.
#[tauri::command]
pub fn peek_sync_package(
    path: String,
) -> Result<SyncPackageInfo, String> {
    let file_bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let file_size_kb = file_bytes.len() as u64 / 1024;
    let pkg = parse_package(&file_bytes)?;

    Ok(SyncPackageInfo {
        version:        pkg.version,
        exported_at:    pkg.exported_at,
        exported_by:    pkg.exported_by,
        source_label:   pkg.source_label,
        since:          pkg.since,
        event_count:    pkg.events.len(),
        participant_count: pkg.participants.len(),
        custom_table_count: pkg.custom_table_defs.len(),
        custom_row_count:   pkg.custom_table_rows.len(),
        file_size_kb,
    })
}

// ── Import command ─────────────────────────────────────────────────────────────

/// Merge a .kibt file into the local database.
/// Uses INSERT OR IGNORE throughout — existing UUIDs are never overwritten.
#[tauri::command]
pub fn import_sync_package(
    state: State<'_, AppDataDir>,
    auth:  State<'_, AuthState>,
    path:  String,
) -> Result<ImportSyncResult, String> {
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;

    let file_bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let pkg = parse_package(&file_bytes)?;

    let mut conn = open(&state.0).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut result = ImportSyncResult {
        source_label:  pkg.source_label.clone(),
        exported_at:   pkg.exported_at.clone(),
        events_inserted: 0, event_sessions_inserted: 0,
        participants_inserted: 0, scans_inserted: 0,
        custom_table_defs_inserted: 0, custom_table_rows_inserted: 0,
        events_skipped: 0, participants_skipped: 0,
        errors: vec![],
    };

    // ── events ─────────────────────────────────────────────────────────────────
    for row in &pkg.events {
        match insert_json_row(&tx, "events",
            &["id","title","start_date","end_date","region","venue",
              "financial_year","event_type","notes","created_at"],
            row)
        {
            Ok(1) => result.events_inserted += 1,
            Ok(_) => result.events_skipped += 1,
            Err(e) => result.errors.push(format!("event {}: {}", json_id(row), e)),
        }
    }

    // ── event_sessions ─────────────────────────────────────────────────────────
    for row in &pkg.event_sessions {
        match insert_json_row(&tx, "event_sessions",
            &["id","event_id","session_no","title","date",
              "start_time","end_time","region","venue","created_at"],
            row)
        {
            Ok(1) => result.event_sessions_inserted += 1,
            Ok(_) => {},
            Err(e) => result.errors.push(format!("session {}: {}", json_id(row), e)),
        }
    }

    // ── participants ────────────────────────────────────────────────────────────
    for row in &pkg.participants {
        match insert_json_row(&tx, "participants",
            &["id","event_id","session_id","name","business_type",
              "age_category","gender","phone","consent","location",
              "region","extra_fields","id_number","source","added_at"],
            row)
        {
            Ok(1) => result.participants_inserted += 1,
            Ok(_) => result.participants_skipped += 1,
            Err(e) => result.errors.push(format!("participant {}: {}", json_id(row), e)),
        }
    }

    // ── scans ───────────────────────────────────────────────────────────────────
    for row in &pkg.scans {
        match insert_json_row(&tx, "scans",
            &["id","batch_id","batch_sequence","event_id","image_path",
              "scan_method","extracted_count","saved_count",
              "accuracy_note","scanned_at","model_version","detected_columns"],
            row)
        {
            Ok(1) => result.scans_inserted += 1,
            Ok(_) => {},
            Err(e) => result.errors.push(format!("scan {}: {}", json_id(row), e)),
        }
    }

    // ── custom_table_defs ───────────────────────────────────────────────────────
    for row in &pkg.custom_table_defs {
        match insert_json_row(&tx, "custom_table_defs",
            &["id","name","description","columns_json",
              "event_id","created_by","created_at"],
            row)
        {
            Ok(1) => result.custom_table_defs_inserted += 1,
            Ok(_) => {},
            Err(e) => result.errors.push(format!("custom_def {}: {}", json_id(row), e)),
        }
    }

    // ── custom_table_rows ───────────────────────────────────────────────────────
    for row in &pkg.custom_table_rows {
        match insert_json_row(&tx, "custom_table_rows",
            &["id","table_id","data_json","added_by","added_at"],
            row)
        {
            Ok(1) => result.custom_table_rows_inserted += 1,
            Ok(_) => {},
            Err(e) => result.errors.push(format!("custom_row {}: {}", json_id(row), e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Refresh query-planner statistics after a meaningful merge.
    let total_inserted = result.events_inserted + result.participants_inserted
        + result.custom_table_rows_inserted;
    if total_inserted >= 20 {
        let _ = conn.execute_batch("PRAGMA optimize;");
    }

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "sync.import", "sync", None,
        Some(&format!("from '{}' — {} events, {} participants inserted",
            pkg.source_label, result.events_inserted, result.participants_inserted)),
        None);

    Ok(result)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Dump a table as a Vec of JSON objects using the given SELECT query.
fn dump_table(conn: &rusqlite::Connection, _table: &str, sql: &str)
    -> anyhow::Result<Vec<serde_json::Value>>
{
    let mut stmt = conn.prepare(sql)?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();

    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, col) in col_names.iter().enumerate() {
            let val: rusqlite::types::Value = row.get(i)?;
            obj.insert(col.clone(), rusqlite_value_to_json(val));
        }
        Ok(serde_json::Value::Object(obj))
    })?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

fn rusqlite_value_to_json(v: rusqlite::types::Value) -> serde_json::Value {
    match v {
        rusqlite::types::Value::Null    => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
        rusqlite::types::Value::Real(f) => {
            serde_json::Number::from_f64(f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        }
        rusqlite::types::Value::Text(s)  => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b)  => {
            serde_json::Value::String(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD, &b
            ))
        }
    }
}

/// Generic INSERT OR IGNORE from a JSON object.
fn insert_json_row(
    conn:    &rusqlite::Connection,
    table:   &str,
    columns: &[&str],
    row:     &serde_json::Value,
) -> anyhow::Result<usize> {
    let placeholders = columns.iter().enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let col_list = columns.join(", ");
    let sql = format!(
        "INSERT OR IGNORE INTO {} ({}) VALUES ({})",
        table, col_list, placeholders
    );

    let mut stmt = conn.prepare_cached(&sql)?;

    let mut idx = 1usize;
    for col in columns {
        let v = row.get(*col).unwrap_or(&serde_json::Value::Null);
        match v {
            serde_json::Value::Null              => stmt.raw_bind_parameter(idx, rusqlite::types::Null)?,
            serde_json::Value::Bool(b)           => stmt.raw_bind_parameter(idx, *b as i64)?,
            serde_json::Value::Number(n)         => {
                if let Some(i) = n.as_i64() { stmt.raw_bind_parameter(idx, i)?; }
                else if let Some(f) = n.as_f64() { stmt.raw_bind_parameter(idx, f)?; }
                else { stmt.raw_bind_parameter(idx, rusqlite::types::Null)?; }
            }
            serde_json::Value::String(s)         => stmt.raw_bind_parameter(idx, s.as_str())?,
            other                                => stmt.raw_bind_parameter(idx, other.to_string().as_str())?,
        }
        idx += 1;
    }

    Ok(stmt.raw_execute()?)
}

fn json_id(row: &serde_json::Value) -> &str {
    row.get("id").and_then(|v| v.as_str()).unwrap_or("?")
}

fn parse_package(file_bytes: &[u8]) -> Result<SyncPackage, String> {
    if file_bytes.len() < 4 || &file_bytes[..4] != FILE_MAGIC {
        return Err("Not a valid KIBT sync file. Make sure you selected the correct .kibt file.".into());
    }
    let decompressed = gzip_decompress(&file_bytes[4..]).map_err(|e| e.to_string())?;
    let pkg: SyncPackage = serde_json::from_slice(&decompressed)
        .map_err(|e| format!("Corrupted sync file: {}", e))?;
    if pkg.version > SYNC_VERSION {
        return Err(format!(
            "Sync file was created by a newer version of KIBT-AMS (v{}). Please update the app.",
            pkg.version
        ));
    }
    Ok(pkg)
}

fn gzip_compress(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    use flate2::{write::GzEncoder, Compression};
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(data)?;
    Ok(encoder.finish()?)
}

fn gzip_decompress(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    use flate2::read::GzDecoder;
    let mut decoder = GzDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out)?;
    Ok(out)
}
