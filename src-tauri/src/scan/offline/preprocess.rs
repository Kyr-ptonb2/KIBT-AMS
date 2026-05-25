// NOTE: This file only compiles when the "offline-ocr" feature is enabled.
// scan/offline/preprocess.rs — OpenCV image preprocessing.
// Steps: decode → grayscale → deskew → CLAHE contrast → noise removal → Otsu binarise.

use anyhow::{Context, Result};
use opencv::{
    core::{self, Mat, Point2f, Scalar, Size, Vec2f, Vector},
    imgcodecs,
    imgproc,
    prelude::*,
};

/// Preprocessed image output: binarised Mat ready for grid detection.
pub struct PreprocessedImage {
    pub binary: Mat,       // Black-and-white image (Otsu threshold)
    pub gray: Mat,         // Grayscale (for OCR cell crops)
    pub original: Mat,     // Original decoded image
    pub width: i32,
    pub height: i32,
}

/// Full preprocessing pipeline on raw image bytes.
pub fn preprocess_image(image_bytes: &[u8]) -> Result<PreprocessedImage> {
    // ── Step 1: Decode image from bytes ──────────────────────────────────────
    let data = core::Vector::<u8>::from_slice(image_bytes);
    let original = imgcodecs::imdecode(&data, imgcodecs::IMREAD_COLOR)
        .context("Failed to decode image")?;

    if original.empty() {
        anyhow::bail!("Decoded image is empty — possibly corrupt or unsupported format");
    }

    // ── Step 2: Convert to grayscale ─────────────────────────────────────────
    let mut gray = Mat::default();
    imgproc::cvt_color(&original, &mut gray, imgproc::COLOR_BGR2GRAY, 0)?;

    // ── Step 3: Deskew (rotation correction) ─────────────────────────────────
    let deskewed = deskew(&gray)?;

    // ── Step 4: CLAHE contrast enhancement ───────────────────────────────────
    // Adaptive histogram equalisation — handles shadows and glare from phone flash.
    let mut clahe_out = Mat::default();
    let clahe = imgproc::create_clahe(2.0, Size::new(8, 8))?;
    clahe.apply(&deskewed, &mut clahe_out)?;

    // ── Step 5: Noise removal (median blur) ──────────────────────────────────
    let mut denoised = Mat::default();
    imgproc::median_blur(&clahe_out, &mut denoised, 3)?;

    // ── Step 6: Otsu binarisation ─────────────────────────────────────────────
    let mut binary = Mat::default();
    imgproc::threshold(
        &denoised,
        &mut binary,
        0.0,
        255.0,
        imgproc::THRESH_BINARY + imgproc::THRESH_OTSU,
    )?;

    let size = binary.size()?;

    Ok(PreprocessedImage {
        binary,
        gray: deskewed,
        original,
        width: size.width,
        height: size.height,
    })
}

// ── Deskew ────────────────────────────────────────────────────────────────────

/// Detect the rotation angle of the page and rotate to horizontal.
fn deskew(gray: &Mat) -> Result<Mat> {
    // Find edges
    let mut edges = Mat::default();
    imgproc::canny(gray, &mut edges, 50.0, 150.0, 3, false)?;

    // Hough line detection
    let mut lines = core::Vector::<core::Vec2f>::new();
    imgproc::hough_lines(
        &edges,
        &mut lines,
        1.0,
        std::f64::consts::PI / 180.0,
        150,
    )?;

    if lines.is_empty() {
        // Can't detect lines; return unchanged
        return Ok(gray.clone());
    }

    // Calculate median angle of detected lines
    let angles: Vec<f64> = lines
        .iter()
        .map(|l| {
            let theta = l[1] as f64;
            // Convert to degrees; normalise to -45..45
            let deg = theta.to_degrees() - 90.0;
            if deg < -45.0 { deg + 90.0 } else if deg > 45.0 { deg - 90.0 } else { deg }
        })
        .collect();

    let mut sorted = angles.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_angle = sorted[sorted.len() / 2];

    // If angle is tiny, skip rotation (avoid unnecessary blur)
    if median_angle.abs() < 0.5 {
        return Ok(gray.clone());
    }

    // Rotate the image
    let size = gray.size()?;
    let centre = Point2f::new(size.width as f32 / 2.0, size.height as f32 / 2.0);
    let rotation_matrix = imgproc::get_rotation_matrix_2d(centre, median_angle, 1.0)?;

    let mut rotated = Mat::default();
    imgproc::warp_affine(
        gray,
        &mut rotated,
        &rotation_matrix,
        size,
        imgproc::INTER_LINEAR,
        core::BORDER_REPLICATE,
        Scalar::all(255.0),
    )?;

    Ok(rotated)
}
