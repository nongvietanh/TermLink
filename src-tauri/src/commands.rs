//! Tauri IPC commands.
//!
//! This is the trust boundary between the webview and the native backend.
//! Every argument is deserialized strictly and validated before use; commands
//! never accept file paths for import/export (native dialogs are opened by the
//! backend instead), never accept shell commands to execute, and never return
//! secret values.

use std::sync::Arc;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::credentials::{SecretKey, SecretStore};
use crate::db::profiles::SecretFlag;
use crate::db::{self, Db};
use crate::domain::profile::{AuthMethod, Profile, ProfileInput, Protocol, SshOptions};
use crate::domain::settings::AppSettings;
use crate::domain::validation as v;
use crate::domain::{
    CommandHistoryEntry, CommandSource, Group, GroupInput, KnownHost, SessionHistoryEntry, Snippet,
    SnippetInput,
};
use crate::error::{AppError, AppResult};
use crate::portability::{self, ImportSummary};
use crate::session::shells::{self, ShellInfo};
use crate::session::ssh::SshTarget;
use crate::session::{
    PromptResponse, SessionEvent, SessionManager, SessionSink, SessionSpec, SessionSummary,
};

pub struct AppState {
    pub db: Arc<Db>,
    pub secrets: Arc<dyn SecretStore>,
    pub sessions: Arc<SessionManager>,
}

type Cmd<'a> = State<'a, AppState>;

// ---------------------------------------------------------------------------
// App

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    schema_version: u32,
    credential_backend: String,
    platform: String,
}

#[tauri::command]
pub fn app_info(state: Cmd<'_>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        schema_version: db::SCHEMA_VERSION,
        credential_backend: state.secrets.backend_name().into(),
        platform: std::env::consts::OS.into(),
    }
}

// ---------------------------------------------------------------------------
// Groups

#[tauri::command]
pub async fn groups_list(state: Cmd<'_>) -> AppResult<Vec<Group>> {
    db::groups::list(&state.db)
}

#[tauri::command]
pub async fn group_create(state: Cmd<'_>, input: GroupInput) -> AppResult<Group> {
    db::groups::create(&state.db, input)
}

#[tauri::command]
pub async fn group_update(state: Cmd<'_>, id: String, input: GroupInput) -> AppResult<Group> {
    db::groups::update(&state.db, &v::id("Group", &id)?, input)
}

#[tauri::command]
pub async fn group_set_expanded(state: Cmd<'_>, id: String, expanded: bool) -> AppResult<()> {
    db::groups::set_expanded(&state.db, &v::id("Group", &id)?, expanded)
}

#[tauri::command]
pub async fn group_delete(state: Cmd<'_>, id: String) -> AppResult<()> {
    db::groups::delete(&state.db, &v::id("Group", &id)?)
}

// ---------------------------------------------------------------------------
// Profiles

#[tauri::command]
pub async fn profiles_list(state: Cmd<'_>) -> AppResult<Vec<Profile>> {
    db::profiles::list(&state.db)
}

#[tauri::command]
pub async fn profile_create(state: Cmd<'_>, input: ProfileInput) -> AppResult<Profile> {
    db::profiles::create(&state.db, input)
}

#[tauri::command]
pub async fn profile_update(state: Cmd<'_>, id: String, input: ProfileInput) -> AppResult<Profile> {
    let id = v::id("Profile", &id)?;
    let out = db::profiles::update(&state.db, &id, input)?;
    if out.clear_password {
        state.secrets.delete(&SecretKey::password(&id))?;
    }
    if out.clear_passphrase {
        state.secrets.delete(&SecretKey::passphrase(&id))?;
    }
    Ok(out.profile)
}

#[tauri::command]
pub async fn profile_duplicate(state: Cmd<'_>, id: String) -> AppResult<Profile> {
    db::profiles::duplicate(&state.db, &v::id("Profile", &id)?)
}

fn validate_ids(ids: &[String]) -> AppResult<Vec<String>> {
    if ids.len() > 10_000 {
        return Err(AppError::validation("Too many items selected"));
    }
    ids.iter().map(|id| v::id("Profile", id)).collect()
}

