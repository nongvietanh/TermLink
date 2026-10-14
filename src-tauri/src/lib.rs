//! TermLink native backend.

pub mod commands;
pub mod credentials;
pub mod db;
pub mod domain;
pub mod error;
pub mod portability;
pub mod session;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use commands::AppState;
use credentials::{KeyringStore, SecretStore};

/// Credential-store service name. Debug builds use a separate namespace so
/// development never touches secrets saved by an installed release.
const CREDENTIAL_SERVICE: &str = if cfg!(debug_assertions) {
    "TermLink-dev"
} else {
    "TermLink"
};

/// Debug builds keep their data apart from an installed release, and can be
/// pointed at a throwaway directory with TERMLINK_DATA_DIR (used by the app
/// smoke test). Release builds ignore the variable.
fn data_dir(default: std::path::PathBuf) -> std::path::PathBuf {
    if cfg!(debug_assertions) {
        if let Some(dir) = std::env::var_os("TERMLINK_DATA_DIR") {
            return dir.into();
        }
        return default.join("dev");
    }
    default
}

fn logger() -> tauri_plugin_log::Builder {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("termlink".into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .targets(targets)
        .level(log::LevelFilter::Info)
        // Protocol libraries are noisy at info level and may log connection details.
        .level_for("russh", log::LevelFilter::Warn)
        .level_for("russh_keys", log::LevelFilter::Warn)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepSome(5))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(logger().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = data_dir(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("termlink.db");
            let db = Arc::new(db::Db::open(&db_path).map_err(|e| {
                log::error!("failed to open database at {}: {e}", db_path.display());
                e
            })?);
            db::history::close_dangling_sessions(&db)?;
            // Ship a useful starter snippet library on first run (one-time).
            if let Err(e) = db::snippets::seed_defaults_once(&db) {
                log::warn!("could not seed default snippets: {e}");
            }
            let secrets: Arc<dyn SecretStore> = Arc::new(KeyringStore::new(CREDENTIAL_SERVICE));
            let sessions = session::SessionManager::new(db.clone(), secrets.clone());
            log::info!(
                "TermLink {} started (schema v{}, credentials: {})",
                env!("CARGO_PKG_VERSION"),
                db::SCHEMA_VERSION,
                secrets.backend_name()
            );
            app.manage(AppState {
                db,
                secrets,
                sessions,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::groups_list,
            commands::group_create,
            commands::group_update,
            commands::group_set_expanded,
            commands::group_delete,
            commands::profiles_list,
            commands::profile_create,
            commands::profile_update,
            commands::profile_duplicate,
            commands::profiles_delete,
            commands::profile_set_favorite,
            commands::profiles_move,
            commands::profiles_export,
            commands::profiles_import,
            commands::key_file_pick,
            commands::save_text_file,
            commands::credential_set,
            commands::credential_delete,
            commands::known_hosts_list,
            commands::known_host_delete,
            commands::snippets_list,
            commands::snippet_create,
            commands::snippet_update,
            commands::snippet_delete,
            commands::snippets_restore_defaults,
            commands::session_history_list,
            commands::session_history_clear,
            commands::command_history_list,
            commands::command_history_record,
            commands::command_history_clear,
            commands::settings_get,
            commands::settings_update,
            commands::local_shells,
            commands::session_open,
            commands::session_write,
            commands::session_resize,
            commands::session_respond,
            commands::session_close,
            commands::sessions_list,
            commands::sftp_home,
            commands::sftp_list,
            commands::sftp_realpath,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_delete,
            commands::local_home,
            commands::local_list,
            commands::transfer_start,
            commands::transfer_cancel,
            commands::transfer_history_list,
            commands::transfer_history_clear,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TermLink");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.sessions.close_all();
            }
        }
    });
}
