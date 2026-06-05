// export.rs — Excel (.xlsx) and CSV export Tauri commands.
// Uses rust_xlsxwriter (pure Rust, no native libs required).

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};
use serde::Deserialize;
use tauri::State;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFilter {
    pub financial_year: Option<String>,
    pub region:         Option<String>,
    pub event_id:       Option<String>,
    pub gender:         Option<String>,
    pub age_category:   Option<String>,
    pub consent:        Option<String>,
}

struct ExportRow {
    event_title: String,
    event_date: String,
    event_region: String,
    event_venue: Option<String>,
    financial_year: String,
    name: String,
    business_type: Option<String>,
    age_category: Option<String>,
    gender: Option<String>,
    phone: Option<String>,
    id_number: Option<String>,
    location: Option<String>,
    extra_fields: Option<String>,
    consent: Option<String>,
    added_at: String,
}

const HEADERS: &[&str] = &[
    "Event Title", "Event Date", "Region", "Venue", "Financial Year",
    "Full Name", "Business Type", "Age Category", "Gender",
    "Phone Number", "National ID", "Location", "Consent", "Extra Fields", "Recorded At",
];

fn fetch_rows(state: &AppDataDir, filter: &ExportFilter) -> Result<Vec<ExportRow>> {
    let conn = open(&state.0)?;

    let mut sql = String::from(r#"
        SELECT e.title, COALESCE(e.start_date, e.created_at) AS date, e.region, e.venue, e.financial_year,
               p.name, p.business_type, p.age_category, p.gender, p.phone, p.id_number,
               p.location, p.extra_fields, p.consent, p.added_at
        FROM participants p
        JOIN events e ON e.id = p.event_id
        WHERE 1=1
    "#);
    let mut bind_vals: Vec<String> = Vec::new();

    if let Some(ref fy) = filter.financial_year {
        sql.push_str(" AND e.financial_year = ?");
        bind_vals.push(fy.clone());
    }
    if let Some(ref r) = filter.region {
        sql.push_str(" AND e.region = ?");
        bind_vals.push(r.clone());
    }
    if let Some(ref eid) = filter.event_id {
        sql.push_str(" AND e.id = ?");
        bind_vals.push(eid.clone());
    }
    if let Some(ref g) = filter.gender {
        sql.push_str(" AND p.gender = ?");
        bind_vals.push(g.clone());
    }
    if let Some(ref ac) = filter.age_category {
        sql.push_str(" AND p.age_category = ?");
        bind_vals.push(ac.clone());
    }
    if let Some(ref c) = filter.consent {
        sql.push_str(" AND p.consent = ?");
        bind_vals.push(c.clone());
    }
    sql.push_str(" ORDER BY COALESCE(e.start_date, e.created_at) DESC, e.id, p.added_at");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(bind_vals.iter()), |row| {
            Ok(ExportRow {
                event_title:    row.get(0)?,
                event_date:     row.get(1)?,
                event_region:   row.get(2)?,
                event_venue:    row.get(3)?,
                financial_year: row.get(4)?,
                name:           row.get(5)?,
                business_type:  row.get(6)?,
                age_category:   row.get(7)?,
                gender:         row.get(8)?,
                phone:          row.get(9)?,
                id_number:      row.get(10)?,
                location:       row.get(11)?,
                extra_fields:   row.get(12)?,
                consent:        row.get(13)?,
                added_at:       row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Export filtered data as a formatted Excel (.xlsx) file.
#[tauri::command]
pub fn export_excel(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    filter: ExportFilter,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let rows = fetch_rows(&state, &filter).map_err(|e| e.to_string())?;

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Participants").map_err(|e| e.to_string())?;

    // ── Formats ───────────────────────────────────────────────────────────────
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1a6b3c))
        .set_font_color(Color::White)
        .set_border(FormatBorder::Thin);

    let cell_fmt = Format::new()
        .set_border(FormatBorder::Thin);

    // ── Headers ───────────────────────────────────────────────────────────────
    for (col, &header) in HEADERS.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, header, &header_fmt)
            .map_err(|e| e.to_string())?;
    }

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (row_idx, row) in rows.iter().enumerate() {
        let r = (row_idx + 1) as u32;
        let cols: &[&str] = &[
            &row.event_title,
            &row.event_date,
            &row.event_region,
            row.event_venue.as_deref().unwrap_or(""),
            &row.financial_year,
            &row.name,
            row.business_type.as_deref().unwrap_or(""),
            row.age_category.as_deref().unwrap_or(""),
            row.gender.as_deref().unwrap_or(""),
            row.phone.as_deref().unwrap_or(""),
            row.id_number.as_deref().unwrap_or(""),
            row.location.as_deref().unwrap_or(""),
            row.consent.as_deref().unwrap_or(""),
            row.extra_fields.as_deref().unwrap_or(""),
            &row.added_at,
        ];
        for (col, &val) in cols.iter().enumerate() {
            sheet
                .write_with_format(r, col as u16, val, &cell_fmt)
                .map_err(|e| e.to_string())?;
        }
    }

    // ── Column widths ─────────────────────────────────────────────────────────
    let widths = [30.0_f64, 14.0, 16.0, 20.0, 14.0, 30.0, 20.0, 14.0, 10.0, 18.0, 16.0, 15.0, 10.0, 15.0, 14.0];
    for (col, &w) in widths.iter().enumerate() {
        sheet.set_column_width(col as u16, w).map_err(|e| e.to_string())?;
    }

    workbook.save(&path).map_err(|e| e.to_string())?;
    let (actor_id, actor_name) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "export.excel", "export", None, Some(&path),
        Some(&format!("{} rows", rows.len())));
    Ok(true)
}

/// Export filtered data as a plain CSV file.
#[tauri::command]
pub fn export_csv(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    filter: ExportFilter,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let rows = fetch_rows(&state, &filter).map_err(|e| e.to_string())?;

    let mut csv = String::new();
    csv.push_str(&HEADERS.join(","));
    csv.push('\n');

    for row in &rows {
        let fields: &[&str] = &[
            &row.event_title,
            &row.event_date,
            &row.event_region,
            row.event_venue.as_deref().unwrap_or(""),
            &row.financial_year,
            &row.name,
            row.business_type.as_deref().unwrap_or(""),
            row.age_category.as_deref().unwrap_or(""),
            row.gender.as_deref().unwrap_or(""),
            row.phone.as_deref().unwrap_or(""),
            row.id_number.as_deref().unwrap_or(""),
            row.location.as_deref().unwrap_or(""),
            row.consent.as_deref().unwrap_or(""),
            row.extra_fields.as_deref().unwrap_or(""),
            &row.added_at,
        ];
        let escaped: Vec<String> = fields
            .iter()
            .map(|f| {
                if f.contains(',') || f.contains('"') || f.contains('\n') {
                    format!("\"{}\"", f.replace('"', "\"\""))
                } else {
                    f.to_string()
                }
            })
            .collect();
        csv.push_str(&escaped.join(","));
        csv.push('\n');
    }

    std::fs::write(&path, csv).map_err(|e| e.to_string())?;
    let (actor_id2, actor_name2) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id2.as_deref(), actor_name2.as_deref(),
        "export.csv", "export", None, Some(&path),
        Some(&format!("{} rows", rows.len())));
    Ok(true)
}
