// db.rs — SQLite connection, schema, and safe migrations.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub struct AppDataDir(pub PathBuf);

pub fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("kibt.db")
}

pub fn open(app_data_dir: &Path) -> Result<Connection> {
    let path = db_path(app_data_dir);
    let conn = Connection::open(&path)
        .with_context(|| format!("Failed to open database at {:?}", path))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

pub fn init(app_data_dir: &Path) -> Result<()> {
    let conn = open(app_data_dir)?;
    conn.execute_batch(SCHEMA_SQL).context("Failed to create schema")?;
    // Audit logs schema
    conn.execute_batch(crate::logs::LOGS_SCHEMA).context("Failed to create logs schema")?;
    migrate(&conn)?;
    seed_regions(&conn)?;
    Ok(())
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    date           TEXT NOT NULL,
    region         TEXT NOT NULL,
    venue          TEXT,
    financial_year TEXT NOT NULL,
    notes          TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    id            TEXT PRIMARY KEY,
    event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    business_type TEXT,
    age_category  TEXT,
    gender        TEXT,
    phone         TEXT,
    consent       TEXT,
    location      TEXT,
    extra_fields  TEXT,   -- JSON: {"column_name": "value", ...} for any extra/new columns
    added_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
    id              TEXT PRIMARY KEY,
    batch_id        TEXT,
    batch_sequence  INTEGER,
    event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    image_path      TEXT,
    scan_method     TEXT NOT NULL,
    extracted_count INTEGER NOT NULL DEFAULT 0,
    saved_count     INTEGER NOT NULL DEFAULT 0,
    accuracy_note   TEXT,
    scanned_at      TEXT NOT NULL,
    model_version   TEXT,
    detected_columns TEXT   -- JSON array of column names found by scanner
);

CREATE TABLE IF NOT EXISTS regions (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT NOT NULL UNIQUE,
    county TEXT,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_event_id ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_events_fy            ON events(financial_year);
CREATE INDEX IF NOT EXISTS idx_events_region        ON events(region);
"#;

/// Safe schema migrations — add new columns to existing databases without data loss.
fn migrate(conn: &Connection) -> Result<()> {
    // Get current columns in participants table
    let mut stmt = conn.prepare("PRAGMA table_info(participants)")?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    // Add any missing columns
    let new_cols = [
        ("location",     "TEXT"),
        ("extra_fields", "TEXT"),
    ];
    for (col, typ) in &new_cols {
        if !existing.iter().any(|c| c == col) {
            conn.execute_batch(&format!(
                "ALTER TABLE participants ADD COLUMN {} {};", col, typ
            ))?;
            eprintln!("[migration] Added column participants.{}", col);
        }
    }

    // Add detected_columns to scans if missing
    let mut stmt2 = conn.prepare("PRAGMA table_info(scans)")?;
    let scan_cols: Vec<String> = stmt2
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !scan_cols.iter().any(|c| c == "detected_columns") {
        conn.execute_batch("ALTER TABLE scans ADD COLUMN detected_columns TEXT;")?;
    }

    Ok(())
}

fn seed_regions(conn: &Connection) -> Result<()> {
    let regions = [
        ("Nairobi", "Nairobi City County"), ("Mombasa", "Coast Region"),
        ("Kisumu", "Nyanza Region"), ("Nakuru", "Rift Valley Region"),
        ("Eldoret", "North Rift Region"), ("Thika", "Central Region"),
        ("Nyeri", "Mt. Kenya Region"), ("Meru", "Mt. Kenya Region"),
        ("Garissa", "North Eastern Region"), ("Kakamega", "Western Region"),
        ("Kitale", "Western Region"), ("Machakos", "Eastern Region"),
        ("Embu", "Eastern Region"), ("Kisii", "South Nyanza Region"),
        ("Kericho", "Rift Valley Region"), ("Malindi", "Coast Region"),
        ("Nanyuki", "Mt. Kenya Region"), ("Bungoma", "Western Region"),
    ];
    for (name, county) in regions {
        conn.execute(
            "INSERT OR IGNORE INTO regions (name, county) VALUES (?1, ?2)",
            params![name, county],
        )?;
    }
    Ok(())
}
