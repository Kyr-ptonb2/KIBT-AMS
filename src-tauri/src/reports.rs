// reports.rs — Annual statistical report generation via SQL aggregation,
// plus Excel/CSV export of that summary (regions, events, business types)
// as distinct from the participant-level export in export.rs.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rusqlite::params;
use rust_xlsxwriter::{Color, Format, FormatBorder, FormatAlign, Workbook};
use serde::Serialize;
use tauri::State;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportData {
    pub financial_year: String,
    pub total_participants: i64,
    pub total_events: i64,
    pub active_regions: i64,
    pub male_count: i64,
    pub female_count: i64,
    pub consent_count: i64,
    pub age_a_count: i64,   // Above 35
    pub age_b_count: i64,   // Below 35
    pub regions: Vec<RegionSummary>,
    pub business_types: Vec<BusinessTypeSummary>,
    pub events: Vec<EventSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSummary {
    pub region: String,
    pub events: i64,
    pub participants: i64,
    pub male: i64,
    pub female: i64,
    pub consent: i64,
    pub age_a: i64,
    pub age_b: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessTypeSummary {
    pub business_type: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSummary {
    pub id: String,
    pub title: String,
    pub start_date: String,
    pub region: String,
    pub venue: Option<String>,
    pub participant_count: i64,
}

// ── Shared data fetch ────────────────────────────────────────────────────────

/// Build the full annual report for a given financial year. Shared by the
/// `get_report` UI command and the Excel/CSV summary export commands below,
/// so the export always matches exactly what's shown on the Reports page.
fn fetch_report(state: &AppDataDir, financial_year: &str) -> Result<ReportData, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // ── Totals ────────────────────────────────────────────────────────────────
    let totals: (i64, i64, i64, i64, i64, i64, i64, i64) = conn
        .query_row(
            r#"
            SELECT
                COUNT(p.id)                                          AS total_participants,
                COUNT(DISTINCT e.id)                                 AS total_events,
                COUNT(DISTINCT e.region)                             AS active_regions,
                SUM(CASE WHEN p.gender = 'M' THEN 1 ELSE 0 END)     AS male_count,
                SUM(CASE WHEN p.gender = 'F' THEN 1 ELSE 0 END)     AS female_count,
                SUM(CASE WHEN p.consent = 'Yes' THEN 1 ELSE 0 END)  AS consent_count,
                SUM(CASE WHEN p.age_category = 'A' THEN 1 ELSE 0 END) AS age_a,
                SUM(CASE WHEN p.age_category = 'B' THEN 1 ELSE 0 END) AS age_b
            FROM participants p
            JOIN events e ON e.id = p.event_id
            WHERE e.financial_year = ?1
            "#,
            params![financial_year],
            |row| Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            )),
        )
        .map_err(|e| e.to_string())?;

    // ── Per-region breakdown ───────────────────────────────────────────────────
    let mut stmt = conn
        .prepare(r#"
            SELECT
                e.region,
                COUNT(DISTINCT e.id)                                 AS events,
                COUNT(p.id)                                          AS participants,
                SUM(CASE WHEN p.gender = 'M' THEN 1 ELSE 0 END)     AS male,
                SUM(CASE WHEN p.gender = 'F' THEN 1 ELSE 0 END)     AS female,
                SUM(CASE WHEN p.consent = 'Yes' THEN 1 ELSE 0 END)  AS consent,
                SUM(CASE WHEN p.age_category = 'A' THEN 1 ELSE 0 END) AS age_a,
                SUM(CASE WHEN p.age_category = 'B' THEN 1 ELSE 0 END) AS age_b
            FROM events e
            LEFT JOIN participants p ON p.event_id = e.id
            WHERE e.financial_year = ?1
            GROUP BY e.region
            ORDER BY participants DESC
        "#)
        .map_err(|e| e.to_string())?;

    let regions = stmt
        .query_map(params![financial_year], |row| {
            Ok(RegionSummary {
                region: row.get(0)?,
                events: row.get(1)?,
                participants: row.get(2)?,
                male: row.get(3)?,
                female: row.get(4)?,
                consent: row.get(5)?,
                age_a: row.get(6)?,
                age_b: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // ── Business type frequency ────────────────────────────────────────────────
    let mut stmt2 = conn
        .prepare(r#"
            SELECT
                COALESCE(p.business_type, 'Unknown') AS business_type,
                COUNT(*) AS cnt
            FROM participants p
            JOIN events e ON e.id = p.event_id
            WHERE e.financial_year = ?1
            GROUP BY p.business_type
            ORDER BY cnt DESC
        "#)
        .map_err(|e| e.to_string())?;

    let business_types = stmt2
        .query_map(params![financial_year], |row| {
            Ok(BusinessTypeSummary {
                business_type: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // ── Event list with participant counts ─────────────────────────────────────
    let mut stmt3 = conn
        .prepare(r#"
            SELECT e.id, e.title, COALESCE(e.start_date, e.created_at) AS date, e.region, e.venue, COUNT(p.id)
            FROM events e
            LEFT JOIN participants p ON p.event_id = e.id
            WHERE e.financial_year = ?1
            GROUP BY e.id
            ORDER BY COALESCE(e.start_date, e.created_at) DESC
        "#)
        .map_err(|e| e.to_string())?;

    let events = stmt3
        .query_map(params![financial_year], |row| {
            Ok(EventSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                start_date: row.get(2)?,
                region: row.get(3)?,
                venue: row.get(4)?,
                participant_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ReportData {
        financial_year: financial_year.to_string(),
        total_participants: totals.0,
        total_events: totals.1,
        active_regions: totals.2,
        male_count: totals.3,
        female_count: totals.4,
        consent_count: totals.5,
        age_a_count: totals.6,
        age_b_count: totals.7,
        regions,
        business_types,
        events,
    })
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Generate the full annual report for a given financial year (used by the
/// Reports page in the UI).
#[tauri::command]
pub fn get_report(
    state: State<'_, AppDataDir>,
    financial_year: String,
) -> Result<ReportData, String> {
    fetch_report(&state, &financial_year)
}

/// Export the annual summary report (headline totals, per-region breakdown,
/// business type frequency, and the full event list with dates/venues) to
/// Excel. This is distinct from export::export_excel, which exports raw
/// per-participant rows — this is the aggregated, "one page per FY" view
/// seen on the Reports screen.
#[tauri::command]
pub fn export_report_excel(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    financial_year: String,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let report = fetch_report(&state, &financial_year)?;

    let mut workbook = Workbook::new();

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14)
        .set_background_color(Color::RGB(0x1a6b3c))
        .set_font_color(Color::White)
        .set_align(FormatAlign::VerticalCenter);

    let label_fmt = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0x1a6b3c))
        .set_background_color(Color::RGB(0xeaf5ee));

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1a6b3c))
        .set_font_color(Color::White)
        .set_border(FormatBorder::Thin);

    let cell_fmt = Format::new().set_border(FormatBorder::Thin);
    let cell_alt_fmt = Format::new().set_border(FormatBorder::Thin).set_background_color(Color::RGB(0xf8fafc));

    // ── Sheet 1: Overview ───────────────────────────────────────────────────
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Overview").map_err(|e| e.to_string())?;
        sheet.merge_range(0, 0, 0, 3,
            &format!("KIBT Annual Report — FY {}", report.financial_year), &title_fmt)
            .map_err(|e| e.to_string())?;
        sheet.set_row_height(0, 24).map_err(|e| e.to_string())?;

        let stats: Vec<(&str, i64)> = vec![
            ("Total Participants", report.total_participants),
            ("Training Events", report.total_events),
            ("Active Regions", report.active_regions),
            ("Consented", report.consent_count),
            ("Male", report.male_count),
            ("Female", report.female_count),
            ("Age Category A (Above 35)", report.age_a_count),
            ("Age Category B (Below 35)", report.age_b_count),
        ];
        let mut r: u32 = 2;
        for (label, value) in &stats {
            sheet.write_with_format(r, 0, *label, &label_fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 1, *value as f64, &cell_fmt).map_err(|e| e.to_string())?;
            r += 1;
        }
        sheet.set_column_width(0, 28.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(1, 14.0).map_err(|e| e.to_string())?;
    }

    // ── Sheet 2: Regional breakdown ─────────────────────────────────────────
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("By Region").map_err(|e| e.to_string())?;
        let headers = ["Region", "Events", "Participants", "Male", "Female", "Cat. A", "Cat. B", "Consented"];
        for (c, h) in headers.iter().enumerate() {
            sheet.write_with_format(0, c as u16, *h, &header_fmt).map_err(|e| e.to_string())?;
        }
        for (i, reg) in report.regions.iter().enumerate() {
            let r = (i + 1) as u32;
            let fmt = if i % 2 == 1 { &cell_alt_fmt } else { &cell_fmt };
            sheet.write_with_format(r, 0, &reg.region, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 1, reg.events as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 2, reg.participants as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 3, reg.male as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 4, reg.female as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 5, reg.age_a as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 6, reg.age_b as f64, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 7, reg.consent as f64, fmt).map_err(|e| e.to_string())?;
        }
        let total_row = (report.regions.len() + 1) as u32;
        sheet.write_with_format(total_row, 0, "TOTAL", &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 1, report.total_events as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 2, report.total_participants as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 3, report.male_count as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 4, report.female_count as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 5, report.age_a_count as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 6, report.age_b_count as f64, &label_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(total_row, 7, report.consent_count as f64, &label_fmt).map_err(|e| e.to_string())?;
        for c in 0..8 { sheet.set_column_width(c, 16.0).map_err(|e| e.to_string())?; }
        sheet.set_column_width(0, 22.0).map_err(|e| e.to_string())?;
    }

    // ── Sheet 3: Business types ─────────────────────────────────────────────
    if !report.business_types.is_empty() {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Business Types").map_err(|e| e.to_string())?;
        sheet.write_with_format(0, 0, "Business Type", &header_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(0, 1, "Count", &header_fmt).map_err(|e| e.to_string())?;
        for (i, bt) in report.business_types.iter().enumerate() {
            let r = (i + 1) as u32;
            let fmt = if i % 2 == 1 { &cell_alt_fmt } else { &cell_fmt };
            sheet.write_with_format(r, 0, &bt.business_type, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 1, bt.count as f64, fmt).map_err(|e| e.to_string())?;
        }
        sheet.set_column_width(0, 28.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(1, 12.0).map_err(|e| e.to_string())?;
    }

    // ── Sheet 4: Events (every event, every region, date, venue) ───────────
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Events").map_err(|e| e.to_string())?;
        let headers = ["Date", "Event", "Region", "Venue", "Participants"];
        for (c, h) in headers.iter().enumerate() {
            sheet.write_with_format(0, c as u16, *h, &header_fmt).map_err(|e| e.to_string())?;
        }
        for (i, ev) in report.events.iter().enumerate() {
            let r = (i + 1) as u32;
            let fmt = if i % 2 == 1 { &cell_alt_fmt } else { &cell_fmt };
            sheet.write_with_format(r, 0, &ev.start_date, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 1, &ev.title, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 2, &ev.region, fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 3, ev.venue.as_deref().unwrap_or("—"), fmt).map_err(|e| e.to_string())?;
            sheet.write_with_format(r, 4, ev.participant_count as f64, fmt).map_err(|e| e.to_string())?;
        }
        sheet.set_column_width(0, 14.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(1, 32.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(2, 18.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(3, 22.0).map_err(|e| e.to_string())?;
        sheet.set_column_width(4, 14.0).map_err(|e| e.to_string())?;
    }

    workbook.save(&path).map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "export.report_excel", "export", None, Some(&path),
        Some(&format!("FY {} — summary report", report.financial_year)));
    Ok(true)
}

/// CSV version of the summary report export — overview totals, regional
/// breakdown, business types, and the full event list, one section per
/// block (rather than the flat participant rows in export::export_csv).
#[tauri::command]
pub fn export_report_csv(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    financial_year: String,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let report = fetch_report(&state, &financial_year)?;

    let mut csv = String::new();

    csv.push_str(&format!("=== KIBT Annual Report — FY {} ===\n\n", report.financial_year));

    csv.push_str("OVERVIEW\n");
    csv.push_str(&format!("Total Participants,{}\n", report.total_participants));
    csv.push_str(&format!("Training Events,{}\n", report.total_events));
    csv.push_str(&format!("Active Regions,{}\n", report.active_regions));
    csv.push_str(&format!("Consented,{}\n", report.consent_count));
    csv.push_str(&format!("Male,{}\n", report.male_count));
    csv.push_str(&format!("Female,{}\n", report.female_count));
    csv.push_str(&format!("Age Category A (Above 35),{}\n", report.age_a_count));
    csv.push_str(&format!("Age Category B (Below 35),{}\n\n", report.age_b_count));

    csv.push_str("BY REGION\n");
    csv.push_str("Region,Events,Participants,Male,Female,Cat. A,Cat. B,Consented\n");
    for reg in &report.regions {
        csv.push_str(&format!("{},{},{},{},{},{},{},{}\n",
            csv_escape(&reg.region), reg.events, reg.participants,
            reg.male, reg.female, reg.age_a, reg.age_b, reg.consent));
    }
    csv.push_str(&format!("TOTAL,{},{},{},{},{},{},{}\n\n",
        report.total_events, report.total_participants, report.male_count,
        report.female_count, report.age_a_count, report.age_b_count, report.consent_count));

    if !report.business_types.is_empty() {
        csv.push_str("BUSINESS TYPES\n");
        csv.push_str("Business Type,Count\n");
        for bt in &report.business_types {
            csv.push_str(&format!("{},{}\n", csv_escape(&bt.business_type), bt.count));
        }
        csv.push('\n');
    }

    csv.push_str("EVENTS (every event, region, date, venue)\n");
    csv.push_str("Date,Event,Region,Venue,Participants\n");
    for ev in &report.events {
        csv.push_str(&format!("{},{},{},{},{}\n",
            csv_escape(&ev.start_date), csv_escape(&ev.title), csv_escape(&ev.region),
            csv_escape(ev.venue.as_deref().unwrap_or("—")), ev.participant_count));
    }

    std::fs::write(&path, csv).map_err(|e| e.to_string())?;

    let (actor_id, actor_name) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "export.report_csv", "export", None, Some(&path),
        Some(&format!("FY {} — summary report", report.financial_year)));
    Ok(true)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
