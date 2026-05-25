// NOTE: This file only compiles when the "offline-ocr" feature is enabled.
// scan/offline/ocr.rs — Tesseract 5 LSTM OCR per cropped cell.
// Uses the `tesseract` crate (v0.14) with its builder/chaining API.

use super::grid::CroppedRow;
use anyhow::{Context, Result};
use opencv::{imgcodecs, prelude::*};

/// Raw OCR output for one attendance sheet row (before parsing/normalisation).
#[derive(Debug, Default)]
pub struct RawRow {
    pub name:          String,
    pub business_type: String,
    pub age_a_text:    String,
    pub age_b_text:    String,
    pub gender_m_text: String,
    pub gender_f_text: String,
    pub phone:         String,
    pub consent_text:  String,
}

/// Run Tesseract OCR on all cropped cell rows.
pub fn ocr_cells(rows: Vec<CroppedRow>) -> Result<Vec<RawRow>> {
    let mut results = Vec::new();

    for row in rows {
        let raw = RawRow {
            name:          ocr_text_cell(&row.name_cell, OcrMode::Multiword)?,
            business_type: ocr_text_cell(&row.business_type_cell, OcrMode::Multiword)?,
            age_a_text:    ocr_text_cell(&row.age_a_cell, OcrMode::SingleChar)?,
            age_b_text:    ocr_text_cell(&row.age_b_cell, OcrMode::SingleChar)?,
            gender_m_text: ocr_text_cell(&row.gender_m_cell, OcrMode::SingleChar)?,
            gender_f_text: ocr_text_cell(&row.gender_f_cell, OcrMode::SingleChar)?,
            phone:         ocr_text_cell(&row.phone_cell, OcrMode::Numeric)?,
            consent_text:  detect_mark_presence(&row.consent_cell)?,
        };

        if !raw.name.trim().is_empty() {
            results.push(raw);
        }
    }

    Ok(results)
}

// ── OCR modes ─────────────────────────────────────────────────────────────────

enum OcrMode {
    Multiword,
    SingleChar,
    Numeric,
}

/// OCR a single cell image and return the recognised text.
fn ocr_text_cell(cell: &opencv::core::Mat, mode: OcrMode) -> Result<String> {
    // Encode cell Mat to PNG bytes
    let mut buf = opencv::core::Vector::<u8>::new();
    imgcodecs::imencode(".png", cell, &mut buf, &opencv::core::Vector::new())?;
    let png_bytes = buf.to_vec();

    // tesseract 0.14 API: Tesseract::new(datapath, language)
    // Returns a Result<Tesseract>; then call set_image_from_mem, get_text.
    let mut api = tesseract::Tesseract::new(None, Some("eng"))
        .context("Failed to initialise Tesseract")?;

    // Page segmentation mode is set via variable
    let (psm, whitelist): (&str, Option<&str>) = match mode {
        OcrMode::SingleChar => (
            "10", // PSM_SINGLE_CHAR
            Some("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./xXvV"),
        ),
        OcrMode::Numeric => (
            "7", // PSM_SINGLE_LINE
            Some("0123456789+- "),
        ),
        OcrMode::Multiword => (
            "6", // PSM_SINGLE_BLOCK
            None,
        ),
    };

    api = api
        .set_variable("tessedit_pageseg_mode", psm)
        .context("Failed to set PSM")?;

    if let Some(wl) = whitelist {
        api = api
            .set_variable("tessedit_char_whitelist", wl)
            .context("Failed to set whitelist")?;
    }

    api = api
        .set_image_from_mem(&png_bytes)
        .context("Failed to load image into Tesseract")?;

    let text = api.get_text().unwrap_or_default();
    Ok(text.trim().replace('\n', " ").to_string())
}

/// Detect whether a consent cell contains any mark (presence detection).
fn detect_mark_presence(cell: &opencv::core::Mat) -> Result<String> {
    let mut gray = opencv::core::Mat::default();
    if cell.channels() > 1 {
        opencv::imgproc::cvt_color(cell, &mut gray, opencv::imgproc::COLOR_BGR2GRAY, 0)?;
    } else {
        gray = cell.clone();
    }

    let mut binary = opencv::core::Mat::default();
    opencv::imgproc::threshold(
        &gray, &mut binary, 128.0, 255.0, opencv::imgproc::THRESH_BINARY_INV,
    )?;

    let non_zero = opencv::core::count_non_zero(&binary)?;
    let total_pixels = binary.rows() * binary.cols();
    let threshold = (total_pixels as f64 * 0.005) as i32;

    if non_zero > threshold { Ok("Yes".to_string()) } else { Ok("No".to_string()) }
}