#[tauri::command]
pub async fn profiles_delete(state: Cmd<'_>, ids: Vec<String>) -> AppResult<usize> {
    let ids = validate_ids(&ids)?;
    let deleted = db::profiles::delete_many(&state.db, &ids)?;
    for p in &deleted {
        // Best effort: a failure here leaves an orphaned secret, never a leaked one.
        let _ = state.secrets.delete(&SecretKey::password(&p.id));
        let _ = state.secrets.delete(&SecretKey::passphrase(&p.id));
    }
    Ok(deleted.len())
}

#[tauri::command]
pub async fn profile_set_favorite(
    state: Cmd<'_>,
    id: String,
    favorite: bool,
) -> AppResult<Profile> {
    db::profiles::set_favorite(&state.db, &v::id("Profile", &id)?, favorite)
}

#[tauri::command]
pub async fn profiles_move(
    state: Cmd<'_>,
    ids: Vec<String>,
    group_id: Option<String>,
) -> AppResult<()> {
    let ids = validate_ids(&ids)?;
    let group = group_id.map(|g| v::id("Group", &g)).transpose()?;
    db::profiles::move_many(&state.db, &ids, group.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    path: String,
    profiles: usize,
    groups: usize,
}

#[tauri::command]
pub async fn profiles_export(app: AppHandle, state: Cmd<'_>) -> AppResult<Option<ExportResult>> {
    let doc = portability::export(&state.db)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Export connection profiles")
            .add_filter("TermLink profiles", &["json"])
            .set_file_name("termlink-profiles.json")
            .blocking_save_file()
    })
    .await
    .map_err(|_| AppError::internal("The file dialog failed"))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let path = if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("json"))
    {
        path
    } else {
        path.with_extension("json")
    };
    let json = serde_json::to_vec_pretty(&doc)?;
    tokio::fs::write(&path, json).await?;
    Ok(Some(ExportResult {
        path: path.to_string_lossy().into_owned(),
        profiles: doc.profiles.len(),
        groups: doc.groups.len(),
    }))
}

#[tauri::command]
pub async fn profiles_import(app: AppHandle, state: Cmd<'_>) -> AppResult<Option<ImportSummary>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import connection profiles")
            .add_filter("TermLink profiles", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| AppError::internal("The file dialog failed"))?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let meta = tokio::fs::metadata(&path).await?;
    if meta.len() > portability::MAX_IMPORT_BYTES as u64 {
        return Err(AppError::validation("The import file is larger than 5 MB"));
    }
    let bytes = tokio::fs::read(&path).await?;
    let doc = portability::parse(&bytes)?;
    portability::import(&state.db, doc).map(Some)
}

/// Lets the user choose a private key file with a native dialog.
#[tauri::command]
pub async fn key_file_pick(app: AppHandle) -> AppResult<Option<String>> {
    let start = crate::session::ssh::home_dir().map(|h| h.join(".ssh"));
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("Select private key");
        if let Some(dir) = start.filter(|d| d.is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|_| AppError::internal("The file dialog failed"))?;
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

// ---------------------------------------------------------------------------
// Credentials

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Password,
    Passphrase,
}

impl CredentialKind {
    fn key(self, id: &str) -> (SecretKey, SecretFlag) {
        match self {
            CredentialKind::Password => (SecretKey::password(id), SecretFlag::Password),
            CredentialKind::Passphrase => (SecretKey::passphrase(id), SecretFlag::Passphrase),
        }
    }
}

/// Saves a secret for a profile in the OS credential store.
#[tauri::command]
pub async fn credential_set(
    state: Cmd<'_>,
    profile_id: String,
    kind: CredentialKind,
    secret: String,
) -> AppResult<()> {
    let secret = zeroize::Zeroizing::new(secret);
    let id = v::id("Profile", &profile_id)?;
    db::profiles::get(&state.db, &id)?;
    if secret.len() > 4096 {
        return Err(AppError::validation("The secret is too long"));
    }
    let (key, flag) = kind.key(&id);
    state.secrets.set(&key, &secret)?;
    db::profiles::set_secret_flag(&state.db, &id, flag, true)
}

