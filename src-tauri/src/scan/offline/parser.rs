// NOTE: This file only compiles when the "offline-ocr" feature is enabled.
// scan/offline/parser.rs — Post-OCR field normalisation.
// Converts raw Tesseract output into clean ParticipantInput fields.

use super::ocr::RawRow;
use crate::participants::ParticipantInput;

const KNOWN_BUSINESS_TYPES: &[&str] = &[
    "Sole proprietor",
    "Partnership",
    "Limited company",
    "Cooperative",
    "Association",
    "Other",
];

/// Convert a RawRow from OCR into a normalised ParticipantInput.
/// Returns None if the name is blank (truly empty row).
pub fn parse_row(raw: RawRow) -> Option<ParticipantInput> {
    let name = normalise_name(&raw.name)?;

    Some(ParticipantInput {
        name,
        business_type: normalise_business_type(&raw.business_type),
        age_category:  normalise_age_category(&raw.age_a_text, &raw.age_b_text),
        gender:        normalise_gender(&raw.gender_m_text, &raw.gender_f_text),
        phone:         normalise_phone(&raw.phone),
        consent:       Some(raw.consent_text.clone()),
    })
}

// ── Field normalisers ─────────────────────────────────────────────────────────

/// Capitalise each word; strip noise characters. Returns None if blank.
fn normalise_name(raw: &str) -> Option<String> {
    let clean: String = raw
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_whitespace() || *c == '\'' || *c == '-')
        .collect();

    let trimmed = clean.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }

    let capitalised = trimmed
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if capitalised.is_empty() { None } else { Some(capitalised) }
}

/// Match OCR output to a known business type using fuzzy string matching.
fn normalise_business_type(raw: &str) -> Option<String> {
    let raw_lower = raw.to_lowercase();
    if raw_lower.trim().is_empty() {
        return None;
    }

    // Exact substring match first (case-insensitive)
    for &bt in KNOWN_BUSINESS_TYPES {
        if raw_lower.contains(&bt.to_lowercase()) {
            return Some(bt.to_string());
        }
    }

    // Abbreviation shortcuts (common OCR patterns)
    if raw_lower.contains("sole") || raw_lower.contains("prop") || raw_lower.starts_with("sp") {
        return Some("Sole proprietor".to_string());
    }
    if raw_lower.contains("part") {
        return Some("Partnership".to_string());
    }
    if raw_lower.contains("ltd") || raw_lower.contains("limited") || raw_lower.contains("llc") {
        return Some("Limited company".to_string());
    }
    if raw_lower.contains("coop") {
        return Some("Cooperative".to_string());
    }
    if raw_lower.contains("assoc") {
        return Some("Association".to_string());
    }

    // Keep the raw value (staff will correct it)
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

/// Determine age category from two single-character cells (A column, B column).
/// A = Above 35, B = Below 35.
fn normalise_age_category(age_a: &str, age_b: &str) -> Option<String> {
    let has_a_mark = is_marked(age_a);
    let has_b_mark = is_marked(age_b);

    match (has_a_mark, has_b_mark) {
        (true,  false) => Some("A".to_string()),
        (false, true)  => Some("B".to_string()),
        (true,  true)  => Some("B".to_string()), // ambiguous — default to B (more common)
        (false, false) => None,
    }
}

/// Determine gender from M and F single-character cells.
fn normalise_gender(gender_m: &str, gender_f: &str) -> Option<String> {
    let has_m = is_marked(gender_m);
    let has_f = is_marked(gender_f);

    // Also check if the raw text directly says M or F
    let m_text = gender_m.trim().to_uppercase();
    let f_text = gender_f.trim().to_uppercase();

    if has_m || m_text.starts_with('M') || m_text == "MALE" {
        Some("M".to_string())
    } else if has_f || f_text.starts_with('F') || f_text == "FEMALE" {
        Some("F".to_string())
    } else {
        None
    }
}

/// Normalise a Kenyan phone number.
/// Strips spaces and dashes; validates format.
fn normalise_phone(raw: &str) -> Option<String> {
    let digits_only: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();

    if digits_only.is_empty() {
        return None;
    }

    // Validate Kenyan formats: 07xx, 01xx, +2547xx, 2547xx
    let valid = if digits_only.starts_with("07") && digits_only.len() == 10 {
        true
    } else if digits_only.starts_with("01") && digits_only.len() == 10 {
        true
    } else if digits_only.starts_with("+2547") && digits_only.len() == 13 {
        true
    } else if digits_only.starts_with("2547") && digits_only.len() == 12 {
        true
    } else if digits_only.len() >= 9 {
        true // accept anything with 9+ digits even if not matching exactly (staff will correct)
    } else {
        false
    };

    if valid { Some(digits_only) } else { None }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Determine if a single-character OCR cell contains a mark (tick, cross, letter, etc.)
fn is_marked(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.is_empty() {
        return false;
    }
    // Any non-whitespace character that isn't just noise counts as a mark
    let non_space: String = t.chars().filter(|c| !c.is_whitespace()).collect();
    !non_space.is_empty() && non_space != "." && non_space != "_"
}
