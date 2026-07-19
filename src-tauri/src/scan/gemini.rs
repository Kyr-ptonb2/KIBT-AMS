// scan/gemini.rs — Gemini API via system curl. Column-detection aware prompt.

use crate::participants::ParticipantInput;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::Value;

const GEMINI_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

/// Alternate model — used as last-resort fallback if the primary model is
/// unavailable (e.g. deprecated, region-restricted, or experiencing an outage).
const GEMINI_URL_ALT: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

/// Result from Gemini: extracted rows + detected column names
pub struct GeminiScanResult {
    pub rows: Vec<ParticipantInput>,
    pub detected_columns: Vec<String>,
}

pub const EXTRACTION_PROMPT: &str = r#"You are extracting attendance data from a Kenya Institute of Business Training (KIBT) attendance register photograph.

STEP 1 — DETECT COLUMNS: Look at the header row and identify EXACTLY which columns exist. Common columns include:
- "Participants' Full Name" or "Name"
- "Gender" or "Gender F/M" or "M/F"
- "Age" or "A=Above 35 / B=Below 35" or "Age Category"
- "Business Type" or "Type of Business"
- "Phone Number" or "Telephone No." or "Tel"
- "Location" or "Area" or "Sub-location"
- "Consent" or "SIGN if you CONSENT"
- "Signature"
- Any other column you find

STEP 2 — EXTRACT ALL DATA ROWS: For every row that has a name written, extract values for ALL detected columns.

STEP 3 — RETURN JSON in this exact format:
{
  "detected_columns": ["list", "of", "column", "names", "found"],
  "rows": [
    {
      "name": "Full Name (required, never null)",
      "gender": "M or F or null",
      "ageCategory": "A or B or null",
      "businessType": "Sole proprietor|Partnership|Limited company|Cooperative|Association|Other or null",
      "phone": "digits only or null",
      "consent": "Yes or No (Yes if any mark/signature, No if blank — null if column absent)",
      "location": "location string or null",
      "extraFields": {"any_other_column_name": "value"}
    }
  ]
}

RULES:
- name: capitalise each word. NEVER return null.
- ageCategory: A = above 35, B = below 35. Detect from tick/checkmark in correct column.
- gender: M/Male/tick-in-M = "M"; F/Female/tick-in-F = "F"
- phone: strip all spaces and dashes, keep leading 0 or +
- consent: if this column does not exist in this form, return null (not "No")
- location: if this column does not exist, return null
- extraFields: put ALL columns not listed above into this object
- Skip blank rows and header rows
- Page 2 rows start at row 10+ — include them all

Return ONLY valid JSON. No markdown, no explanation."#;

#[derive(Serialize)]
struct GeminiRequest { contents: Vec<Content> }
#[derive(Serialize)]
struct Content { parts: Vec<Part> }
#[derive(Serialize)]
#[serde(untagged)]
enum Part {
    Text { text: String },
    InlineData { inline_data: InlineData },
}
#[derive(Serialize)]
struct InlineData { mime_type: String, data: String }

pub async fn scan_with_gemini(
    image_bytes: &[u8],
    api_key: &str,
) -> Result<GeminiScanResult> {
    scan_with_gemini_url(image_bytes, api_key, GEMINI_URL).await
}

/// Same extraction pipeline but against the alternate model — used only when
/// the primary model fails (rate limit, outage, or deprecation).
pub async fn scan_with_gemini_alt_model(
    image_bytes: &[u8],
    api_key: &str,
) -> Result<GeminiScanResult> {
    scan_with_gemini_url(image_bytes, api_key, GEMINI_URL_ALT).await
}

async fn scan_with_gemini_url(
    image_bytes: &[u8],
    api_key: &str,
    model_url: &str,
) -> Result<GeminiScanResult> {
    let mime = detect_mime(image_bytes);
    let b64  = STANDARD.encode(image_bytes);

    let body = GeminiRequest {
        contents: vec![Content { parts: vec![
            Part::InlineData { inline_data: InlineData { mime_type: mime.to_string(), data: b64 } },
            Part::Text { text: EXTRACTION_PROMPT.to_string() },
        ]}],
    };

    let json_body = serde_json::to_string(&body)?;
    let url = format!("{}?key={}", model_url, api_key);

    let response = super::http::post_json(
        url,
        vec![("Content-Type".to_string(), "application/json".to_string())],
        json_body,
        60,
    ).await.map_err(|e| anyhow!("Gemini API: {}", e))?;

    let envelope: Value = serde_json::from_str(&response)
        .context("Failed to parse Gemini response")?;

    if let Some(msg) = envelope.pointer("/error/message").and_then(Value::as_str) {
        anyhow::bail!("Gemini API: {}", msg);
    }

    let text = envelope
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Unexpected Gemini response: {}",
            &response[..200.min(response.len())]))?
        .trim();

    let clean = strip_fences(text);
    parse_output(clean)
}

pub fn parse_output(json_str: &str) -> Result<GeminiScanResult> {
    let start = json_str.find('{').ok_or_else(|| anyhow!("No JSON object in response"))?;
    let end   = json_str.rfind('}').ok_or_else(|| anyhow!("No closing }} in response"))?;
    let v: Value = serde_json::from_str(&json_str[start..=end])
        .context("Failed to parse Gemini JSON")?;

    let detected_columns: Vec<String> = v.get("detected_columns")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();

    let raw_rows = v.get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("No 'rows' array in Gemini response"))?;

    let mut rows = Vec::new();
    for item in raw_rows {
        let name = item.get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let Some(name) = name else { continue };

        // Collect extra fields as JSON string
        let extra = item.get("extraFields")
            .filter(|v| !v.is_null())
            .and_then(|v| if v.as_object().map(|o| o.is_empty()).unwrap_or(true) { None } else { Some(v) })
            .map(|v| v.to_string());

        rows.push(ParticipantInput {
            name,
            business_type: str_field(item, "businessType"),
            age_category:  str_field(item, "ageCategory")
                               .map(|s| s.to_uppercase())
                               .filter(|s| s == "A" || s == "B"),
            gender:        str_field(item, "gender")
                               .map(|s| s.to_uppercase())
                               .filter(|s| s == "M" || s == "F"),
            phone:         str_field(item, "phone"),
            id_number:     str_field(item, "idNumber"),
            consent:       {
                // Only set consent if the column actually existed on the sheet.
                // Absent/null → None so downstream doesn't falsely show "No".
                let raw = item.get("consent");
                match raw {
                    Some(serde_json::Value::Null) | None => None,
                    Some(v) => {
                        let s = v.as_str().unwrap_or("").trim().to_lowercase();
                        if s.is_empty() || s == "null" {
                            None  // column present but blank = no consent recorded
                        } else if s.starts_with('y') || s.contains("sign") || s.contains("yes") {
                            Some("Yes".to_string())
                        } else {
                            Some("No".to_string())
                        }
                    }
                }
            },
            location:      str_field(item, "location"),
            extra_fields:  extra,
        });
    }

    Ok(GeminiScanResult { rows, detected_columns })
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "null")
        .map(str::to_string)
}

pub fn strip_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(x) = s.strip_prefix("```json") { x.strip_suffix("```").unwrap_or(x).trim() }
    else if let Some(x) = s.strip_prefix("```") { x.strip_suffix("```").unwrap_or(x).trim() }
    else { s }
}

pub fn detect_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) { "image/jpeg" }
    else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) { "image/png" }
    else { "image/jpeg" }
}
