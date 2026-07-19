// scan/batch.rs — Batch queue manager with automatic provider fallback.

use super::{save_scan_record, scan_with_fallback, BatchItemResult, BatchScanResult, QueueItemInput};
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
) -> Result<BatchScanResult, String> {
    let batch_id = Uuid::new_v4().to_string();
    let total = items.len();
    let app_data_dir = state.0.clone();

    let items_map: std::collections::HashMap<String, usize> = items
        .iter().enumerate()
        .map(|(i, item)| (item.item_id.clone(), i))
        .collect();

    // 4 concurrent workers with 1s rate-limiting between calls (per-worker,
    // shared across whichever provider ends up serving each request).
    // 2 concurrent workers — deliberately conservative. KIBT-AMS runs on
    // older field laptops; each worker holds a full image in memory and
    // spawns a curl subprocess. Combined with client-side image compression
    // (src/lib/imageUtils.ts), 2 workers keeps peak RAM/CPU low while still
    // getting meaningful parallelism over slow/variable rural connections.
    let semaphore    = Arc::new(tokio::sync::Semaphore::new(2));
    let rate_limiter = Arc::new(tokio::sync::Mutex::new(std::time::Instant::now()));
    let mut handles  = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        let batch_id_clone     = batch_id.clone();
        let app_handle_clone   = app_handle.clone();
        let app_data_dir_clone = app_data_dir.clone();
        let semaphore_clone    = semaphore.clone();
        let rate_limiter_clone = rate_limiter.clone();

        let handle = tokio::spawn(async move {
            let _permit = semaphore_clone.acquire().await.ok();

            {
                let mut last = rate_limiter_clone.lock().await;
                let elapsed = last.elapsed();
                if elapsed < std::time::Duration::from_secs(1) {
                    tokio::time::sleep(std::time::Duration::from_secs(1) - elapsed).await;
                }
                *last = std::time::Instant::now();
            }

            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                batch_id: batch_id_clone.clone(), item_id: item.item_id.clone(),
                index, total, status: "processing".to_string(),
                method: None, extracted_count: None, error: None,
            });

            match scan_with_fallback(&item.image_bytes).await {
                Ok((r, method_used, fallback_note)) => {
                    let extracted = r.rows.len();
                    let cols_json = serde_json::to_string(&r.detected_columns).ok();

                    match save_scan_record(
                        &app_data_dir_clone, &item.event_id,
                        Some(&batch_id_clone), Some((index + 1) as i32),
                        &item.image_bytes, &item.filename, &method_used,
                        extracted, &fallback_note, cols_json.as_deref(),
                    ) {
                        Ok(scan_id) => {
                            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                                batch_id: batch_id_clone.clone(), item_id: item.item_id.clone(),
                                index, total, status: "done".to_string(),
                                method: Some(method_used.clone()),
                                extracted_count: Some(extracted), error: None,
                            });
                            Some(BatchItemResult {
                                item_id: item.item_id, scan_id,
                                event_id: item.event_id, filename: item.filename,
                                status: "done".to_string(), method: method_used,
                                rows: r.rows, error: fallback_note,
                                detected_columns: r.detected_columns,
                            })
                        }
                        Err(e) => {
                            let msg = format!("Failed to save scan: {}", e);
                            let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                                batch_id: batch_id_clone.clone(), item_id: item.item_id.clone(),
                                index, total, status: "failed".to_string(),
                                method: None, extracted_count: Some(0), error: Some(msg.clone()),
                            });
                            Some(BatchItemResult {
                                item_id: item.item_id, scan_id: String::new(),
                                event_id: item.event_id, filename: item.filename,
                                status: "failed".to_string(), method: "failed".to_string(),
                                rows: vec![], error: Some(msg), detected_columns: vec![],
                            })
                        }
                    }
                }
                Err(msg) => {
                    let _ = app_handle_clone.emit("scan_batch_progress", BatchProgressEvent {
                        batch_id: batch_id_clone.clone(), item_id: item.item_id.clone(),
                        index, total, status: "failed".to_string(),
                        method: None, extracted_count: Some(0), error: Some(msg.clone()),
                    });
                    Some(BatchItemResult {
                        item_id: item.item_id, scan_id: String::new(),
                        event_id: item.event_id, filename: item.filename,
                        status: "failed".to_string(), method: "failed".to_string(),
                        rows: vec![], error: Some(msg), detected_columns: vec![],
                    })
                }
            }
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    let mut total_extracted = 0usize;

    for handle in handles {
        if let Ok(Some(r)) = handle.await {
            total_extracted += r.rows.len();
            results.push(r);
        }
    }

    results.sort_by_key(|r| items_map.get(&r.item_id).copied().unwrap_or(usize::MAX));
    Ok(BatchScanResult { batch_id, results, total_extracted })
}
