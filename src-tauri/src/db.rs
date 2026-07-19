// db.rs — SQLite schema, migrations, seed data.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub struct AppDataDir(pub PathBuf);

pub fn db_path(app_data_dir: &Path) -> PathBuf { app_data_dir.join("kibt.db") }

pub fn open(app_data_dir: &Path) -> Result<Connection> {
    let path = db_path(app_data_dir);
    let conn = Connection::open(&path)
        .with_context(|| format!("Failed to open database at {:?}", path))?;
    conn.execute_batch(r#"
        PRAGMA journal_mode   = WAL;       -- concurrent reads + writes
        PRAGMA foreign_keys   = ON;
        PRAGMA synchronous    = NORMAL;    -- safe with WAL, much faster than FULL
        PRAGMA cache_size     = -8000;     -- 8 MB page cache (negative = kibibytes)
        PRAGMA temp_store     = MEMORY;    -- temp tables in RAM, not on disk
        PRAGMA mmap_size      = 67108864;  -- 64 MB memory-mapped I/O
        PRAGMA busy_timeout   = 5000;      -- wait up to 5 s instead of immediate error
    "#)?;
    // NOTE: PRAGMA optimize deliberately NOT run here — this function is
    // called on every single Tauri command (dozens of times per session).
    // optimize() re-gathers query-planner statistics, which is real CPU work
    // with no benefit when run repeatedly. It's run once at startup instead
    // (see init()) which is when it actually matters.
    Ok(conn)
}

pub fn init(app_data_dir: &Path) -> Result<()> {
    let conn = open(app_data_dir)?;
    conn.execute_batch(SCHEMA_SQL).context("Failed to create schema")?;
    conn.execute_batch(crate::logs::LOGS_SCHEMA).context("Failed to create logs schema")?;
    migrate(&conn)?;
    create_indices(&conn)?;
    crate::custom_tables::init_custom_tables(&conn)?;
    seed_regions(&conn)?;
    // Refresh query-planner statistics once at startup (not on every command —
    // see comment on open()). Non-fatal if it fails.
    let _ = conn.execute_batch("PRAGMA optimize;");
    Ok(())
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    region         TEXT NOT NULL,
    venue          TEXT,
    financial_year TEXT NOT NULL,
    event_type     TEXT NOT NULL DEFAULT 'in-person',  -- 'in-person' | 'online' | 'hybrid'
    notes          TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_sessions (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_no  INTEGER NOT NULL DEFAULT 1,
    title       TEXT,
    date        TEXT NOT NULL,
    start_time  TEXT,
    end_time    TEXT,
    region      TEXT,
    venue       TEXT,
    created_at  TEXT NOT NULL,
    topics_json      TEXT NOT NULL DEFAULT '[]',
    facilitators_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS participants (
    id            TEXT PRIMARY KEY,
    event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id    TEXT REFERENCES event_sessions(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    business_type TEXT,
    age_category  TEXT,
    gender        TEXT,
    phone         TEXT,
    consent       TEXT,
    location      TEXT,
    region        TEXT,
    extra_fields  TEXT,
    source        TEXT NOT NULL DEFAULT 'scan',  -- 'scan' | 'import' | 'manual'
    added_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
    id               TEXT PRIMARY KEY,
    batch_id         TEXT,
    batch_sequence   INTEGER,
    event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    image_path       TEXT,
    scan_method      TEXT NOT NULL,
    extracted_count  INTEGER NOT NULL DEFAULT 0,
    saved_count      INTEGER NOT NULL DEFAULT 0,
    accuracy_note    TEXT,
    scanned_at       TEXT NOT NULL,
    model_version    TEXT,
    detected_columns TEXT
);

CREATE TABLE IF NOT EXISTS regions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    county  TEXT,
    active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

fn migrate(conn: &Connection) -> Result<()> {
    // ── AUTH SELF-HEAL (fixes databases created before the auth rewrite) ─────
    //
    // Old behaviour: setup_profile mutated the default admin row in place,
    // setting is_dormant=1 on it — which then blocked ALL logins for that user.
    //
    // Fix: if we find a user row that is:
    //   • is_default_account = 1  AND  is_dormant = 1  (correctly dormant)
    //   • must_change_password = 0  (already completed setup — so the mutation
    //     happened but no new row was inserted)
    //
    // …we know the old bug hit this DB.  We create a new personal account row
    // using the data already stored in that row (the username/password the user
    // chose is still there), clear is_dormant on that copy so they can log in,
    // and re-set is_dormant=1 on the original default row.
    {
        // Check whether the broken pattern exists
        let broken: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE is_default_account=1 AND is_dormant=1 AND must_change_password=0",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        if broken > 0 {
            // The old bug mutated the default admin row in-place, storing the
            // user's real credentials there but also setting is_default_account=1
            // and is_dormant=1, which blocked all future logins.
            //
            // Simplest fix: flip those flags so the row becomes a normal
            // personal account that login() will accept.
            let fixed = conn.execute(
                "UPDATE users SET is_default_account = 0, is_dormant = 0
                 WHERE is_default_account = 1 AND is_dormant = 1 AND must_change_password = 0",
                [],
            ).unwrap_or(0);
            eprintln!("[db/migrate] auth self-heal: repaired {} broken account row(s)", fixed);
        }
    }
    // ── END AUTH SELF-HEAL ────────────────────────────────────────────────────

    // Add new columns to existing events table
    let mut stmt = conn.prepare("PRAGMA table_info(events)")?;
    let event_cols: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok()).collect();
    for (col, typ) in &[
        ("start_date",  "TEXT"),
        ("end_date",    "TEXT"),
        ("event_type",  "TEXT"),
    ] {
        if !event_cols.iter().any(|c| c == col) {
            // For migration: copy date → start_date/end_date if old schema
            if *col == "start_date" || *col == "end_date" {
                if event_cols.iter().any(|c| c == "date") {
                    let _ = conn.execute_batch(&format!(
                        "ALTER TABLE events ADD COLUMN {} TEXT; UPDATE events SET {} = date;",
                        col, col
                    ));
                    continue;
                }
            }
            let _ = conn.execute_batch(&format!("ALTER TABLE events ADD COLUMN {} {};", col, typ));
        }
    }

    // Add new columns to participants
    let mut stmt2 = conn.prepare("PRAGMA table_info(participants)")?;
    let part_cols: Vec<String> = stmt2.query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok()).collect();
    for (col, typ) in &[
        ("location",   "TEXT"),
        ("extra_fields","TEXT"),
        ("region",     "TEXT"),
        ("session_id", "TEXT"),
        ("source",     "TEXT"),
        ("id_number",  "TEXT"),   // National ID / passport — duplicate detection
    ] {
        if !part_cols.iter().any(|c| c == col) {
            let _ = conn.execute_batch(&format!("ALTER TABLE participants ADD COLUMN {} {};", col, typ));
        }
    }

    Ok(())
}

fn create_indices(conn: &Connection) -> Result<()> {
    // Add topics/facilitators columns to existing event_sessions tables
    // (safe no-op if columns already exist — errors are ignored)
    for col in &[
        ("topics_json",       "TEXT NOT NULL DEFAULT '[]'"),
        ("facilitators_json", "TEXT NOT NULL DEFAULT '[]'"),
    ] {
        let _ = conn.execute_batch(&format!(
            "ALTER TABLE event_sessions ADD COLUMN {} {};",
            col.0, col.1
        ));
    }

    conn.execute_batch(r#"
        CREATE INDEX IF NOT EXISTS idx_participants_event_id   ON participants(event_id);
        CREATE INDEX IF NOT EXISTS idx_participants_session_id  ON participants(session_id);
        CREATE INDEX IF NOT EXISTS idx_participants_added_at    ON participants(added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_participants_event_added ON participants(event_id, added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_participants_name        ON participants(name);
        CREATE INDEX IF NOT EXISTS idx_participants_phone       ON participants(phone);
        CREATE INDEX IF NOT EXISTS idx_participants_id_number   ON participants(id_number);

        -- Covering index for the report aggregation query (the heaviest query in the system)
        -- Includes all columns touched by GROUP BY / WHERE / SUM in get_report
        CREATE INDEX IF NOT EXISTS idx_participants_report
            ON participants(event_id, gender, age_category, consent);

        -- Index for financial year lookups on events (used by almost every query)
        CREATE INDEX IF NOT EXISTS idx_events_financial_year
            ON events(financial_year);

        -- Composite index for participants filtered by event + added_at (pagination)
        CREATE INDEX IF NOT EXISTS idx_participants_event_date
            ON participants(event_id, added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_events_fy                ON events(financial_year);
        CREATE INDEX IF NOT EXISTS idx_events_region            ON events(region);
        CREATE INDEX IF NOT EXISTS idx_events_fy_region         ON events(financial_year, region);
        CREATE INDEX IF NOT EXISTS idx_sessions_event_id        ON event_sessions(event_id);
        CREATE INDEX IF NOT EXISTS idx_scans_batch_id           ON scans(batch_id);
        CREATE INDEX IF NOT EXISTS idx_scans_event_id           ON scans(event_id);
    "#)?;
    Ok(())
}

fn seed_regions(conn: &Connection) -> Result<()> {
    // All 47 Kenya counties
    let counties = [
        "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta",
        "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru",
        "Tharaka-Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua",
        "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
        "Samburu", "Trans-Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi",
        "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho",
        "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya",
        "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
    ];
    for county in counties {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO regions (name, county, active) VALUES (?1, ?1, 1)",
            params![county],
        );
    }
    Ok(())
}
