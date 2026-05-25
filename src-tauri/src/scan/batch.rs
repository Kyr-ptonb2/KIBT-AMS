// scan/batch.rs — Batch queue manager.

use super::{gemini, offline, save_scan_record, BatchItemResult, BatchScanResult, QueueItemInput, friendly_api_error};
use crate::db::AppDataDir;
use anyhow::Result;
use serde::Serialize;
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
    method: String,
) -> Result<BatchScanResult, String> {
    let batch_id = Uuid::new_v4().to_string();
    let total = items.len();
    let app_data_dir = state.0.clone();

    let internet_available = super::check_connectivity().await;
    let gemini_key = if internet_available { super::get_gemini_key().ok() } else { None };
    let use_online = match method.as_str() {
        "online"  => true,
        "offline" => false,
        _         => internet_available && gemini_key.is_some(),
    };

    let mut results: Vec<BatchItemResult> = Vec::new();
    let mut total_extracted = 0usize;

    for (index, item) in items.iter().enumerate() {
        let _ = app_handle.emit("scan_batch_progress", BatchProgressEvent {
            batch_id: batch_id.clone(), item_id: item.item_id.clone(),
            index, total, status: "processing".to_string(),
            method: None, extracted_count: None, error: None,
        });

        let scan_result = if use_online && gemini_key.is_some() {
            match gemini::scan_with_gemini(&item.image_bytes, gemini_key.as_deref().unwrap()).await {
                Ok(r) => Ok(("gemini".to_string(), r.rows, None, r.detected_columns)),
                Err(e) => {
                    let msg = friendly_api_error(&e.to_string());
                    match offline::scan_offline(&item.image_bytes, &app_data_dir) {
                        Ok((rows, _note)) => Ok(("tesseract".to_string(), rows,
                            Some(format!("Online failed ({}); used offline.", msg)), vec![])),
                        Err(e2) => Err(format!("Both failed: {}; {}", msg, e2)),
                    }
                }
            }
        } else {
            offline::scan_offline(&item.image_bytes, &app_data_dir)
                .map(|(rows, note)| ("tesseract".to_string(), rows, note, vec![]))
                .map_err(|e| e.to_string())
        };

        match scan_result {
            Ok((actual_method, rows, accuracy_note, detected_columns)) => {
                let extracted = rows.len();
                total_extracted += extracted;
                let cols_json = serde_json::to_string(&detected_columns).ok();

                let scan_id = save_scan_record(
                    &app_data_dir, &item.event_id,
                    Some(&batch_id), Some((index + 1) as i32),
                    &item.image_bytes, &item.filename,
                    &actual_method, extracted, &accuracy_note,
                    cols_json.as_deref(),
                ).map_err(|e| e.to_string())?;

                let _ = app_handle.emit("scan_batch_progress", BatchProgressEvent {
                    batch_id: batch_id.clone(), item_id: item.item_id.clone(),
                    index, total, status: "done".to_string(),
                    method: Some(actual_method.clone()),
                    extracted_count: Some(extracted), error: None,
                });

                results.push(BatchItemResult {
                    item_id: item.item_id.clone(), scan_id,
                    event_id: item.event_id.clone(), filename: item.filename.clone(),
                    status: "done".to_string(), method: actual_method,
                    rows, error: accuracy_note, detected_columns,
                });
            }
            Err(err_msg) => {
                let _ = app_handle.emit("scan_batch_progress", BatchProgressEvent {
                    batch_id: batch_id.clone(), item_id: item.item_id.clone(),
                    index, total, status: "failed".to_string(),
                    method: None, extracted_count: Some(0), error: Some(err_msg.clone()),
                });
                results.push(BatchItemResult {
                    item_id: item.item_id.clone(), scan_id: String::new(),
                    event_id: item.event_id.clone(), filename: item.filename.clone(),
                    status: "failed".to_string(), method: "failed".to_string(),
                    rows: vec![], error: Some(err_msg), detected_columns: vec![],
                });
            }
        }

        if use_online && index + 1 < total {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    Ok(BatchScanResult { batch_id, results, total_extracted })
}
