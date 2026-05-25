// scan/offline/mod.rs — Offline scan using tesseract CLI + phone-anchored detection.
// Returns EMPTY (not garbage) when confidence is too low — staff can enter manually.

use crate::participants::ParticipantInput;
use anyhow::Result;
use std::path::Path;
use std::process::Command;

pub fn scan_offline(
    image_bytes: &[u8],
    _app_data_dir: &Path,
) -> Result<(Vec<ParticipantInput>, Option<String>)> {
    if Command::new("tesseract").arg("--version").output().is_err() {
        return Ok((vec![], Some(
            "Tesseract not installed. Run: sudo pacman -S tesseract tesseract-data-eng".to_string()
        )));
    }

    let tmp      = std::env::temp_dir();
    let img_path = tmp.join(format!("kibt_{}.jpg", uuid::Uuid::new_v4()));
    let txt_base = tmp.join(format!("kibt_{}", uuid::Uuid::new_v4()));
    let txt_full = format!("{}.txt", txt_base.to_string_lossy());

    std::fs::write(&img_path, image_bytes)?;

    let out = Command::new("tesseract")
        .args([
            img_path.to_str().unwrap(),
            txt_base.to_str().unwrap(),
            "--psm", "6", "--oem", "1", "-l", "eng",
        ])
        .output()?;

    let _ = std::fs::remove_file(&img_path);

    if !out.status.success() {
        return Ok((vec![], Some(format!(
            "Tesseract error: {}", String::from_utf8_lossy(&out.stderr)
        ))));
    }

    let raw = std::fs::read_to_string(&txt_full).unwrap_or_default();
    let _ = std::fs::remove_file(&txt_full);

    // Only use phone-anchored rows — never return garbage guesses
    let rows = extract_phone_anchored_rows(&raw);

    let note = if rows.is_empty() {
        Some(concat!(
            "Offline OCR could not reliably read this image. ",
            "Options: (1) Use Gemini scan — better lighting/closer photo, ",
            "(2) Click '+ Add Row' to enter participants manually."
        ).to_string())
    } else {
        Some(format!(
            "Offline OCR — {} rows found. Review names and phones carefully.",
            rows.len()
        ))
    };

    Ok((rows, note))
}

// ── Only extract rows where a Kenyan phone number is clearly visible ──────────

const SKIP_FRAGMENTS: &[&str] = &[
    "ministry", "state department", "kenya institute", "business training",
    "attendance", "registration", "event title", "venue", "date",
    "participants", "business type", "phone number", "gender", "above",
    "below", "consent", "signature", "sign if", "personal data", "s/no",
    "serial", "yrs", "msme", "development", "cooperatives", "enterprise",
    "medium", "micro", "small", "taken/shared", "full name",
];

fn extract_phone_anchored_rows(text: &str) -> Vec<ParticipantInput> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let mut rows = Vec::new();
    let mut used = vec![false; lines.len()];

    for (i, line) in lines.iter().enumerate() {
        let phone = match extract_kenyan_phone(line) {
            Some(p) => p,
            None    => continue,
        };

        // This line contains a valid phone — find the name
        let name = extract_name_from_line(line)
            .or_else(|| {
                // Look at the line above for the name
                if i > 0 && !used[i - 1] && !is_skip_line(lines[i - 1]) {
                    extract_name_from_line(lines[i - 1])
                } else {
                    None
                }
            });

        let Some(name) = name else { continue };

        used[i] = true;
        if i > 0 { used[i - 1] = true; }

        rows.push(ParticipantInput { location: None, extra_fields: None,
            name,
            business_type: detect_business_type(line),
            age_category:  detect_age_category(line),
            gender:        detect_gender(line),
            phone:         Some(phone),
            consent:       Some("Yes".to_string()), // presence of phone row implies attended
        });
    }

    rows
}

fn is_skip_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    line.len() < 3
        || (line == line.to_uppercase() && line.split_whitespace().count() <= 5)
        || SKIP_FRAGMENTS.iter().any(|&f| lower.contains(f))
}

/// Extract a Kenyan phone number — strict pattern only (no guessing).
fn extract_kenyan_phone(line: &str) -> Option<String> {
    // Condense digits from the line
    let digits: String = line.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 9 { return None; }

    // Try strict Kenyan patterns
    for prefix in &["07", "01"] {
        if let Some(pos) = digits.find(prefix) {
            let run: String = digits[pos..].chars().take(10).collect();
            if run.len() == 10 { return Some(run); }
        }
    }
    for prefix in &["2547", "2541"] {
        if let Some(pos) = digits.find(prefix) {
            let run: String = digits[pos..].chars().take(12).collect();
            if run.len() == 12 { return Some(run); }
        }
    }
    None
}

fn extract_name_from_line(line: &str) -> Option<String> {
    if is_skip_line(line) { return None; }

    let words: Vec<String> = line
        .split_whitespace()
        .filter(|w| {
            let alpha: String = w.chars().filter(|c| c.is_alphabetic()).collect();
            alpha.len() >= 2 && !is_field_word(w)
        })
        .take(4)
        .map(|w| {
            let mut ch = w.chars();
            match ch.next() {
                None    => String::new(),
                Some(f) => f.to_uppercase().to_string() + &ch.as_str().to_lowercase(),
            }
        })
        .collect();

    if words.len() >= 2 { Some(words.join(" ")) } else { None }
}

fn is_field_word(w: &str) -> bool {
    matches!(w.to_lowercase().as_str(),
        "sole" | "proprietor" | "partnership" | "limited" | "cooperative"
        | "association" | "other" | "yes" | "no" | "male" | "female"
        | "above" | "below" | "yrs" | "sign" | "consent" | "a" | "b"
        | "m" | "f" | "mr" | "mrs" | "ms"
    )
}

fn detect_gender(line: &str) -> Option<String> {
    for token in line.split_whitespace() {
        let t = token.trim_matches(|c: char| !c.is_alphabetic()).to_uppercase();
        if t == "M" || t == "MALE"   { return Some("M".to_string()); }
        if t == "F" || t == "FEMALE" { return Some("F".to_string()); }
    }
    None
}

fn detect_age_category(line: &str) -> Option<String> {
    for token in line.split_whitespace() {
        let t = token.trim_matches(|c: char| !c.is_alphabetic()).to_uppercase();
        if t == "A" { return Some("A".to_string()); }
        if t == "B" { return Some("B".to_string()); }
    }
    None
}

fn detect_business_type(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    if lower.contains("sole") || lower.contains("proprietor") { Some("Sole proprietor".to_string()) }
    else if lower.contains("partner") { Some("Partnership".to_string()) }
    else if lower.contains("limited") || lower.contains("ltd") { Some("Limited company".to_string()) }
    else if lower.contains("coop") { Some("Cooperative".to_string()) }
    else if lower.contains("assoc") { Some("Association".to_string()) }
    else { None }
}
