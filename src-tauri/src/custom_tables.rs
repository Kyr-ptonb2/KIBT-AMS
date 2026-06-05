// custom_tables.rs — Dynamic user-defined tables.
//
// A "custom table" is a named collection of rows with user-defined columns.
// Optionally linked to an event. Admins create them; anyone can view.
//
// Data is stored in two meta-tables (not in dynamic SQL tables — safer and
// portable):
//   custom_table_defs    — table name, description, column schema, event link
//   custom_table_rows    — rows as JSON blobs keyed by table id
//
// This avoids the complexity and security risk of dynamic DDL while giving
// the same UX.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub col_type: String,   // "text" | "number" | "date" | "boolean"
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableDef {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub columns: Vec<ColumnDef>,   // serialised as JSON in DB
    pub event_id: Option<String>,
    pub event_title: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub row_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableRow {
    pub id: String,
    pub table_id: String,
    pub data: serde_json::Value,   // { col_name: value }
    pub added_at: String,
    pub added_by: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableInput {
    pub name: String,
    pub description: Option<String>,
    pub columns: Vec<ColumnDef>,
    pub event_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRowsInput {
    pub table_id: String,
    pub rows: Vec<serde_json::Value>,   // each is { col_name: value }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickListInput {
    pub name: String,
    pub description: Option<String>,
    pub event_id: Option<String>,
    /// Raw text — one item per line, or comma-separated, or JSON array
    pub raw_text: String,
    /// Column name for the single "item" column (e.g. "Name", "Product", "ID")
    pub column_name: Option<String>,
}

// ── DB init (called from db.rs) ───────────────────────────────────────────────

pub fn init_custom_tables(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS custom_table_defs (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            columns_json TEXT NOT NULL DEFAULT '[]',
            event_id    TEXT REFERENCES events(id) ON DELETE SET NULL,
            created_by  TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS custom_table_rows (
            id          TEXT PRIMARY KEY,
            table_id    TEXT NOT NULL REFERENCES custom_table_defs(id) ON DELETE CASCADE,
            data_json   TEXT NOT NULL DEFAULT '{}',
            added_by    TEXT,
            added_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ct_rows_table_id ON custom_table_rows(table_id);
        CREATE INDEX IF NOT EXISTS idx_ct_defs_event_id ON custom_table_defs(event_id);
    "#)?;
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// List all custom table definitions (with row counts).
#[tauri::command]
pub fn get_custom_tables(
    state: State<'_, AppDataDir>,
) -> Result<Vec<CustomTableDef>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(r#"
        SELECT d.id, d.name, d.description, d.columns_json,
               d.event_id, e.title, d.created_by, d.created_at,
               COUNT(r.id) AS row_count
        FROM custom_table_defs d
        LEFT JOIN events e ON e.id = d.event_id
        LEFT JOIN custom_table_rows r ON r.table_id = d.id
        GROUP BY d.id
        ORDER BY d.created_at DESC
    "#).map_err(|e| e.to_string())?;

    let defs = stmt.query_map([], |row| {
        Ok((
            row.get::<_,String>(0)?, row.get::<_,String>(1)?,
            row.get::<_,Option<String>>(2)?, row.get::<_,String>(3)?,
            row.get::<_,Option<String>>(4)?, row.get::<_,Option<String>>(5)?,
            row.get::<_,String>(6)?, row.get::<_,String>(7)?,
            row.get::<_,i64>(8)?,
        ))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(id, name, description, cols_json, event_id, event_title, created_by, created_at, row_count)| {
        let columns: Vec<ColumnDef> = serde_json::from_str(&cols_json).unwrap_or_default();
        CustomTableDef { id, name, description, columns, event_id, event_title, created_by, created_at, row_count }
    })
    .collect();

    Ok(defs)
}

/// Get a single custom table definition.
#[tauri::command]
pub fn get_custom_table(
    state: State<'_, AppDataDir>,
    table_id: String,
) -> Result<CustomTableDef, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let row = conn.query_row(r#"
        SELECT d.id, d.name, d.description, d.columns_json,
               d.event_id, e.title, d.created_by, d.created_at,
               (SELECT COUNT(*) FROM custom_table_rows WHERE table_id = d.id)
        FROM custom_table_defs d
        LEFT JOIN events e ON e.id = d.event_id
        WHERE d.id = ?1
    "#, params![table_id], |row| {
        Ok((
            row.get::<_,String>(0)?, row.get::<_,String>(1)?,
            row.get::<_,Option<String>>(2)?, row.get::<_,String>(3)?,
            row.get::<_,Option<String>>(4)?, row.get::<_,Option<String>>(5)?,
            row.get::<_,String>(6)?, row.get::<_,String>(7)?,
            row.get::<_,i64>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    let columns: Vec<ColumnDef> = serde_json::from_str(&row.3).unwrap_or_default();
    Ok(CustomTableDef {
        id: row.0, name: row.1, description: row.2, columns,
        event_id: row.4, event_title: row.5, created_by: row.6,
        created_at: row.7, row_count: row.8,
    })
}

/// Create a new custom table definition.
#[tauri::command]
pub fn create_custom_table(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: CreateTableInput,
) -> Result<CustomTableDef, String> {
    require_admin(&auth)?;
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;

    if input.name.trim().is_empty() { return Err("Table name is required.".into()); }
    if input.columns.is_empty()     { return Err("At least one column is required.".into()); }
    for col in &input.columns {
        if col.name.trim().is_empty() { return Err("All columns must have a name.".into()); }
    }

    let id          = Uuid::new_v4().to_string();
    let now         = chrono::Utc::now().to_rfc3339();
    let cols_json   = serde_json::to_string(&input.columns).map_err(|e| e.to_string())?;

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO custom_table_defs (id, name, description, columns_json, event_id, created_by, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, input.name.trim(), input.description, cols_json, input.event_id, session.username, now],
    ).map_err(|e| e.to_string())?;

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "custom_table.create", "custom_table", Some(&id), Some(input.name.trim()), None);

    Ok(CustomTableDef {
        id, name: input.name.trim().to_string(), description: input.description,
        columns: input.columns, event_id: input.event_id, event_title: None,
        created_by: session.username, created_at: now, row_count: 0,
    })
}

/// Update a table's name, description, or event link (not columns — that would break data).
#[tauri::command]
pub fn update_custom_table(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    table_id: String,
    name: String,
    description: Option<String>,
    event_id: Option<String>,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;
    if name.trim().is_empty() { return Err("Table name is required.".into()); }

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute(
        "UPDATE custom_table_defs SET name=?1, description=?2, event_id=?3 WHERE id=?4",
        params![name.trim(), description, event_id, table_id],
    ).map_err(|e| e.to_string())?;

    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "custom_table.update", "custom_table", Some(&table_id), Some(name.trim()), None);
    }
    Ok(rows > 0)
}

/// Delete a custom table and all its rows.
#[tauri::command]
pub fn delete_custom_table(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    table_id: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute("DELETE FROM custom_table_defs WHERE id=?1", params![table_id])
        .map_err(|e| e.to_string())?;
    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "custom_table.delete", "custom_table", Some(&table_id), None, None);
    }
    Ok(rows > 0)
}

/// Get all rows for a custom table.
#[tauri::command]
pub fn get_custom_table_rows(
    state: State<'_, AppDataDir>,
    table_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<CustomTableRow>, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(1000).min(10000);
    let off = offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT id, table_id, data_json, added_at, added_by
         FROM custom_table_rows WHERE table_id=?1
         ORDER BY added_at ASC LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![table_id, lim, off], |r| {
        Ok((
            r.get::<_,String>(0)?, r.get::<_,String>(1)?,
            r.get::<_,String>(2)?, r.get::<_,String>(3)?,
            r.get::<_,Option<String>>(4)?,
        ))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(id, table_id, data_json, added_at, added_by)| {
        let data = serde_json::from_str(&data_json).unwrap_or(serde_json::Value::Object(Default::default()));
        CustomTableRow { id, table_id, data, added_at, added_by }
    })
    .collect();

    Ok(rows)
}

/// Insert or replace rows in a custom table.
#[tauri::command]
pub fn upsert_custom_table_rows(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: UpsertRowsInput,
) -> Result<usize, String> {
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;
    let mut conn = open(&state.0).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx  = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0usize;

    for row_data in &input.rows {
        // Skip entirely empty rows
        if let serde_json::Value::Object(ref map) = row_data {
            if map.values().all(|v| v.as_str().map(|s| s.trim().is_empty()).unwrap_or(false)) {
                continue;
            }
        }
        let id       = Uuid::new_v4().to_string();
        let data_str = serde_json::to_string(row_data).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO custom_table_rows (id, table_id, data_json, added_by, added_at)
             VALUES (?1,?2,?3,?4,?5)",
            params![id, input.table_id, data_str, session.username, now],
        ).map_err(|e| e.to_string())?;
        count += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "custom_table.rows_added", "custom_table", Some(&input.table_id),
        Some(&format!("{} rows", count)), None);
    Ok(count)
}

/// Update a single row's data.
#[tauri::command]
pub fn update_custom_table_row(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    row_id: String,
    data: serde_json::Value,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let data_str = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute(
        "UPDATE custom_table_rows SET data_json=?1 WHERE id=?2",
        params![data_str, row_id],
    ).map_err(|e| e.to_string())?;
    Ok(rows > 0)
}

/// Delete a single row.
#[tauri::command]
pub fn delete_custom_table_row(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    row_id: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute("DELETE FROM custom_table_rows WHERE id=?1", params![row_id])
        .map_err(|e| e.to_string())?;
    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "custom_table.row_delete", "custom_table", Some(&row_id), None, None);
    }
    Ok(rows > 0)
}

