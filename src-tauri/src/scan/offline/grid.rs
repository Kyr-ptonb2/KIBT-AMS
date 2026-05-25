// NOTE: This file only compiles when the "offline-ocr" feature is enabled.
// scan/offline/grid.rs — Table grid detection and individual cell cropping.
//
// Strategy: fixed-layout template approach.
// The KIBT attendance sheet has the same columns at every event.
// After deskewing, we use morphological operations to find horizontal lines,
// then extract rows. Columns are defined by known proportional positions.

use super::preprocess::PreprocessedImage;
use anyhow::Result;
use opencv::{
    core::{self, Mat, Point, Rect, Scalar, Size, Vector},
    imgproc,
    prelude::*,
};

// ── KIBT Form Column Layout ───────────────────────────────────────────────────
// Column proportions (left edge as fraction of image width).
// These match the standard KIBT attendance register layout.
// Adjust if the printed form is updated.
//
// Columns:   No. | Full Name | Business Type | Age A | Age B | Gender M | Gender F | Phone | Consent
//
// We only extract the columns we need (skip No., merge Age A/B → ageCategory, merge M/F → gender).

// Column fractions (left, right) matching the KIBT form layout:
// No. | Full Name | Business Type | Age A | Age B | Gender M | Gender F | Phone | Consent
// These are used inline in detect_and_crop_cells below.

/// One row of cropped cell images (one Mat per column field).
pub struct CroppedRow {
    pub name_cell:          Mat,
    pub business_type_cell: Mat,
    pub age_a_cell:         Mat,
    pub age_b_cell:         Mat,
    pub gender_m_cell:      Mat,
    pub gender_f_cell:      Mat,
    pub phone_cell:         Mat,
    pub consent_cell:       Mat,
}

// ── Main entry ────────────────────────────────────────────────────────────────

/// Detect table row boundaries and crop each cell.
/// Returns one CroppedRow per detected row (header row excluded).
pub fn detect_and_crop_cells(img: &PreprocessedImage) -> Result<Vec<CroppedRow>> {
    let rows = detect_row_boundaries(&img.binary, img.height)?;

    if rows.len() < 2 {
        return Ok(vec![]);
    }

    let mut cropped_rows = Vec::new();
    let w = img.width;

    // Skip the first row (header)
    for window in rows.windows(2).skip(1) {
        let y_top    = window[0];
        let y_bottom = window[1];
        let row_h    = y_bottom - y_top;

        if row_h < 10 {
            continue; // skip degenerate rows
        }

        // Pad slightly inside the cell to avoid line interference
        let pad = 3.min(row_h / 4);
        let y   = y_top + pad;
        let h   = (row_h - pad * 2).max(1);

        let crop_cell = |left_frac: f64, right_frac: f64| -> Result<Mat> {
            let x1 = ((left_frac  * w as f64) as i32 + pad).clamp(0, w - 1);
            let x2 = ((right_frac * w as f64) as i32 - pad).clamp(x1 + 1, w);
            let rect = Rect::new(x1, y, (x2 - x1).max(1), h);
            let cell = Mat::roi(&img.gray, rect)?;
            Ok(cell.clone_pointee())
        };

        cropped_rows.push(CroppedRow {
            name_cell:          crop_cell(0.05, 0.30)?,
            business_type_cell: crop_cell(0.30, 0.50)?,
            age_a_cell:         crop_cell(0.50, 0.57)?,
            age_b_cell:         crop_cell(0.57, 0.63)?,
            gender_m_cell:      crop_cell(0.63, 0.69)?,
            gender_f_cell:      crop_cell(0.69, 0.75)?,
            phone_cell:         crop_cell(0.75, 0.90)?,
            consent_cell:       crop_cell(0.90, 1.00)?,
        });
    }

    Ok(cropped_rows)
}

// ── Row boundary detection ────────────────────────────────────────────────────

/// Use morphological operations to find horizontal line positions.
/// Returns sorted y-coordinates of line tops (in pixels).
fn detect_row_boundaries(binary: &Mat, height: i32) -> Result<Vec<i32>> {
    // Build a horizontal structuring element (wide, 1 pixel tall)
    let h_kernel_width = (binary.size()?.width / 20).max(20);
    let h_kernel = imgproc::get_structuring_element(
        imgproc::MORPH_RECT,
        Size::new(h_kernel_width, 1),
        Point::new(-1, -1),
    )?;

    // Erode then dilate to isolate horizontal lines
    let mut horizontal = Mat::default();
    imgproc::erode(&binary, &mut horizontal, &h_kernel, Point::new(-1, -1), 1, core::BORDER_CONSTANT, Scalar::all(0.0))?;
    imgproc::dilate(&horizontal, &mut horizontal, &h_kernel, Point::new(-1, -1), 1, core::BORDER_CONSTANT, Scalar::all(0.0))?;

    // Invert (lines are black in Otsu output on white paper)
    let mut inv = Mat::default();
    core::bitwise_not(&horizontal, &mut inv, &core::no_array())?;

    // Find contours of horizontal lines
    let mut contours: Vector<Vector<Point>> = Vector::new();
    imgproc::find_contours(
        &inv,
        &mut contours,
        imgproc::RETR_EXTERNAL,
        imgproc::CHAIN_APPROX_SIMPLE,
        Point::new(0, 0),
    )?;

    let mut y_positions: Vec<i32> = contours
        .iter()
        .filter_map(|c| {
            let rect = imgproc::bounding_rect(&c).ok()?;
            // Only keep wide lines (spanning at least 30% of width)
            if rect.width > binary.size().ok()?.width * 3 / 10 {
                Some(rect.y + rect.height / 2)
            } else {
                None
            }
        })
        .collect();

    y_positions.sort();
    y_positions.dedup_by(|a, b| (*a - *b).abs() < 5); // merge close lines

    // Ensure we have boundaries at top and bottom
    if y_positions.first().copied().unwrap_or(0) > 20 {
        y_positions.insert(0, 0);
    }
    if y_positions.last().copied().unwrap_or(0) < height - 20 {
        y_positions.push(height);
    }

    Ok(y_positions)
}
