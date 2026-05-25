mod auth;
mod config;
mod logs;
mod db;
mod events;
mod export;
mod participants;
mod reports;
mod scan;

use auth::AuthState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            db::init(&app_data_dir).expect("Failed to initialise database");
            auth::init_auth(&app_data_dir).expect("Failed to initialise auth");

            // Init audit log schema
            {
                let _conn = db::open(&app_data_dir).expect("DB open for audit schema");
            }

            app.manage(db::AppDataDir(app_data_dir));
            app.manage(AuthState(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            auth::login,
            auth::logout,
            auth::get_session,
            auth::setup_profile,
            auth::get_users,
            auth::create_user,
            auth::delete_user,
            auth::set_user_role,
            auth::reset_user_password,
            // Audit
            // Events
            events::get_events,
            events::create_event,
            events::delete_event,
            events::get_financial_years,
            // Participants
            participants::get_participants,
            participants::save_participants,
            participants::update_participant,
            participants::delete_participant,
            // Scanning
            scan::scan_sheet,
            scan::scan_batch,
            scan::get_scan_queue_status,
            scan::check_connectivity,
            // Reports
            reports::get_report,
            // Export
            export::export_excel,
            export::export_csv,
            // Logs
            logs::get_logs,
            logs::get_log_summary,
            // Config
            config::get_config,
            config::save_config,
            config::backup_database,
            config::restore_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KIBT-AMS");
}
