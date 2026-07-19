// export.rs — Excel (.xlsx) and CSV export Tauri commands.
//
// Exports are grouped BY EVENT rather than one flat table:
//   - Each event gets its own titled section: title, financial year,
//     region (or "Online"/"Hybrid"), venue, and date range.
//   - Topics Covered and Trainers/Facilitators are shown once per event
//     (aggregated across all of that event's sessions, deduplicated) —
//     only if any exist.
//   - The participant table under each section only includes columns
//     that actually have data for at least one participant in that
//     event — no blank "Extra Fields" / "National ID" columns cluttering
//     the sheet when nobody in that event has that data.
//   - Multiple events (e.g. from different regions, when exporting
//     without an event filter) each get their own section, visually
//     separated.

use crate::auth::{AuthState, require_admin};
use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rust_xlsxwriter::{Color, Format, FormatBorder, FormatAlign, Workbook};
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

/// One participant row within an event group. `name` is always shown;
/// every other field is only included in the output if at least one
/// participant in the group has a non-empty value for it.
struct ParticipantRow {
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

/// All participants belonging to one event, plus the event-level context
/// (title, dates, region, financial year, topics, trainers) shown once
/// as a section header rather than repeated on every row.
struct EventGroup {
    title: String,
    financial_year: String,
    region_display: String,   // "Online" / "{region} (Hybrid)" / "{region}"
    venue: Option<String>,
    date_range: String,
    topics: Vec<String>,
    facilitators: Vec<String>,
    participants: Vec<ParticipantRow>,
}

/// Describes one optional participant column: how to read it from a row,
/// and what header to print if it turns out to have data somewhere in
/// the group.
struct ColSpec {
    header: &'static str,
    get: fn(&ParticipantRow) -> Option<&str>,
}

const OPTIONAL_COLS: &[ColSpec] = &[
    ColSpec { header: "Business Type", get: |p| p.business_type.as_deref() },
    ColSpec { header: "Age Category",  get: |p| p.age_category.as_deref() },
    ColSpec { header: "Gender",        get: |p| p.gender.as_deref() },
    ColSpec { header: "Phone Number",  get: |p| p.phone.as_deref() },
    ColSpec { header: "National ID",   get: |p| p.id_number.as_deref() },
    ColSpec { header: "Location",      get: |p| p.location.as_deref() },
    ColSpec { header: "Consent",       get: |p| p.consent.as_deref() },
    ColSpec { header: "Extra Fields",  get: |p| p.extra_fields.as_deref() },
];

fn is_present(v: Option<&str>) -> bool {
    v.map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Which optional columns actually have data anywhere in this group —
/// these are the only ones printed for this event's table.
fn present_cols(participants: &[ParticipantRow]) -> Vec<&'static ColSpec> {
    OPTIONAL_COLS.iter()
        .filter(|col| participants.iter().any(|p| is_present((col.get)(p))))
        .collect()
}

// ── Data fetching ────────────────────────────────────────────────────────────

fn fetch_groups(state: &AppDataDir, filter: &ExportFilter) -> Result<Vec<EventGroup>> {
    let conn = open(&state.0)?;

    // 1. Fetch matching events.
    let mut ev_sql = String::from(r#"
        SELECT e.id, e.title, COALESCE(e.start_date, e.created_at) AS start_date,
               e.end_date, e.region, e.venue, e.financial_year, e.event_type
        FROM events e
        WHERE 1=1
    "#);
    let mut ev_binds: Vec<String> = Vec::new();
    if let Some(ref fy) = filter.financial_year {
        ev_sql.push_str(" AND e.financial_year = ?");
        ev_binds.push(fy.clone());
    }
    if let Some(ref r) = filter.region {
        ev_sql.push_str(" AND e.region = ?");
        ev_binds.push(r.clone());
    }
    if let Some(ref eid) = filter.event_id {
        ev_sql.push_str(" AND e.id = ?");
        ev_binds.push(eid.clone());
    }
    ev_sql.push_str(" ORDER BY e.financial_year DESC, e.region, start_date, e.title");

    struct EventMeta {
        id: String, title: String, start_date: String, end_date: Option<String>,
        region: String, venue: Option<String>, financial_year: String, event_type: String,
    }

    let mut stmt = conn.prepare(&ev_sql)?;
    let events: Vec<EventMeta> = stmt
        .query_map(rusqlite::params_from_iter(ev_binds.iter()), |row| {
            Ok(EventMeta {
                id: row.get(0)?, title: row.get(1)?, start_date: row.get(2)?,
                end_date: row.get(3)?, region: row.get(4)?, venue: row.get(5)?,
                financial_year: row.get(6)?, event_type: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut groups = Vec::new();

    for ev in events {
        // 2. Topics + facilitators aggregated across ALL of this event's
        //    sessions (not just the session a given participant is linked
        //    to) — this is what makes the header correct even for
        //    participants added manually without a session assignment.
        let mut sess_stmt = conn.prepare(
            "SELECT COALESCE(topics_json,'[]'), COALESCE(facilitators_json,'[]') \
             FROM event_sessions WHERE event_id = ?"
        )?;
        let mut topics_set: Vec<String> = Vec::new();
        let mut facils_set: Vec<String> = Vec::new();
        let sess_rows = sess_stmt.query_map(rusqlite::params![ev.id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in sess_rows {
            let (tj, fj) = r?;
            for t in serde_json::from_str::<Vec<String>>(&tj).unwrap_or_default() {
                if !topics_set.contains(&t) { topics_set.push(t); }
            }
            for f in serde_json::from_str::<Vec<String>>(&fj).unwrap_or_default() {
                if !facils_set.contains(&f) { facils_set.push(f); }
            }
        }

        // 3. Participants for this event, with the remaining filters applied.
        let mut p_sql = String::from(
            "SELECT name, business_type, age_category, gender, phone, id_number, \
                    location, extra_fields, consent, added_at \
             FROM participants WHERE event_id = ?"
        );
        let mut p_binds: Vec<String> = vec![ev.id.clone()];
        if let Some(ref g) = filter.gender {
            p_sql.push_str(" AND gender = ?");
            p_binds.push(g.clone());
        }
        if let Some(ref ac) = filter.age_category {
            p_sql.push_str(" AND age_category = ?");
            p_binds.push(ac.clone());
        }
        if let Some(ref c) = filter.consent {
            p_sql.push_str(" AND consent = ?");
            p_binds.push(c.clone());
        }
        p_sql.push_str(" ORDER BY name");

        let mut p_stmt = conn.prepare(&p_sql)?;
        let participants: Vec<ParticipantRow> = p_stmt
            .query_map(rusqlite::params_from_iter(p_binds.iter()), |row| {
                Ok(ParticipantRow {
                    name:           row.get(0)?,
                    business_type:  row.get(1)?,
                    age_category:   row.get(2)?,
                    gender:         row.get(3)?,
                    phone:          row.get(4)?,
                    id_number:      row.get(5)?,
                    location:       row.get(6)?,
                    extra_fields:   row.get(7)?,
                    consent:        row.get(8)?,
                    added_at:       row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Skip events with zero matching participants (e.g. a gender filter
        // that excludes everyone in this particular event) — nothing useful
        // to show in a section for them.
        if participants.is_empty() { continue; }

        let region_display = match ev.event_type.as_str() {
            "online" => "Online".to_string(),
            "hybrid" => format!("{} (Hybrid/Online)", ev.region),
            _        => ev.region.clone(),
        };

        let date_range = match &ev.end_date {
            Some(end) if !end.is_empty() && *end != ev.start_date => {
                format!("{} – {}", &ev.start_date[..10.min(ev.start_date.len())], &end[..10.min(end.len())])
            }
            _ => ev.start_date[..10.min(ev.start_date.len())].to_string(),
        };

        groups.push(EventGroup {
            title: ev.title,
            financial_year: ev.financial_year,
            region_display,
            venue: ev.venue,
            date_range,
            topics: topics_set,
            facilitators: facils_set,
            participants,
        });
    }

    Ok(groups)
}

// ── Excel export ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn export_excel(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    filter: ExportFilter,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let groups = fetch_groups(&state, &filter).map_err(|e| e.to_string())?;

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Participants").map_err(|e| e.to_string())?;

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(13)
        .set_background_color(Color::RGB(0x1a6b3c))
        .set_font_color(Color::White)
        .set_align(FormatAlign::VerticalCenter);

    let meta_fmt = Format::new()
        .set_italic()
        .set_font_color(Color::RGB(0x475569))
        .set_background_color(Color::RGB(0xf1f5f9));

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

    let mut r: u32 = 0;
    let max_cols: u16 = 10; // Name + up to 8 optional columns + Recorded At

    if groups.is_empty() {
        sheet.write_with_format(0, 0, "No participants match the selected filters.", &meta_fmt)
            .map_err(|e| e.to_string())?;
    }

    for group in &groups {
        let cols = present_cols(&group.participants);
        let table_width = (2 + cols.len()) as u16; // Name + present optional cols + Recorded At
        let merge_width = table_width.max(4).min(max_cols);

        // ── Section title band ──────────────────────────────────────────────
        let header_line = format!("{}   ·   FY {}   ·   {}   ·   {}",
            group.title, group.financial_year, group.region_display, group.date_range);
        sheet.merge_range(r, 0, r, merge_width - 1, &header_line, &title_fmt)
            .map_err(|e| e.to_string())?;
        sheet.set_row_height(r, 22).map_err(|e| e.to_string())?;
        r += 1;

        if let Some(ref venue) = group.venue {
            if !venue.trim().is_empty() {
                sheet.merge_range(r, 0, r, merge_width - 1, &format!("Venue: {}", venue), &meta_fmt)
                    .map_err(|e| e.to_string())?;
                r += 1;
            }
        }
        if !group.topics.is_empty() {
            sheet.merge_range(r, 0, r, merge_width - 1,
                &format!("Topics Covered: {}", group.topics.join(", ")), &meta_fmt)
                .map_err(|e| e.to_string())?;
            r += 1;
        }
        if !group.facilitators.is_empty() {
            sheet.merge_range(r, 0, r, merge_width - 1,
                &format!("Trainers/Facilitators: {}", group.facilitators.join(", ")), &meta_fmt)
                .map_err(|e| e.to_string())?;
            r += 1;
        }
        sheet.merge_range(r, 0, r, merge_width - 1,
            &format!("{} participant{}", group.participants.len(), if group.participants.len() == 1 {""} else {"s"}),
            &label_fmt).map_err(|e| e.to_string())?;
        r += 1;

        // ── Table header (only columns with data, plus Recorded At) ─────────
        sheet.write_with_format(r, 0, "Full Name", &header_fmt).map_err(|e| e.to_string())?;
        for (i, col) in cols.iter().enumerate() {
            sheet.write_with_format(r, (1 + i) as u16, col.header, &header_fmt).map_err(|e| e.to_string())?;
        }
        let recorded_col = (1 + cols.len()) as u16;
        sheet.write_with_format(r, recorded_col, "Recorded At", &header_fmt).map_err(|e| e.to_string())?;
        r += 1;

        // ── Data rows ────────────────────────────────────────────────────────
        for (i, p) in group.participants.iter().enumerate() {
            let fmt = if i % 2 == 1 { &cell_alt_fmt } else { &cell_fmt };
            sheet.write_with_format(r, 0, &p.name, fmt).map_err(|e| e.to_string())?;
            for (ci, col) in cols.iter().enumerate() {
                let val = (col.get)(p).unwrap_or("");
                sheet.write_with_format(r, (1 + ci) as u16, val, fmt).map_err(|e| e.to_string())?;
            }
            sheet.write_with_format(r, recorded_col, &p.added_at, fmt).map_err(|e| e.to_string())?;
            r += 1;
        }

        r += 2; // blank rows before next section
    }

    // Column widths — Name wide, others moderate
    sheet.set_column_width(0, 28.0).map_err(|e| e.to_string())?;
    for c in 1..max_cols {
        sheet.set_column_width(c, 20.0).map_err(|e| e.to_string())?;
    }

    workbook.save(&path).map_err(|e| e.to_string())?;

    let total_participants: usize = groups.iter().map(|g| g.participants.len()).sum();
    let (actor_id, actor_name) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id.as_deref(), actor_name.as_deref(),
        "export.excel", "export", None, Some(&path),
        Some(&format!("{} events, {} participants", groups.len(), total_participants)));
    Ok(true)
}

// ── CSV export ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn export_csv(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    filter: ExportFilter,
    path: String,
) -> Result<bool, String> {
    require_admin(&auth)?;
    let groups = fetch_groups(&state, &filter).map_err(|e| e.to_string())?;

    let mut csv = String::new();

    if groups.is_empty() {
        csv.push_str("No participants match the selected filters.\n");
    }

    for group in &groups {
        let cols = present_cols(&group.participants);

        csv.push_str(&csv_escape(&format!(
            "=== {} — FY {} — {} — {} ===",
            group.title, group.financial_year, group.region_display, group.date_range
        )));
        csv.push('\n');

        if let Some(ref venue) = group.venue {
            if !venue.trim().is_empty() {
                csv.push_str(&csv_escape(&format!("Venue: {}", venue)));
                csv.push('\n');
            }
        }
        if !group.topics.is_empty() {
            csv.push_str(&csv_escape(&format!("Topics Covered: {}", group.topics.join(", "))));
            csv.push('\n');
        }
        if !group.facilitators.is_empty() {
            csv.push_str(&csv_escape(&format!("Trainers/Facilitators: {}", group.facilitators.join(", "))));
            csv.push('\n');
        }
        csv.push_str(&format!("{} participant{}\n", group.participants.len(),
            if group.participants.len() == 1 {""} else {"s"}));

        // Table header
        let mut headers: Vec<&str> = vec!["Full Name"];
        headers.extend(cols.iter().map(|c| c.header));
        headers.push("Recorded At");
        csv.push_str(&headers.iter().map(|h| csv_escape(h)).collect::<Vec<_>>().join(","));
        csv.push('\n');

        // Rows
        for p in &group.participants {
            let mut fields: Vec<String> = vec![csv_escape(&p.name)];
            for col in &cols {
                fields.push(csv_escape((col.get)(p).unwrap_or("")));
            }
            fields.push(csv_escape(&p.added_at));
            csv.push_str(&fields.join(","));
            csv.push('\n');
        }

        csv.push('\n'); // blank line between event sections
    }

    std::fs::write(&path, csv).map_err(|e| e.to_string())?;

    let total_participants: usize = groups.iter().map(|g| g.participants.len()).sum();
    let (actor_id2, actor_name2) = match auth.0.lock().unwrap().clone() {
        Some(s) => (Some(s.id), Some(s.username)),
        None    => (None, None),
    };
    write_log(&state.0, actor_id2.as_deref(), actor_name2.as_deref(),
        "export.csv", "export", None, Some(&path),
        Some(&format!("{} events, {} participants", groups.len(), total_participants)));
    Ok(true)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