/// Quick-create: paste a plain list → auto-creates a 1-column table + rows.
/// Accepts: one item per line, or comma-separated items, or JSON array.
#[tauri::command]
pub fn create_from_list(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: QuickListInput,
) -> Result<CustomTableDef, String> {
    require_admin(&auth)?;
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;

    if input.name.trim().is_empty()     { return Err("Table name is required.".into()); }
    if input.raw_text.trim().is_empty() { return Err("List is empty.".into()); }

    let col_name = input.column_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Item")
        .trim()
        .to_string();

    // Parse the raw text into items
    let items = parse_list(&input.raw_text);
    if items.is_empty() { return Err("No items found in the list.".into()); }

    let col = ColumnDef { name: col_name.clone(), col_type: "text".into(), required: true };
    let columns = vec![col];
    let cols_json = serde_json::to_string(&columns).map_err(|e| e.to_string())?;

    let id  = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let mut conn = open(&state.0).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO custom_table_defs (id, name, description, columns_json, event_id, created_by, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, input.name.trim(), input.description, cols_json, input.event_id, session.username, now],
    ).map_err(|e| e.to_string())?;

    for item in &items {
        let row_id   = Uuid::new_v4().to_string();
        let data_val = serde_json::json!({ &col_name: item });
        let data_str = serde_json::to_string(&data_val).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO custom_table_rows (id, table_id, data_json, added_by, added_at) VALUES (?1,?2,?3,?4,?5)",
            params![row_id, id, data_str, session.username, now],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "custom_table.create_from_list", "custom_table", Some(&id),
        Some(&format!("{} ({} items)", input.name.trim(), items.len())), None);

    Ok(CustomTableDef {
        id, name: input.name.trim().to_string(), description: input.description,
        columns, event_id: input.event_id, event_title: None,
        created_by: session.username, created_at: now, row_count: items.len() as i64,
    })
}

