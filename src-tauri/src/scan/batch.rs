// scan/batch.rs — Batch queue manager with parallel processing.

use super::{gemini, save_scan_record, BatchItemResult, BatchScanResult, QueueItemInput, friendly_api_error, get_gemini_key};
use crate::db::AppDataDir;
use anyhow::Result;
use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgressEvent {
    pub batch_id: String,
    pub item_id: String,
    pub index: usize,
    pub total: usize,
    pub status: String,
    pub method: Option<String>,
    pub extracted_count: Option<usize>,
    pub error: Option<String>,
}

pub async fn run_batch(
    app_handle: tauri::AppHandle,
    state: State<'_, AppDataDir>,
    items: Vec<QueueItemInput>,
    _method: String,
) -> Result<BatchScanResult, String> {
    let batch_id = Uuid::new_v4().to_string();
    let total = items.len();
    let app_data_dir = state.0.clone();

    let gemini_key = match get_gemini_key() {
        Ok(key) => key,
        Err(_) => return Err("Gemini API key not configured. Set it in Settings.".to_string()),
    };

    // 4 concurrent workers with rate limiting
    let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    let rate_limiter = Arc::new(tokio::sync::Mutex::new(std::time::Instant::now()));

    let mut handles = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        let batch_id_clone = batch_id.clone();
        let app_handle_clone = app_handle.clone();
        let app_data_dir_clone = app_data_dir.clone();
        let gemini_key_clone = gemini_key.clone();
        let semaphore_clone = semaphore.clone();
        let rate_limiter_clone = rate_limiter.clone();

        let handle = tokio::spawn(async move {
            let _permit = semaphore_clone.acquire().await.ok();

            // Rate limiting: 1s between Gemini API calls
            {
                let mut last_call = rate_limiter_clone.lock().await;
                let elapsed = last_call.elapsed();
                if elapsed < std::time::Duration::from_secs(1) {
                    tokio::time::sleep(std::time::Duration::from_secs(1) - elapsed).await;
                }
                *last_call = std::time::Instant::now();
            }

            // Emit processing status
            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                batch_id: batch_id_clone.clone(),
                item_id: item.item_id.clone(),
                index,
                total,
                status: "processing".to_string(),
                method: None,
                extracted_count: None,
                error: None,
            });

            // Scan with Gemini
            match gemini::scan_with_gemini(&item.image_bytes, &gemini_key_clone).await {
                Ok(r) => {
                    let extracted = r.rows.len();
                    let cols_json = serde_json::to_string(&r.detected_columns).ok();

                    match save_scan_record(
                        &app_data_dir_clone,
                        &item.event_id,
                        Some(&batch_id_clone),
                        Some((index + 1) as i32),
                        &item.image_bytes,
                        &item.filename,
                        "gemini",
                        extracted,
                        &None,
                        cols_json.as_deref(),
                    ) {
                        Ok(scan_id) => {
                            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                                batch_id: batch_id_clone.clone(),
                                item_id: item.item_id.clone(),
                                index,
                                total,
                                status: "done".to_string(),
                                method: Some("gemini".to_string()),
                                extracted_count: Some(extracted),
                                error: None,
                            });

                            Some(BatchItemResult {
                                item_id: item.item_id.clone(),
                                scan_id,
                                event_id: item.event_id.clone(),
                                filename: item.filename.clone(),
                                status: "done".to_string(),
                                method: "gemini".to_string(),
                                rows: r.rows,
                                error: None,
                                detected_columns: r.detected_columns,
                            })
                        }
                        Err(e) => {
                            let err_msg = format!("Failed to save scan: {}", e);
                            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                                batch_id: batch_id_clone.clone(),
                                item_id: item.item_id.clone(),
                                index,
                                total,
                                status: "failed".to_string(),
                                method: None,
                                extracted_count: Some(0),
                                error: Some(err_msg.clone()),
                            });

                            Some(BatchItemResult {
                                item_id: item.item_id.clone(),
                                scan_id: String::new(),
                                event_id: item.event_id.clone(),
                                filename: item.filename.clone(),
                                status: "failed".to_string(),
                                method: "failed".to_string(),
                                rows: vec![],
                                error: Some(err_msg),
                                detected_columns: vec![],
                            })
                        }
                    }
                }
                Err(e) => {
                    let err_msg = friendly_api_error(&e.to_string());
                    let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                        batch_id: batch_id_clone.clone(),
                        item_id: item.item_id.clone(),
                        index,
                        total,
                        status: "failed".to_string(),
                        method: None,
                        extracted_count: Some(0),
                        error: Some(err_msg.clone()),
                    });

                    Some(BatchItemResult {
                        item_id: item.item_id.clone(),
                        scan_id: String::new(),
                        event_id: item.event_id.clone(),
                        filename: item.filename.clone(),
                        status: "failed".to_string(),
                        method: "failed".to_string(),
                        rows: vec![],
                        error: Some(err_msg),
                        detected_columns: vec![],
                    })
                }
            }
        });

        handles.push(handle);
    }

    // Collect results maintaining order
    let mut results = Vec::new();
    let mut total_extracted = 0usize;

    for handle in handles {
        if let Ok(Some(result)) = handle.await {
            total_extracted += result.rows.len();
            results.push(result);
        }
    }

    // Sort results by index to maintain order
    results.sort_by_key(|r| {
        items.iter().position(|item| item.item_id == r.item_id).unwrap_or(usize::MAX)
    });

    Ok(BatchScanResult { batch_id, results, total_extracted })
}

