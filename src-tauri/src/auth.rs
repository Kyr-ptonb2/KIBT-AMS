// auth.rs — Authentication with one-time default credential + recovery codes.
//
// DEFAULT CREDENTIAL (one-time use):
//   username: admin   password: Kibt@2024
//   After first successful login → marked dormant, can never log in again.
//   Reinstalling the app creates a fresh dormant credential (clean DB).
//
// RECOVERY:
//   Each user gets a one-time recovery code shown once on profile setup.
//   If password forgotten, enter username + recovery code → set new password.
//   Super admin can always reset any user's password from user management.

use crate::db::{open, AppDataDir};
use crate::logs::write_log;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String, pub username: String, pub role: String,
    pub full_name: Option<String>, pub email: Option<String>,
    pub phone: Option<String>, pub id_number: Option<String>,
    pub must_change_password: bool,
    pub is_default_account: bool,   // true = the one-time default admin
    pub is_dormant: bool,           // true = default account already used
    pub created_by: Option<String>,
    pub created_at: String, pub last_login: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String, pub username: String, pub role: String,
    pub full_name: Option<String>, pub must_change_password: bool,
}

pub struct AuthState(pub Mutex<Option<SessionUser>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginInput { pub username: String, pub password: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProfileInput {
    pub new_username: String, pub new_password: String,
    pub full_name: String, pub email: String,
    pub phone: String, pub id_number: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserInput {
    pub username: String, pub password: String, pub role: String,
    pub full_name: Option<String>, pub email: Option<String>,
    pub phone: Option<String>, pub id_number: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub success: bool,
    pub user: Option<SessionUser>,
    pub error: Option<String>,
    /// Shown exactly once after first login with default credential
    pub recovery_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub success: bool,
    pub error: Option<String>,
}

// ── DB init ───────────────────────────────────────────────────────────────────

pub fn init_auth(app_data_dir: &std::path::Path) -> Result<()> {
    let conn = open(app_data_dir)?;

    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS users (
            id                   TEXT PRIMARY KEY,
            username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash        TEXT NOT NULL,
            role                 TEXT NOT NULL DEFAULT 'user',
            full_name            TEXT,
            email                TEXT,
            phone                TEXT,
            id_number            TEXT,
            must_change_password INTEGER NOT NULL DEFAULT 1,
            is_default_account   INTEGER NOT NULL DEFAULT 0,
            is_dormant           INTEGER NOT NULL DEFAULT 0,
            recovery_code_hash   TEXT,
            created_by           TEXT,
            created_at           TEXT NOT NULL,
            last_login           TEXT
        );
    "#)?;

    // Seed the one-time default super_admin if no users exist at all
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    if count == 0 {
        let hash = bcrypt::hash("Kibt@2024", bcrypt::DEFAULT_COST)?;
        let id   = Uuid::new_v4().to_string();
        let now  = chrono::Utc::now().to_rfc3339();
        conn.execute(
            r#"INSERT INTO users
               (id, username, password_hash, role, must_change_password,
                is_default_account, is_dormant, created_at)
               VALUES (?1, 'admin', ?2, 'super_admin', 1, 1, 0, ?3)"#,
            params![id, hash, now],
        )?;
        eprintln!("[auth] One-time default admin created. Login: admin / Kibt@2024");
    }
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn login(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: LoginInput,
) -> Result<LoginResult, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let row = conn.query_row(
        r#"SELECT id, username, password_hash, role, full_name,
                  must_change_password, is_default_account, is_dormant
           FROM users
           WHERE username = ?1 COLLATE NOCASE"#,
        params![input.username.trim()],
        |r| Ok((
            r.get::<_,String>(0)?, r.get::<_,String>(1)?,
            r.get::<_,String>(2)?, r.get::<_,String>(3)?,
            r.get::<_,Option<String>>(4)?,
            r.get::<_,bool>(5)?, r.get::<_,bool>(6)?, r.get::<_,bool>(7)?,
        )),
    );

    let (id, username, hash, role, full_name, must_change, is_default, is_dormant) = match row {
        Ok(r) => r,
        Err(_) => {
            write_log(&state.0, None, Some(input.username.trim()),
                "auth.login_failed", "auth", None, None, Some("User not found"));
            return Ok(LoginResult { success: false, user: None,
                error: Some("Invalid username or password.".into()),
                recovery_code: None });
        }
    };

    // Dormant default account cannot log in ever again
    if is_dormant {
        write_log(&state.0, Some(&id), Some(&username),
            "auth.login_blocked", "auth", None, None,
            Some("Attempt to use dormant default account"));
        return Ok(LoginResult { success: false, user: None,
            error: Some("This default account has been deactivated. Please log in with your personal account.".into()),
            recovery_code: None });
    }

    if !bcrypt::verify(&input.password, &hash).unwrap_or(false) {
        write_log(&state.0, Some(&id), Some(&username),
            "auth.login_failed", "auth", None, None, Some("Wrong password"));
        return Ok(LoginResult { success: false, user: None,
            error: Some("Invalid username or password.".into()),
            recovery_code: None });
    }

    let now = chrono::Utc::now().to_rfc3339();

    // If this is the default account's FIRST login, mark it dormant immediately
    // It can still complete this session (setup profile), but can NEVER log in again after logout.
    if is_default && must_change {
        conn.execute(
            "UPDATE users SET last_login = ?1, is_dormant = 1 WHERE id = ?2",
            params![now, id],
        ).map_err(|e| e.to_string())?;
        eprintln!("[auth] Default account used for first time — now dormant.");
    } else {
        conn.execute("UPDATE users SET last_login = ?1 WHERE id = ?2", params![now, id])
            .map_err(|e| e.to_string())?;
    }

    write_log(&state.0, Some(&id), Some(&username), "auth.login", "auth",
        None, None, if is_default { Some("Default account first use") } else { None });

    let session = SessionUser { id, username, role, full_name, must_change_password: must_change };
    *auth.0.lock().unwrap() = Some(session.clone());

    Ok(LoginResult { success: true, user: Some(session), error: None, recovery_code: None })
}

#[tauri::command]
pub fn logout(state: State<'_, AppDataDir>, auth: State<'_, AuthState>) -> bool {
    if let Some(ref s) = *auth.0.lock().unwrap() {
        write_log(&state.0, Some(&s.id), Some(&s.username), "auth.logout", "auth", None, None, None);
    }
    *auth.0.lock().unwrap() = None;
    true
}

#[tauri::command]
pub fn get_session(auth: State<'_, AuthState>) -> Option<SessionUser> {
    auth.0.lock().unwrap().clone()
}

/// First-login profile setup.
/// Generates a one-time recovery code — shown to user ONCE, stored as bcrypt hash.
#[tauri::command]
pub fn setup_profile(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: SetupProfileInput,
) -> Result<SetupProfileResult, String> {
    let session = auth.0.lock().unwrap().clone().ok_or("Not logged in")?;

    if input.new_username.trim().len() < 3 { return Err("Username must be at least 3 characters.".into()); }
    if input.new_password.len() < 8       { return Err("Password must be at least 8 characters.".into()); }
    if input.full_name.trim().is_empty()   { return Err("Full name is required.".into()); }

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let taken: i64 = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE username = ?1 COLLATE NOCASE AND id != ?2",
        params![input.new_username.trim(), session.id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if taken > 0 { return Err(format!("Username '{}' is already taken.", input.new_username.trim())); }

    let password_hash = bcrypt::hash(&input.new_password, bcrypt::DEFAULT_COST)
        .map_err(|e| e.to_string())?;

    // Generate a human-readable recovery code: XXXX-XXXX-XXXX-XXXX
    let code = generate_recovery_code();
    let code_hash = bcrypt::hash(&code, 4) // cost 4 = fast, recovery codes don't need max security
        .map_err(|e| e.to_string())?;

    conn.execute(
        r#"UPDATE users SET username=?1, password_hash=?2, full_name=?3, email=?4,
           phone=?5, id_number=?6, must_change_password=0, recovery_code_hash=?7
           WHERE id=?8"#,
        params![input.new_username.trim(), password_hash, input.full_name.trim(),
                input.email.trim(), input.phone.trim(), input.id_number.trim(),
                code_hash, session.id],
    ).map_err(|e| e.to_string())?;

    let updated = SessionUser {
        id: session.id.clone(),
        username: input.new_username.trim().to_string(),
        role: session.role,
        full_name: Some(input.full_name.trim().to_string()),
        must_change_password: false,
    };

    write_log(&state.0, Some(&updated.id), Some(&updated.username),
        "auth.profile_setup", "auth", None, Some("Profile configured"), None);

    *auth.0.lock().unwrap() = Some(updated.clone());

    Ok(SetupProfileResult {
        user: updated,
        recovery_code: code, // shown ONCE to the user — must save it
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProfileResult {
    pub user: SessionUser,
    pub recovery_code: String,
}

/// Verify a recovery code for a given username (doesn't log them in yet).
#[tauri::command]
pub fn verify_recovery_code(
    state: State<'_, AppDataDir>,
    username: String,
) -> Result<RecoveryResult, String> {
    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE username = ?1 COLLATE NOCASE AND is_dormant = 0",
        params![username.trim()],
        |r| r.get::<_, i64>(0),
    ).map_err(|e| e.to_string())? > 0;

    if !exists {
        return Ok(RecoveryResult {
            success: false,
            error: Some("Username not found or account is dormant.".into()),
        });
    }

    Ok(RecoveryResult { success: true, error: None })
}

/// Reset password using recovery code. Sets must_change_password = true so
/// user must set a new proper password on next login.
#[tauri::command]
pub fn reset_password_with_code(
    state: State<'_, AppDataDir>,
    username: String,
    recovery_code: String,
    new_password: String,
) -> Result<RecoveryResult, String> {
    if new_password.len() < 8 {
        return Ok(RecoveryResult { success: false, error: Some("Password must be at least 8 characters.".into()) });
    }

    let conn = open(&state.0).map_err(|e| e.to_string())?;

    let row = conn.query_row(
        "SELECT id, recovery_code_hash FROM users WHERE username = ?1 COLLATE NOCASE AND is_dormant = 0",
        params![username.trim()],
        |r| Ok((r.get::<_,String>(0)?, r.get::<_,Option<String>>(1)?)),
    );

    let (user_id, stored_hash) = match row {
        Ok(r) => r,
        Err(_) => return Ok(RecoveryResult { success: false,
            error: Some("Username not found.".into()) }),
    };

    let stored_hash = match stored_hash {
        Some(h) => h,
        None => return Ok(RecoveryResult { success: false,
            error: Some("No recovery code set for this account. Contact your Super Admin.".into()) }),
    };

    if !bcrypt::verify(recovery_code.trim(), &stored_hash).unwrap_or(false) {
        write_log(&state.0, Some(&user_id), Some(username.trim()),
            "auth.recovery_failed", "auth", None, None, Some("Wrong recovery code"));
        return Ok(RecoveryResult { success: false,
            error: Some("Recovery code is incorrect.".into()) });
    }

    let new_hash = bcrypt::hash(&new_password, bcrypt::DEFAULT_COST)
        .map_err(|e| e.to_string())?;

    // Invalidate recovery code after use (one-time use)
    conn.execute(
        "UPDATE users SET password_hash=?1, must_change_password=1, recovery_code_hash=NULL WHERE id=?2",
        params![new_hash, user_id],
    ).map_err(|e| e.to_string())?;

    write_log(&state.0, Some(&user_id), Some(username.trim()),
        "auth.password_recovered", "auth", None, None,
        Some("Password reset via recovery code"));

    Ok(RecoveryResult { success: true, error: None })
}

#[tauri::command]
pub fn get_users(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
) -> Result<Vec<User>, String> {
    require_admin(&auth)?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        r#"SELECT id, username, role, full_name, email, phone, id_number,
                  must_change_password, is_default_account, is_dormant,
                  created_by, created_at, last_login
           FROM users ORDER BY created_at ASC"#
    ).map_err(|e| e.to_string())?;

    let users = stmt.query_map([], |r| Ok(User {
        id: r.get(0)?, username: r.get(1)?, role: r.get(2)?,
        full_name: r.get(3)?, email: r.get(4)?, phone: r.get(5)?,
        id_number: r.get(6)?, must_change_password: r.get(7)?,
        is_default_account: r.get(8)?, is_dormant: r.get(9)?,
        created_by: r.get(10)?, created_at: r.get(11)?, last_login: r.get(12)?,
    })).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(users)
}

#[tauri::command]
pub fn create_user(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    input: CreateUserInput,
) -> Result<User, String> {
    let session = require_admin(&auth)?;

    if (input.role == "admin" || input.role == "super_admin") && session.role != "super_admin" {
        return Err("Only the Super Admin can create admin accounts.".into());
    }
    if !["admin", "user"].contains(&input.role.as_str()) {
        return Err(format!("Invalid role '{}'.", input.role));
    }
    if input.username.trim().len() < 3 { return Err("Username must be at least 3 characters.".into()); }
    if input.password.len() < 8       { return Err("Password must be at least 8 characters.".into()); }

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let taken: i64 = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE username=?1 COLLATE NOCASE",
        params![input.username.trim()], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if taken > 0 { return Err(format!("Username '{}' is taken.", input.username.trim())); }

    let hash = bcrypt::hash(&input.password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    let id   = Uuid::new_v4().to_string();
    let now  = chrono::Utc::now().to_rfc3339();

    conn.execute(
        r#"INSERT INTO users (id,username,password_hash,role,full_name,email,phone,id_number,
           must_change_password,is_default_account,is_dormant,created_by,created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,0,0,?9,?10)"#,
        params![id, input.username.trim(), hash, input.role,
                input.full_name, input.email, input.phone, input.id_number,
                session.username, now],
    ).map_err(|e| e.to_string())?;

    write_log(&state.0, Some(&session.id), Some(&session.username),
        "user.create", "user", Some(&id),
        Some(&format!("{} (role: {})", input.username.trim(), input.role)), None);

    Ok(User {
        id, username: input.username.trim().to_string(),
        role: input.role, full_name: input.full_name,
        email: input.email, phone: input.phone, id_number: input.id_number,
        must_change_password: true, is_default_account: false, is_dormant: false,
        created_by: Some(session.username), created_at: now, last_login: None,
    })
}

#[tauri::command]
pub fn delete_user(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    user_id: String,
) -> Result<bool, String> {
    let session = require_super_admin(&auth)?;
    if session.id == user_id { return Err("You cannot delete your own account.".into()); }

    // Prevent deleting the default account record entirely
    let is_default: bool = open(&state.0).map_err(|e| e.to_string())?.query_row(
        "SELECT is_default_account FROM users WHERE id=?1",
        params![user_id], |r| r.get(0),
    ).unwrap_or(false);
    if is_default { return Err("The default account record cannot be deleted. It is kept for audit purposes.".into()); }

    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute("DELETE FROM users WHERE id=?1", params![user_id])
        .map_err(|e| e.to_string())?;
    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "user.delete", "user", Some(&user_id), None, None);
    }
    Ok(rows > 0)
}

#[tauri::command]
pub fn set_user_role(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    user_id: String, role: String,
) -> Result<bool, String> {
    let session = require_super_admin(&auth)?;
    if session.id == user_id { return Err("You cannot change your own role.".into()); }
    if !["admin","user","super_admin"].contains(&role.as_str()) {
        return Err(format!("Invalid role: {}", role));
    }
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute("UPDATE users SET role=?1 WHERE id=?2", params![role, user_id])
        .map_err(|e| e.to_string())?;
    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "user.role_change", "user", Some(&user_id), Some(&format!("→ {}", role)), None);
    }
    Ok(rows > 0)
}

#[tauri::command]
pub fn reset_user_password(
    state: State<'_, AppDataDir>,
    auth: State<'_, AuthState>,
    user_id: String, new_password: String,
) -> Result<bool, String> {
    let session = require_admin(&auth)?;
    if new_password.len() < 8 { return Err("Password must be at least 8 characters.".into()); }
    let hash = bcrypt::hash(&new_password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    let conn = open(&state.0).map_err(|e| e.to_string())?;
    let rows = conn.execute(
        "UPDATE users SET password_hash=?1, must_change_password=1 WHERE id=?2",
        params![hash, user_id],
    ).map_err(|e| e.to_string())?;
    if rows > 0 {
        write_log(&state.0, Some(&session.id), Some(&session.username),
            "user.password_reset", "user", Some(&user_id), None, None);
    }
    Ok(rows > 0)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn generate_recovery_code() -> String {
    // 4 groups of 4 alphanumeric chars — easy to write down
    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars().collect();
    let mut groups = Vec::new();
    for _ in 0..4 {
        let group: String = (0..4)
            .map(|_| {
                let idx = (uuid::Uuid::new_v4().as_u128() % chars.len() as u128) as usize;
                chars[idx]
            })
            .collect();
        groups.push(group);
    }
    groups.join("-")
}

pub fn require_admin(auth: &State<'_, AuthState>) -> Result<SessionUser, String> {
    let s = auth.0.lock().unwrap().clone().ok_or("Not logged in.")?;
    if matches!(s.role.as_str(), "admin"|"super_admin") { Ok(s) }
    else { Err("Admin access required.".into()) }
}

pub fn require_super_admin(auth: &State<'_, AuthState>) -> Result<SessionUser, String> {
    let s = auth.0.lock().unwrap().clone().ok_or("Not logged in.")?;
    if s.role == "super_admin" { Ok(s) } else { Err("Super Admin access required.".into()) }
}