#[tauri::command]
pub async fn credential_delete(
    state: Cmd<'_>,
    profile_id: String,
    kind: CredentialKind,
) -> AppResult<()> {
    let id = v::id("Profile", &profile_id)?;
    let (key, flag) = kind.key(&id);
    state.secrets.delete(&key)?;
    db::profiles::set_secret_flag(&state.db, &id, flag, false)
}

// ---------------------------------------------------------------------------
// Known hosts

#[tauri::command]
pub async fn known_hosts_list(state: Cmd<'_>) -> AppResult<Vec<KnownHost>> {
    db::known_hosts::list(&state.db)
}

#[tauri::command]
pub async fn known_host_delete(state: Cmd<'_>, id: i64) -> AppResult<()> {
    db::known_hosts::delete(&state.db, id)
}

// ---------------------------------------------------------------------------
// Snippets

#[tauri::command]
pub async fn snippets_list(state: Cmd<'_>) -> AppResult<Vec<Snippet>> {
    db::snippets::list(&state.db)
}

#[tauri::command]
pub async fn snippet_create(state: Cmd<'_>, input: SnippetInput) -> AppResult<Snippet> {
    db::snippets::create(&state.db, input)
}

#[tauri::command]
pub async fn snippet_update(state: Cmd<'_>, id: String, input: SnippetInput) -> AppResult<Snippet> {
    db::snippets::update(&state.db, &v::id("Snippet", &id)?, input)
}

#[tauri::command]
pub async fn snippet_delete(state: Cmd<'_>, id: String) -> AppResult<()> {
    db::snippets::delete(&state.db, &v::id("Snippet", &id)?)
}

// ---------------------------------------------------------------------------
// History

#[tauri::command]
pub async fn session_history_list(
    state: Cmd<'_>,
    limit: Option<u32>,
) -> AppResult<Vec<SessionHistoryEntry>> {
    db::history::list_sessions(&state.db, limit.unwrap_or(100))
}

#[tauri::command]
pub async fn session_history_clear(state: Cmd<'_>) -> AppResult<()> {
    db::history::clear_sessions(&state.db)
}

