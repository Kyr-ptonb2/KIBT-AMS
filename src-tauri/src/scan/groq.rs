// scan/groq.rs — Groq API fallback (free tier, no credit card required).
// Uses Llama 3.2 Vision (11B) via Groq's OpenAI-compatible chat completions endpoint.
// Same extraction contract as gemini.rs — returns GeminiScanResult so callers
// don't need to know which provider actually served the request.

use super::gemini::{GeminiScanResult, EXTRACTION_PROMPT};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::Value;

const GROQ_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL: &str = "llama-3.2-11b-vision-preview";

#[derive(Serialize)]
struct GroqRequest {
    model: String,
    messages: Vec<GroqMessage>,
    temperature: f32,
    response_format: GroqResponseFormat,
}
#[derive(Serialize)]
struct GroqResponseFormat { #[serde(rename = "type")] kind: String }
#[derive(Serialize)]
struct GroqMessage { role: String, content: Vec<GroqContent> }
#[derive(Serialize)]
#[serde(untagged)]
enum GroqContent {
    Text { r#type: String, text: String },
    Image { r#type: String, image_url: GroqImageUrl },
}
#[derive(Serialize)]
struct GroqImageUrl { url: String }

pub async fn scan_with_groq(image_bytes: &[u8], api_key: &str) -> Result<GeminiScanResult> {
    let mime = super::gemini::detect_mime(image_bytes);
    let b64  = STANDARD.encode(image_bytes);
    let data_url = format!("data:{};base64,{}", mime, b64);

    let body = GroqRequest {
        model: GROQ_MODEL.to_string(),
        temperature: 0.1,
        response_format: GroqResponseFormat { kind: "json_object".into() },
        messages: vec![GroqMessage {
            role: "user".into(),
            content: vec![
                GroqContent::Text { r#type: "text".into(), text: EXTRACTION_PROMPT.to_string() },
                GroqContent::Image { r#type: "image_url".into(), image_url: GroqImageUrl { url: data_url } },
            ],
        }],
    };

    let json_body = serde_json::to_string(&body)?;

    let response = super::http::post_json(
        GROQ_URL.to_string(),
        vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Authorization".to_string(), format!("Bearer {}", api_key)),
        ],
        json_body,
        60,
    ).await.map_err(|e| anyhow!("Groq API: {}", e))?;

    let envelope: Value = serde_json::from_str(&response)
        .context("Failed to parse Groq response")?;

    if let Some(msg) = envelope.pointer("/error/message").and_then(Value::as_str) {
        anyhow::bail!("Groq API: {}", msg);
    }

    let text = envelope
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Unexpected Groq response: {}",
            &response[..200.min(response.len())]))?
        .trim();

    let clean = super::gemini::strip_fences(text);
    super::gemini::parse_output(clean)
}
