// scan/mod.rs — Scan pipeline (Gemini online only).

pub mod batch;
pub mod gemini;
pub mod groq;
pub mod http;

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
    // Run the blocking TCP connect on a thread-pool thread so the Tauri
    // async runtime (tokio) is never blocked by the 2-second timeout.
    tokio::task::spawn_blocking(|| {
        use std::net::TcpStream;
        use std::time::Duration;
        TcpStream::connect_timeout(
            &"8.8.8.8:443".parse().unwrap(),
            Duration::from_secs(2),
        ).is_ok()
    })
    .await
    .unwrap_or(false)
}

/// Scan a single sheet image with automatic provider fallback.
/// Tries Gemini first; if it fails (rate-limited, down, invalid key),
/// automatically retries with Groq (free tier) if a Groq key is configured.
#[tauri::command]
pub async fn scan_sheet(
    state: State<'_, AppDataDir>,
    event_id: String,
    image_bytes: Vec<u8>,
    filename: String,
) -> Result<ScanResult, String> {
    let app_data_dir = state.0.clone();

    // scan_with_fallback already returns a well-formatted, user-facing error
    // message (naming which providers were tried and why) — don't re-wrap it.
    let (result, method_used, fallback_note) = scan_with_fallback(&image_bytes).await?;

    let extracted = result.rows.len();
    let cols_json = serde_json::to_string(&result.detected_columns).ok();
    let scan_id = save_scan_record(
        &app_data_dir, &event_id, None, None,
        &image_bytes, &filename, &method_used,
        extracted, &fallback_note, cols_json.as_deref(),
    ).map_err(|e| e.to_string())?;

    write_log(&app_data_dir, None, None,
        &format!("scan.{}", method_used), "scan",
        Some(&scan_id), Some(&event_id),
        Some(&format!("{} rows extracted from {}{}", extracted, filename,
            fallback_note.as_deref().map(|n| format!(" ({})", n)).unwrap_or_default())));

    Ok(ScanResult {
        scan_id,
        method: method_used,
        rows: result.rows,
        extracted_count: extracted,
        accuracy_note: fallback_note,
        detected_columns: result.detected_columns,
    })
}

/// Try each configured AI provider in order until one succeeds.
/// Order: Gemini (primary) → Groq (free fallback) → Gemini alternate model.
/// Returns (result, provider_name_used, optional_note_about_fallback).
pub async fn scan_with_fallback(
    image_bytes: &[u8],
) -> std::result::Result<(gemini::GeminiScanResult, String, Option<String>), String> {
    let mut errors: Vec<String> = Vec::new();

    // ── 1. Primary: Gemini ──────────────────────────────────────────────────
    if let Ok(gemini_key) = get_gemini_key() {
        match gemini::scan_with_gemini(image_bytes, &gemini_key).await {
            Ok(r) => return Ok((r, "gemini".to_string(), None)),
            Err(e) => errors.push(format!("Gemini: {}", friendly_api_error(&e.to_string()))),
        }
    } else {
        errors.push("Gemini: no API key configured".to_string());
    }

    // ── 2. Fallback: Groq (free tier, Llama Vision) ─────────────────────────
    if let Ok(groq_key) = get_groq_key() {
        match groq::scan_with_groq(image_bytes, &groq_key).await {
            Ok(r) => {
                return Ok((
                    r, "groq".to_string(),
                    Some("Auto-switched to backup AI (Gemini unavailable)".to_string()),
                ));
            }
            Err(e) => errors.push(format!("Groq: {}", friendly_api_error(&e.to_string()))),
        }
    }

    // ── 3. Last resort: Gemini alternate model (in case only one model is down) ──
    if let Ok(gemini_key) = get_gemini_key() {
        match gemini::scan_with_gemini_alt_model(image_bytes, &gemini_key).await {
            Ok(r) => {
                return Ok((
                    r, "gemini-alt".to_string(),
                    Some("Used alternate Gemini model (primary model unavailable)".to_string()),
                ));
            }
            Err(e) => errors.push(format!("Gemini (alt model): {}", friendly_api_error(&e.to_string()))),
        }
    }

    // All providers failed
    if errors.is_empty() {
        Err("No AI provider is configured. Add a Gemini or Groq API key in Settings.".to_string())
    } else {
        Err(format!(
            "All AI providers failed:\n{}\n\nAdd a free Groq API key in Settings as a backup — see Settings for instructions.",
            errors.join("\n")
        ))
    }
}

/// Scan multiple sheets in batch using Gemini (online only).
#[tauri::command]
pub async fn scan_batch(
    app_handle: tauri::AppHandle,
    state: State<'_, AppDataDir>,
    items: Vec<QueueItemInput>,
) -> Result<BatchScanResult, String> {
    batch::run_batch(app_handle, state, items).await
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

pub fn get_groq_key() -> Result<String> {
    let entry = keyring::Entry::new("kibt-ams", "groq-api-key")?;
    let key = entry.get_password()?;
    if key.is_empty() { anyhow::bail!("Groq API key not configured"); }
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
            extracted as i64, accuracy_note, now, "gemini-2.0-flash", detected_columns
        ],
    )?;
    Ok(scan_id)
}