#[tauri::command]
pub async fn command_history_list(
    state: Cmd<'_>,
    query: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<CommandHistoryEntry>> {
    db::history::list_commands(&state.db, query.as_deref(), limit.unwrap_or(200))
}

#[tauri::command]
pub async fn command_history_clear(state: Cmd<'_>) -> AppResult<()> {
    db::history::clear_commands(&state.db)
}

// ---------------------------------------------------------------------------
// Settings

#[tauri::command]
pub async fn settings_get(state: Cmd<'_>) -> AppResult<AppSettings> {
    db::settings::load(&state.db)
}

#[tauri::command]
pub async fn settings_update(state: Cmd<'_>, settings: AppSettings) -> AppResult<AppSettings> {
    db::settings::save(&state.db, settings)
}

// ---------------------------------------------------------------------------
// Sessions

#[tauri::command]
pub async fn local_shells() -> Vec<ShellInfo> {
    shells::detect()
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum OpenRequest {
    #[serde(rename_all = "camelCase")]
    Profile { profile_id: String },
    #[serde(rename_all = "camelCase")]
    Quick {
        host: String,
        port: u32,
        username: String,
        auth_method: AuthMethod,
        #[serde(default)]
        key_path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Local {
        #[serde(default)]
        shell_id: Option<String>,
    },
}

struct ChannelSink {
    data: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
}

impl SessionSink for ChannelSink {
    fn data(&self, bytes: &[u8]) {
        let _ = self.data.send(InvokeResponseBody::Raw(bytes.to_vec()));
    }

    fn event(&self, event: SessionEvent) {
        let _ = self.events.send(event);
    }
}

fn local_spec(shell_id: Option<&str>, settings: &AppSettings) -> AppResult<SessionSpec> {
    let id = shell_id.or(settings.local_terminal.default_shell.as_deref());
    let shell = shells::resolve(id)
        .or_else(|| shells::resolve(None))
        .ok_or_else(|| AppError::unsupported("No local shell was found on this system"))?;
    Ok(SessionSpec::Local(shell))
}

fn resolve_spec(state: &AppState, request: OpenRequest) -> AppResult<SessionSpec> {
    let settings = db::settings::load(&state.db)?;
    match request {
        OpenRequest::Local { shell_id } => {
            if let Some(id) = &shell_id {
                v::name("Shell", id, 64)?;
            }
            local_spec(shell_id.as_deref(), &settings)
        }
        OpenRequest::Quick {
            host,
            port,
            username,
            auth_method,
            key_path,
        } => {
            let host = v::host(&host)?;
            let port = v::port(port)?;
            let username = v::username(&username)?;
            let key_path = match auth_method {
                AuthMethod::PublicKey => Some(v::local_path(
                    "Private key file",
                    key_path.as_deref().unwrap_or(""),
                )?),
                _ => None,
            };
            Ok(SessionSpec::Ssh(SshTarget {
                profile_id: None,
                label: format!("{username}@{host}"),
                host,
                port,
                username,
                auth_method,
                key_path,
                options: SshOptions {
                    connect_timeout_secs: settings.ssh.connect_timeout_secs,
                    keepalive_interval_secs: settings.ssh.keepalive_interval_secs,
                    ..SshOptions::default()
                },
                term_type: settings.terminal.term_type.clone(),
                env: Vec::new(),
            }))
        }
        OpenRequest::Profile { profile_id } => {
            let profile = db::profiles::get(&state.db, &v::id("Profile", &profile_id)?)?;
            match profile.protocol {
                Protocol::Ssh => Ok(SessionSpec::Ssh(SshTarget {
                    profile_id: Some(profile.id.clone()),
                    label: profile.name.clone(),
                    host: profile.host.clone(),
                    port: profile.port,
                    username: profile.username.clone(),
                    auth_method: profile.auth_method,
                    key_path: profile.key_path.clone(),
                    env: profile.ssh.env.clone(),
                    options: profile.ssh.clone(),
                    term_type: profile
                        .terminal
                        .term_type
                        .clone()
                        .unwrap_or_else(|| settings.terminal.term_type.clone()),
                })),
                Protocol::Local => {
                    let _ = db::profiles::mark_connected(&state.db, &profile.id);
                    local_spec(None, &settings)
                }
                Protocol::Rdp => Err(AppError::unsupported(
                    "RDP connections are planned but not available in this version",
                )),
                Protocol::Vnc => Err(AppError::unsupported(
                    "VNC connections are planned but not available in this version",
                )),
            }
        }
    }
}

#[tauri::command]
pub async fn session_open(
    state: Cmd<'_>,
    request: OpenRequest,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_event: Channel<SessionEvent>,
) -> AppResult<SessionSummary> {
    let spec = resolve_spec(&state, request)?;
    let sink = Arc::new(ChannelSink {
        data: on_data,
        events: on_event,
    });
    state.sessions.open(spec, cols, rows, sink)
}

#[tauri::command]
pub async fn session_write(state: Cmd<'_>, id: String, data: String) -> AppResult<()> {
    state
        .sessions
        .write(&v::id("Session", &id)?, Bytes::from(data.into_bytes()))
        .await
}

#[tauri::command]
pub async fn session_resize(state: Cmd<'_>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    state
        .sessions
        .resize(&v::id("Session", &id)?, cols, rows)
        .await
}

#[tauri::command]
pub async fn session_respond(
    state: Cmd<'_>,
    id: String,
    request_id: String,
    response: PromptResponse,
) -> AppResult<()> {
    state.sessions.respond(
        &v::id("Session", &id)?,
        &v::id("Request", &request_id)?,
        response,
    )
}

#[tauri::command]
pub async fn session_close(state: Cmd<'_>, id: String) -> AppResult<()> {
    state.sessions.close(&v::id("Session", &id)?);
    Ok(())
}

#[tauri::command]
pub async fn sessions_list(state: Cmd<'_>) -> AppResult<Vec<SessionSummary>> {
    Ok(state.sessions.list())
}

/// Records a command TermLink sent to a terminal on the user's behalf.
#[tauri::command]
pub async fn command_history_record(
    state: Cmd<'_>,
    profile_id: Option<String>,
    target_label: String,
    command: String,
    source: CommandSource,
) -> AppResult<()> {
    let profile_id = profile_id.map(|p| v::id("Profile", &p)).transpose()?;
    let label = v::text("Target", &target_label, 200)?;
    db::history::record_command(&state.db, profile_id.as_deref(), &label, &command, source)
}
