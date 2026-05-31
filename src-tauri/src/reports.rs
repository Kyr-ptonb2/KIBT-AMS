// reports.rs — Annual statistical report generation via SQL aggregation.

use crate::db::{open, AppDataDir};
use anyhow::Result;
use rusqlite::params;
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

// ── Command ───────────────────────────────────────────────────────────────────

/// Generate the full annual report for a given financial year.
#[tauri::command]
pub fn get_report(
    state: State<'_, AppDataDir>,
    financial_year: String,
) -> Result<ReportData, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    // ── Totals ────────────────────────────────────────────────────────────────
    let totals: (i64, i64, i64, i64, i64, i64, i64) = conn
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
            )),
        )
        .map_err(|e| e.to_string())?;

    let age_b: i64 = conn
        .query_row(
            r#"SELECT SUM(CASE WHEN p.age_category = 'B' THEN 1 ELSE 0 END)
               FROM participants p JOIN events e ON e.id = p.event_id
               WHERE e.financial_year = ?1"#,
            params![financial_year],
            |row| row.get(0),
        )
        .unwrap_or(0);

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
        financial_year,
        total_participants: totals.0,
        total_events: totals.1,
        active_regions: totals.2,
        male_count: totals.3,
        female_count: totals.4,
        consent_count: totals.5,
        age_a_count: totals.6,
        age_b_count: age_b,
        regions,
        business_types,
        events,
    })
}
