// scan/http.rs — Shared curl-based POST helper for AI provider calls.
//
// Why curl via subprocess instead of a Rust HTTP client (reqwest etc)?
// Avoids pulling in a full TLS stack (openssl/rustls + their build
// dependencies) purely for occasional API calls — keeps the compiled
// binary smaller and avoids TLS-related build issues on Windows.
//
// Two efficiency fixes applied here (both were previously missing):
//   1. Request body is piped via stdin ("--data @-") instead of being
//      written to a temp file on disk. Eliminates one disk write + one
//      disk read + one delete per API call — meaningful on older/HDD
//      field laptops, and removes any temp-folder permission risk.
//   2. The blocking subprocess call is wrapped in `spawn_blocking` so it
//      runs on Tokio's dedicated blocking thread pool instead of stalling
//      whichever async worker thread handled the Tauri command. Without
//      this, concurrent batch-scan workers could starve each other and
//      the rest of the app's async runtime for the full curl duration.

use anyhow::{anyhow, Context, Result};
use std::io::Write;
use std::process::{Command, Stdio};

/// POST a JSON body to `url` with the given headers, returning the raw
/// response body as a String. Body is streamed via stdin, never touches
/// disk, and the blocking subprocess runs off the async runtime's thread.
pub async fn post_json(
    url: String,
    headers: Vec<(String, String)>,
    json_body: String,
    timeout_secs: u32,
) -> Result<String> {
    tokio::task::spawn_blocking(move || run_curl(url, headers, json_body, timeout_secs))
        .await
        .map_err(|e| anyhow!("Blocking HTTP task panicked: {}", e))?
}

fn run_curl(
    url: String,
    headers: Vec<(String, String)>,
    json_body: String,
    timeout_secs: u32,
) -> Result<String> {
    // Windows' bundled curl.exe uses the OS certificate store (SChannel) by
    // default and needs no --cacert flag. These paths only matter on Linux
    // distros that ship curl built against OpenSSL without a baked-in bundle.
    let ca = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/ca-bundle.pem",
        "/usr/share/ca-certificates/ca-bundle.crt",
    ]
    .iter()
    .find(|p| std::path::Path::new(p).exists())
    .map(|s| s.to_string());

    let mut args: Vec<String> = vec![
        "--silent".into(),
        "--fail-with-body".into(),
        "--max-time".into(), timeout_secs.to_string(),
        "-X".into(), "POST".into(),
    ];
    for (k, v) in &headers {
        args.push("-H".into());
        args.push(format!("{}: {}", k, v));
    }
    // Read the request body from stdin — no temp file needed.
    args.push("--data".into());
    args.push("@-".into());
    if let Some(ca_path) = ca {
        args.push("--cacert".into());
        args.push(ca_path);
    }
    args.push(url);

    let mut child = Command::new("curl")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("curl not found. Install curl or ensure it's on PATH.")?;

    {
        let stdin = child.stdin.as_mut()
            .ok_or_else(|| anyhow!("Failed to open curl stdin"))?;
        stdin.write_all(json_body.as_bytes())
            .context("Failed to write request body to curl")?;
        // stdin is dropped/closed at end of this block, signalling EOF to curl.
    }

    let output = child.wait_with_output()
        .context("Failed waiting for curl to finish")?;

    let response = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try to surface the provider's own JSON error message if present —
        // callers pattern-match on this (e.g. RESOURCE_EXHAUSTED, 401).
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&response) {
            if let Some(msg) = v.pointer("/error/message").and_then(serde_json::Value::as_str) {
                anyhow::bail!("{}", msg);
            }
        }
        anyhow::bail!("curl error ({}): {}", output.status, stderr.trim());
    }

    if response.is_empty() {
        anyhow::bail!("Empty response from server");
    }

    Ok(response)
}
