mod auth;
mod sync;
mod custom_tables;
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
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to resolve app data directory");

            // Ensure the full directory tree exists (critical on Windows)
            if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
                eprintln!("[setup] Failed to create app data dir {:?}: {}", app_data_dir, e);
                // Try fallback to current directory
                return Err(Box::new(e));
            }

            eprintln!("[setup] App data dir: {:?}", app_data_dir);

            db::init(&app_data_dir).expect("Failed to initialise database");
            auth::init_auth(&app_data_dir).expect("Failed to initialise auth");

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
            auth::verify_recovery_code,
            auth::reset_password_with_code,
            // Events
            events::get_events,
            events::create_event,
            events::delete_event,
            events::get_event_stats,
            events::get_financial_years,
            events::get_event_sessions,
            events::create_session,
            events::update_session,
            events::delete_session,
            // Participants
            participants::get_participants,
            participants::save_participants,
            participants::check_duplicates,
            participants::update_participant,
            participants::delete_participant,
            participants::import_participants,
            // Scanning (Gemini online only)
            scan::scan_sheet,
            scan::scan_batch,
            scan::get_scan_queue_status,
            scan::check_connectivity,
            // Reports
            reports::get_report,
            reports::export_report_excel,
            reports::export_report_csv,
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
            // Custom dynamic tables
            custom_tables::get_custom_tables,
            custom_tables::get_custom_table,
            custom_tables::create_custom_table,
            custom_tables::update_custom_table,
            custom_tables::delete_custom_table,
            custom_tables::get_custom_table_rows,
            custom_tables::upsert_custom_table_rows,
            custom_tables::update_custom_table_row,
            custom_tables::delete_custom_table_row,
            custom_tables::create_from_list,
            custom_tables::export_custom_table_csv,
            custom_tables::export_custom_table_excel,
            custom_tables::scan_into_custom_table,
            custom_tables::scan_batch_into_custom_table,
            // Offline sync (USB / file transfer)
            sync::export_sync_package,
            sync::peek_sync_package,
            sync::import_sync_package,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KIBT-AMS");
}
