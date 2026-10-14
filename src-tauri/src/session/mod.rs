//! Interactive session lifecycle (SSH shells and local terminals).
//!
//! Each session runs as its own async task. The frontend talks to it through:
//! - a raw byte stream (terminal output) and a typed event stream, delivered via
//!   a [`SessionSink`];
//! - commands (input, resize, close) sent over an mpsc channel;
//! - prompt responses (host-key decisions, credentials) routed through
//!   [`Prompts`], so a connection never proceeds past a security decision
//!   without an explicit answer from the user.

pub mod local;
pub mod shells;
pub mod ssh;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::credentials::SecretStore;
use crate::db::Db;
use crate::error::{AppError, AppResult, ErrorKind};

/// How long a prompt (host key, password) may stay unanswered.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Largest single input write accepted from the UI.
pub const MAX_WRITE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Connecting,
    Verifying,
    Authenticating,
    Connected,
    Disconnected,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Ssh,
    Local,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousHostKey {
    pub fingerprint: String,
    pub algorithm: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyStatusKind {
    Unknown,
    Changed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthPromptKind {
    Password,
    Passphrase,
    KeyboardInteractive,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptField {
    pub label: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub host_key_fingerprint: Option<String>,
    pub host_key_algorithm: Option<String>,
    /// TCP connect round-trip in milliseconds (approximate latency).
    pub connect_ms: Option<u64>,
    pub shell: Option<String>,
}

/// Events streamed to the UI. Never contains secret values.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionEvent {
    #[serde(rename_all = "camelCase")]
    Status {
        state: SessionState,
        message: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    HostKeyPrompt {
        request_id: String,
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
        status: HostKeyStatusKind,
        previous: Vec<PreviousHostKey>,
    },
    #[serde(rename_all = "camelCase")]
    AuthPrompt {
        request_id: String,
        kind: AuthPromptKind,
        title: String,
        instructions: String,
        fields: Vec<PromptField>,
        can_save: bool,
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    PromptClosed { request_id: String },
    #[serde(rename_all = "camelCase")]
    Banner { text: String },
    #[serde(rename_all = "camelCase")]
    Connected { info: ConnectionInfo },
    #[serde(rename_all = "camelCase")]
    Exit {
        code: Option<u32>,
        signal: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Error { error: AppError },
    #[serde(rename_all = "camelCase")]
    Closed { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyDecision {
    Reject,
    AcceptOnce,
    AcceptAndSave,
}

/// A user's answer to a prompt.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum PromptResponse {
    #[serde(rename_all = "camelCase")]
    HostKey {
        decision: HostKeyDecision,
    },
    #[serde(rename_all = "camelCase")]
    Credentials {
        values: Vec<String>,
        #[serde(default)]
        save: bool,
    },
    Cancel,
}

impl std::fmt::Debug for PromptResponse {
    // Never print credential values.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PromptResponse::HostKey { decision } => write!(f, "HostKey({decision:?})"),
            PromptResponse::Credentials { values, save } => {
                write!(f, "Credentials({} values, save={save})", values.len())
            }
            PromptResponse::Cancel => write!(f, "Cancel"),
        }
    }
}

impl Drop for PromptResponse {
    fn drop(&mut self) {
        if let PromptResponse::Credentials { values, .. } = self {
            use zeroize::Zeroize;
            for v in values.iter_mut() {
                v.zeroize();
            }
        }
    }
}

/// Credentials extracted from a prompt response; zeroized on drop.
pub struct CredentialAnswer {
    pub values: Vec<Zeroizing<String>>,
    pub save: bool,
}

/// Destination for session output and events.
pub trait SessionSink: Send + Sync + 'static {
    fn data(&self, bytes: &[u8]);
    fn event(&self, event: SessionEvent);
}

#[derive(Debug)]
pub enum SessionCommand {
    Write(Bytes),
    Resize { cols: u16, rows: u16 },
}

/// Pending prompts of one session, keyed by request id.
#[derive(Default)]
pub struct Prompts {
    pending: Mutex<HashMap<String, oneshot::Sender<PromptResponse>>>,
    /// Number of prompts currently waiting on the user; while non-zero,
    /// connection timeouts are paused.
    active: AtomicUsize,
}

impl Prompts {
    fn register(&self) -> (String, oneshot::Receiver<PromptResponse>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(id.clone(), tx);
        (id, rx)
    }

    pub fn respond(&self, request_id: &str, response: PromptResponse) -> AppResult<()> {
        let tx = self
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(request_id)
            .ok_or_else(|| AppError::not_found("Prompt"))?;
        tx.send(response)
            .map_err(|_| AppError::new(ErrorKind::SessionClosed, "The prompt is no longer active"))
    }

    pub fn is_waiting(&self) -> bool {
        self.active.load(Ordering::SeqCst) > 0
    }

    fn remove(&self, request_id: &str) {
        self.pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(request_id);
    }
}

/// Everything a running session needs.
pub struct SessionCtx {
    pub id: String,
    pub db: Arc<Db>,
    pub secrets: Arc<dyn SecretStore>,
    pub sink: Arc<dyn SessionSink>,
    pub prompts: Arc<Prompts>,
    pub cancel: CancellationToken,
}

impl SessionCtx {
    pub fn status(&self, state: SessionState, message: Option<&str>) {
        self.sink.event(SessionEvent::Status {
            state,
            message: message.map(String::from),
        });
    }

    /// Emits a prompt built from a fresh request id and waits for the answer.
    pub async fn ask(
        &self,
        build: impl FnOnce(String) -> SessionEvent,
    ) -> AppResult<PromptResponse> {
        let (id, rx) = self.prompts.register();
        self.prompts.active.fetch_add(1, Ordering::SeqCst);
        self.sink.event(build(id.clone()));
        let result = tokio::select! {
            r = rx => r.map_err(|_| AppError::cancelled()),
            _ = self.cancel.cancelled() => Err(AppError::cancelled()),
            _ = tokio::time::sleep(PROMPT_TIMEOUT) => Err(AppError::new(
                ErrorKind::Timeout,
                "The prompt was not answered in time",
            )),
        };
        self.prompts.active.fetch_sub(1, Ordering::SeqCst);
        self.prompts.remove(&id);
        if result.is_err() {
            self.sink
                .event(SessionEvent::PromptClosed { request_id: id });
        }
        result
    }

    /// Asks for credentials; `Cancel` or a non-credential answer aborts.
    pub async fn ask_credentials(
        &self,
        kind: AuthPromptKind,
        title: String,
        instructions: String,
        fields: Vec<PromptField>,
        can_save: bool,
        error: Option<String>,
    ) -> AppResult<CredentialAnswer> {
        let expected = fields.len();
        let mut response = self
            .ask(|request_id| SessionEvent::AuthPrompt {
                request_id,
                kind,
                title,
                instructions,
                fields,
                can_save,
                error,
            })
            .await?;
        match &mut response {
            PromptResponse::Credentials { values, save } => {
                if values.len() != expected {
                    return Err(AppError::validation("Unexpected number of answers"));
                }
                if values.iter().any(|v| v.len() > 4096) {
                    return Err(AppError::validation("Answer is too long"));
                }
                Ok(CredentialAnswer {
                    values: values.drain(..).map(Zeroizing::new).collect(),
                    save: *save && can_save,
                })
            }
            _ => Err(AppError::new(
                ErrorKind::Authentication,
                "Authentication was cancelled",
            )),
        }
    }
}

/// Publicly visible state of a session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub kind: SessionKind,
    pub label: String,
    pub profile_id: Option<String>,
}

struct SessionHandle {
    summary: SessionSummary,
    commands: mpsc::Sender<SessionCommand>,
    prompts: Arc<Prompts>,
    cancel: CancellationToken,
}

/// Registry of running sessions.
pub struct SessionManager {
    db: Arc<Db>,
    secrets: Arc<dyn SecretStore>,
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

pub enum SessionSpec {
    Ssh(ssh::SshTarget),
    Local(shells::ShellInfo),
}

impl SessionManager {
    pub fn new(db: Arc<Db>, secrets: Arc<dyn SecretStore>) -> Arc<Self> {
        Arc::new(Self {
            db,
            secrets,
            sessions: Mutex::new(HashMap::new()),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionHandle>> {
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Starts a session in the background and returns its id immediately.
    /// Progress, prompts and output are delivered through `sink`.
    pub fn open(
        self: &Arc<Self>,
        spec: SessionSpec,
        cols: u16,
        rows: u16,
        sink: Arc<dyn SessionSink>,
    ) -> AppResult<SessionSummary> {
        let (cols, rows) = clamp_size(cols, rows);
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel(256);
        let prompts = Arc::new(Prompts::default());
        let cancel = CancellationToken::new();
        let summary = match &spec {
            SessionSpec::Ssh(t) => SessionSummary {
                id: id.clone(),
                kind: SessionKind::Ssh,
                label: t.label.clone(),
                profile_id: t.profile_id.clone(),
            },
            SessionSpec::Local(shell) => SessionSummary {
                id: id.clone(),
                kind: SessionKind::Local,
                label: shell.name.clone(),
                profile_id: None,
            },
        };
        self.lock().insert(
            id.clone(),
            SessionHandle {
                summary: summary.clone(),
                commands: tx,
                prompts: prompts.clone(),
                cancel: cancel.clone(),
            },
        );
        let ctx = Arc::new(SessionCtx {
            id: id.clone(),
            db: self.db.clone(),
            secrets: self.secrets.clone(),
            sink,
            prompts,
            cancel,
        });
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let reason = match spec {
                SessionSpec::Ssh(target) => ssh::run(ctx.clone(), target, cols, rows, rx).await,
                SessionSpec::Local(shell) => local::run(ctx.clone(), shell, cols, rows, rx).await,
            };
            manager.lock().remove(&ctx.id);
            ctx.sink.event(SessionEvent::Closed { reason });
        });
        Ok(summary)
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&SessionHandle) -> T) -> AppResult<T> {
        self.lock()
            .get(id)
            .map(f)
            .ok_or_else(AppError::session_closed)
    }

    pub async fn write(&self, id: &str, data: Bytes) -> AppResult<()> {
        if data.len() > MAX_WRITE_BYTES {
            return Err(AppError::validation("Input is too large to send at once"));
        }
        let tx = self.with(id, |h| h.commands.clone())?;
        tx.send(SessionCommand::Write(data))
            .await
            .map_err(|_| AppError::session_closed())
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let (cols, rows) = clamp_size(cols, rows);
        let tx = self.with(id, |h| h.commands.clone())?;
        tx.send(SessionCommand::Resize { cols, rows })
            .await
            .map_err(|_| AppError::session_closed())
    }

    pub fn respond(&self, id: &str, request_id: &str, response: PromptResponse) -> AppResult<()> {
        let prompts = self.with(id, |h| h.prompts.clone())?;
        prompts.respond(request_id, response)
    }

    /// Requests a session to end. Closing an already-closed session is not an error.
    pub fn close(&self, id: &str) {
        if let Some(h) = self.lock().get(id) {
            h.cancel.cancel();
        }
    }

    pub fn close_all(&self) {
        for h in self.lock().values() {
            h.cancel.cancel();
        }
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        self.lock().values().map(|h| h.summary.clone()).collect()
    }
}

pub fn clamp_size(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(2, 1000), rows.clamp(1, 500))
}

/// Removes terminal control sequences from server-provided text (banners,
/// prompt labels) before it is shown in the UI outside of the terminal.
pub fn sanitize_display(text: &str, max: usize) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(max)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_response_never_debug_prints_secrets() {
        let r: PromptResponse =
            serde_json::from_str(r#"{"type":"credentials","values":["hunter2"],"save":true}"#)
                .unwrap();
        let printed = format!("{r:?}");
        assert!(!printed.contains("hunter2"));
        assert!(printed.contains("1 values"));
    }

    #[test]
    fn prompt_response_rejects_unknown_shape() {
        assert!(
            serde_json::from_str::<PromptResponse>(r#"{"type":"hostKey","decision":"yolo"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<PromptResponse>(r#"{"type":"cancel"}"#).is_ok());
    }

    #[test]
    fn sanitize_strips_escape_sequences() {
        assert_eq!(
            sanitize_display("hi\u{1b}[31mred\u{7}\n", 100),
            "hi[31mred\n"
        );
        assert_eq!(sanitize_display("abcdef", 3), "abc");
    }

    #[test]
    fn clamp_size_bounds() {
        assert_eq!(clamp_size(0, 0), (2, 1));
        assert_eq!(clamp_size(5000, 5000), (1000, 500));
        assert_eq!(clamp_size(80, 24), (80, 24));
    }

    #[tokio::test]
    async fn prompts_roundtrip_and_unknown_ids() {
        let prompts = Prompts::default();
        let (id, rx) = prompts.register();
        prompts
            .respond(
                &id,
                PromptResponse::HostKey {
                    decision: HostKeyDecision::Reject,
                },
            )
            .unwrap();
        assert!(matches!(
            rx.await.unwrap(),
            PromptResponse::HostKey {
                decision: HostKeyDecision::Reject
            }
        ));
        assert!(prompts.respond(&id, PromptResponse::Cancel).is_err());
    }
}
