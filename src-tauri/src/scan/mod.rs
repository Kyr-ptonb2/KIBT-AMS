// scan/mod.rs — Scan pipeline orchestrator.

pub mod batch;
pub mod gemini;

use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use crate::participants::ParticipantInput;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scan_id: String,
    pub method: String,
    pub rows: Vec<ParticipantInput>,
    pub extracted_count: usize,
    pub accuracy_note: Option<String>,
    pub detected_columns: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueueItemInput {
    pub item_id: String,
    pub event_id: String,
    pub image_bytes: Vec<u8>,
    pub filename: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchScanResult {
    pub batch_id: String,
    pub results: Vec<BatchItemResult>,
    pub total_extracted: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemResult {
    pub item_id: String,
    pub scan_id: String,
    pub event_id: String,
    pub filename: String,
    pub status: String,
    pub method: String,
    pub rows: Vec<ParticipantInput>,
    pub error: Option<String>,
    pub detected_columns: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStatus {
    pub batch_id: String,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub waiting: usize,
}

#[tauri::command]
pub async fn check_connectivity() -> bool {
    use std::net::TcpStream;
    use std::time::Duration;
    TcpStream::connect_timeout(
        &"8.8.8.8:443".parse().unwrap(),
        Duration::from_secs(2),
    ).is_ok()
}

#[tauri::command]
pub async fn scan_sheet(
    state: State<'_, AppDataDir>,
    event_id: String,
    image_bytes: Vec<u8>,
    filename: String,
) -> Result<ScanResult, String> {
    let app_data_dir = state.0.clone();
    let gemini_key = get_gemini_key().map_err(|e| e.to_string())?;

    match gemini::scan_with_gemini(&image_bytes, &gemini_key).await {
        Ok(r) => {
            let extracted = r.rows.len();
            let cols_json = serde_json::to_string(&r.detected_columns).ok();
            let scan_id = save_scan_record(
                &app_data_dir, &event_id, None, None,
                &image_bytes, &filename, "gemini",
                extracted, &None, cols_json.as_deref(),
            ).map_err(|e| e.to_string())?;

            write_log(&app_data_dir, None, None,
                "scan.gemini", "scan",
                Some(&scan_id), Some(&event_id),
                Some(&format!("{} rows extracted from {}", extracted, filename)));

            Ok(ScanResult {
                scan_id,
                method: "gemini".to_string(),
                rows: r.rows,
                extracted_count: extracted,
                accuracy_note: None,
                detected_columns: r.detected_columns,
            })
        }
        Err(e) => {
            let msg = friendly_api_error(&e.to_string());
            Err(msg)
        }
    }
}

#[tauri::command]
pub async fn scan_batch(
    app_handle: tauri::AppHandle,
    state: State<'_, AppDataDir>,
    items: Vec<QueueItemInput>,
    method: String,
) -> Result<BatchScanResult, String> {
    batch::run_batch(app_handle, state, items, method).await
}

#[tauri::command]
pub fn get_scan_queue_status(
    state: State<'_, AppDataDir>,
    batch_id: String,
) -> Result<BatchStatus, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let total: usize = conn.query_row(
        "SELECT COUNT(*) FROM scans WHERE batch_id = ?1",
        params![batch_id], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(BatchStatus { batch_id, total, done: total, failed: 0, waiting: 0 })
}

pub fn get_gemini_key() -> Result<String> {
    let entry = keyring::Entry::new("kibt-ams", "gemini-api-key")?;
    let key = entry.get_password()?;
    if key.is_empty() { anyhow::bail!("Gemini API key not configured"); }
    Ok(key)
}

pub fn friendly_api_error(raw: &str) -> String {
    if raw.contains("429") || raw.contains("RESOURCE_EXHAUSTED") {
        if raw.contains("limit: 0") {
            return "API key has no free quota. Create a new key at aistudio.google.com".to_string();
        }
        if let Some(s) = raw.split("retry in ").nth(1).and_then(|s| s.split('s').next()) {
            return format!("Rate limit — retry in {}s", s.trim());
        }
        return "Rate limit hit. Wait 1 minute.".to_string();
    }
    if raw.contains("401") || raw.contains("API_KEY_INVALID") {
        return "Invalid API key. Check Settings.".to_string();
    }
    if raw.contains("404") || raw.contains("NOT_FOUND") {
        return "Model not found. Check model name in gemini.rs.".to_string();
    }
    if raw.contains("Failed to send") || raw.contains("Connection") || raw.contains("curl error") {
        return "Network error. Check internet connection.".to_string();
    }
    if raw.len() > 120 { format!("{}…", &raw[..120]) } else { raw.to_string() }
}

pub fn save_scan_record(
    app_data_dir: &Path,
    event_id: &str,
    batch_id: Option<&str>,
    batch_sequence: Option<i32>,
    image_bytes: &[u8],
    filename: &str,
    method: &str,
    extracted: usize,
    accuracy_note: &Option<String>,
    detected_columns: Option<&str>,
) -> Result<String> {
    let scans_dir = app_data_dir.join("scans").join(event_id);
    std::fs::create_dir_all(&scans_dir)?;
    let ts  = chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string();
    let seq = batch_sequence.map(|n| format!("_{}", n)).unwrap_or_default();
    let img_filename = format!("{}{}_{}", ts, seq, filename);
    let img_path = scans_dir.join(&img_filename);
    std::fs::write(&img_path, image_bytes)?;

    let relative = img_path.strip_prefix(app_data_dir)?.to_string_lossy().to_string();
    let scan_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = open(app_data_dir)?;
    conn.execute(
        r#"INSERT INTO scans
           (id, batch_id, batch_sequence, event_id, image_path, scan_method,
            extracted_count, saved_count, accuracy_note, scanned_at, model_version, detected_columns)
           VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11)"#,
        params![
            scan_id, batch_id, batch_sequence, event_id, relative, method,
            extracted as i64, accuracy_note, now,
            if method == "gemini" { "gemini-3.1-flash-lite" } else { "tesseract-5" },
            detected_columns
        ],
    )?;
    Ok(scan_id)
}