/// Export a custom table as CSV string (caller saves the file via dialog).
#[tauri::command]
pub fn export_custom_table_csv(
    state: State<'_, AppDataDir>,
    _auth: State<'_, AuthState>,
    table_id: String,
    path: String,
) -> Result<bool, String> {
    let def = get_custom_table(state.clone(), table_id.clone())?;
    let rows = get_custom_table_rows(state.clone(), table_id, None, None)?;

    let mut csv = String::new();

    // Header row
    let header_cols: Vec<String> = def.columns.iter().map(|c| csv_escape(&c.name)).collect();
    csv.push_str(&header_cols.join(","));
    csv.push('\n');

    // Data rows
    for row in &rows {
        let vals: Vec<String> = def.columns.iter().map(|col| {
            let v = row.data.get(&col.name)
                .or_else(|| row.data.get(&col.name.to_lowercase()))
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b)   => b.to_string(),
                    serde_json::Value::Null       => String::new(),
                    other                         => other.to_string(),
                })
                .unwrap_or_default();
            csv_escape(&v)
        }).collect();
        csv.push_str(&vals.join(","));
        csv.push('\n');
    }

    std::fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Export custom table as Excel.
#[tauri::command]
pub fn export_custom_table_excel(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    table_id: String,
    path: String,
) -> Result<bool, String> {
    use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};

    let def  = get_custom_table(state.clone(), table_id.clone())?;
    let rows = get_custom_table_rows(state.clone(), table_id, None, None)?;

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let safe_name = def.name.chars().take(31).collect::<String>(); // Excel 31-char limit
    sheet.set_name(&safe_name).ok();

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1a6b3c))
        .set_font_color(Color::White)
        .set_border(FormatBorder::Thin);
    let cell_fmt = Format::new().set_border(FormatBorder::Thin);

    // Headers
    for (col_idx, col) in def.columns.iter().enumerate() {
        sheet.write_with_format(0, col_idx as u16, col.name.as_str(), &header_fmt).ok();
    }
    sheet.write_with_format(0, def.columns.len() as u16, "Added At", &header_fmt).ok();

    // Rows
    for (row_idx, row) in rows.iter().enumerate() {
        let r = (row_idx + 1) as u32;
        for (col_idx, col) in def.columns.iter().enumerate() {
            let v = row.data.get(&col.name)
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b)   => b.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            sheet.write_with_format(r, col_idx as u16, v.as_str(), &cell_fmt).ok();
        }
        sheet.write_with_format(r, def.columns.len() as u16, row.added_at.as_str(), &cell_fmt).ok();
    }

    // Column widths
    for col_idx in 0..=def.columns.len() {
        sheet.set_column_width(col_idx as u16, 22.0).ok();
    }

    workbook.save(&path).map_err(|e| e.to_string())?;

    let session = auth.0.lock().unwrap().clone();
    write_log(&state.0,
        session.as_ref().map(|s| s.id.as_str()),
        session.as_ref().map(|s| s.username.as_str()),
        "custom_table.export", "custom_table", Some(&def.id), Some(&path),
        Some(&format!("{} rows", rows.len())));

    Ok(true)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_list(raw: &str) -> Vec<String> {
    let t = raw.trim();

    // Try JSON array first
    if t.starts_with('[') {
        if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str(t) {
            return arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    // Newline-separated (most common — pasted from Excel/Word)
    if t.contains('\n') {
        return t.lines()
            .map(|l| l.trim().trim_matches(',').trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    // Comma-separated on one line
    t.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
