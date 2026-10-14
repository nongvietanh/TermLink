//! SSH interactive shell sessions (russh).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh::client::{self, AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{
    decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyBase64,
    PublicKeyOrCertificate,
};
use russh::{ChannelMsg, Disconnect, MethodKind, MethodSet};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use super::metrics::{
    calculate_metrics, parse_linux_snapshot, LinuxSnapshot, LINUX_METRICS_COMMAND,
    MAX_METRICS_OUTPUT,
};
use super::{
    AuthPromptKind, ConnectionInfo, HostKeyDecision, HostKeyStatusKind, PreviousHostKey,
    PromptField, PromptResponse, SessionCommand, SessionCtx, SessionEvent, SessionState,
};
use crate::credentials::{Secret, SecretKey};
use crate::db::history::{self, NewSession};
use crate::db::known_hosts::{self, HostKeyStatus, PresentedKey};
use crate::db::profiles::{self, SecretFlag};
use crate::domain::profile::{AuthMethod, EnvVar, SshOptions};
use crate::error::{AppError, AppResult, ErrorKind};

const MAX_PASSWORD_ATTEMPTS: usize = 3;
const MAX_KEY_FILE_BYTES: u64 = 256 * 1024;

/// Fully resolved SSH connection parameters (secrets are fetched later).
#[derive(Debug, Clone)]
pub struct SshTarget {
    pub profile_id: Option<String>,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub key_path: Option<String>,
    pub options: SshOptions,
    pub term_type: String,
    pub env: Vec<EnvVar>,
}

/// Handler error: russh errors plus our own host-key outcome.
#[derive(Debug)]
pub enum SshError {
    Russh(russh::Error),
    HostKey(AppError),
}

impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        SshError::Russh(e)
    }
}

/// Host key details captured during verification, reported once connected.
#[derive(Default, Clone)]
struct HostKeyInfo {
    fingerprint: Option<String>,
    algorithm: Option<String>,
}

struct ClientHandler {
    ctx: Arc<SessionCtx>,
    host: String,
    port: u16,
    info: Arc<Mutex<HostKeyInfo>>,
}

impl client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Certificates are verified like plain keys (CA trust is not configured).
        let key: PublicKey = match server_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(cert) => PublicKey::from(cert.public_key().clone()),
        };
        verify_host_key(&self.ctx, &self.host, self.port, &key, &self.info)
            .await
            .map(|()| true)
            .map_err(SshError::HostKey)
    }

    async fn auth_banner(
        &mut self,
        banner: &str,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let text = super::sanitize_display(banner, 8_000);
        if !text.trim().is_empty() {
            self.ctx.sink.event(SessionEvent::Banner { text });
        }
        Ok(())
    }
}

/// Verifies a server key against the trusted store, asking the user when the
/// key is unknown or has changed. Unknown or changed keys are never trusted
/// silently.
async fn verify_host_key(
    ctx: &SessionCtx,
    host: &str,
    port: u16,
    key: &PublicKey,
    info: &Mutex<HostKeyInfo>,
) -> AppResult<()> {
    let algorithm = key.algorithm().as_str().to_string();
    let public_key = key.public_key_base64();
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    {
        let mut i = info.lock().unwrap_or_else(|p| p.into_inner());
        i.fingerprint = Some(fingerprint.clone());
        i.algorithm = Some(algorithm.clone());
    }
    let presented = PresentedKey {
        host,
        port,
        algorithm: &algorithm,
        public_key: &public_key,
        fingerprint: &fingerprint,
    };
    let status = known_hosts::check(&ctx.db, &presented)?;
    let (kind, previous) = match status {
        HostKeyStatus::Trusted => return Ok(()),
        HostKeyStatus::Unknown => (HostKeyStatusKind::Unknown, Vec::new()),
        HostKeyStatus::Changed { previous } => {
            log::warn!("host key for {host}:{port} differs from the trusted key");
            (
                HostKeyStatusKind::Changed,
                previous
                    .into_iter()
                    .map(|(fingerprint, algorithm)| PreviousHostKey {
                        fingerprint,
                        algorithm,
                    })
                    .collect(),
            )
        }
    };
    ctx.status(
        SessionState::Verifying,
        Some("Waiting for host key confirmation"),
    );
    let response = ctx
        .ask(|request_id| SessionEvent::HostKeyPrompt {
            request_id,
            host: host.to_string(),
            port,
            algorithm: algorithm.clone(),
            fingerprint: fingerprint.clone(),
            status: kind,
            previous,
        })
        .await?;
    let decision = match &response {
        PromptResponse::HostKey { decision } => *decision,
        _ => HostKeyDecision::Reject,
    };
    match (kind, decision) {
        (_, HostKeyDecision::AcceptAndSave) => {
            known_hosts::trust(&ctx.db, &presented, kind == HostKeyStatusKind::Changed)?;
            log::info!("host key for {host}:{port} trusted by user ({fingerprint})");
            Ok(())
        }
        // A changed key can only be accepted by explicitly replacing the stored key.
        (HostKeyStatusKind::Unknown, HostKeyDecision::AcceptOnce) => Ok(()),
        _ => Err(AppError::new(
            ErrorKind::HostKeyRejected,
            "The connection was cancelled because the host key was not trusted",
        )),
    }
}

/// Maps transport errors to user-facing messages.
fn map_russh_error(err: russh::Error) -> AppError {
    use russh::Error as E;
    match err {
        E::ConnectionTimeout | E::KeepaliveTimeout | E::InactivityTimeout => {
            AppError::new(ErrorKind::Timeout, "The connection timed out")
        }
        E::HUP | E::Disconnect => AppError::new(
            ErrorKind::Network,
            "The connection was closed by the remote host",
        ),
        E::IO(e) => AppError::new(ErrorKind::Network, format!("Network error: {}", e.kind())),
        E::NoCommonAlgo { kind, .. } => AppError::new(
            ErrorKind::Network,
            format!(
                "The server does not support any secure {kind:?} algorithm offered by TermLink"
            ),
        ),
        E::WrongServerSig => AppError::new(
            ErrorKind::HostKeyRejected,
            "The server's host key signature is invalid",
        ),
        other => {
            log::warn!("ssh error: {other}");
            AppError::new(ErrorKind::Network, format!("SSH error: {other}"))
        }
    }
}

fn map_handler_error(err: SshError) -> AppError {
    match err {
        SshError::HostKey(e) => e,
        SshError::Russh(e) => map_russh_error(e),
    }
}

fn map_connect_io(err: &std::io::Error, host: &str, port: u16) -> AppError {
    use std::io::ErrorKind as K;
    match err.kind() {
        K::ConnectionRefused => AppError::new(
            ErrorKind::Network,
            format!("Connection refused by {host}:{port}"),
        ),
        K::TimedOut => AppError::new(ErrorKind::Timeout, "The connection timed out"),
        K::NetworkUnreachable | K::HostUnreachable => {
            AppError::new(ErrorKind::Network, format!("{host} is unreachable"))
        }
        _ => AppError::new(
            ErrorKind::Network,
            format!("Could not connect to {host}:{port} ({})", err.kind()),
        ),
    }
}

/// Runs `fut` with a timeout that does not count time spent waiting for the
/// user to answer a prompt (e.g. confirming a host key).
async fn with_pausable_timeout<T>(
    ctx: &SessionCtx,
    timeout: Duration,
    fut: impl std::future::Future<Output = T>,
) -> AppResult<T> {
    tokio::pin!(fut);
    let tick = Duration::from_millis(100);
    let mut elapsed = Duration::ZERO;
    let mut interval = tokio::time::interval(tick);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            _ = ctx.cancel.cancelled() => return Err(AppError::cancelled()),
            _ = interval.tick() => {
                if !ctx.prompts.is_waiting() {
                    elapsed += tick;
                    if elapsed > timeout {
                        return Err(AppError::new(ErrorKind::Timeout, "The connection timed out"));
                    }
                }
            }
        }
    }
}

/// Session entry point. Returns the reason the session ended.
pub async fn run(
    ctx: Arc<SessionCtx>,
    target: SshTarget,
    cols: u16,
    rows: u16,
    commands: mpsc::Receiver<SessionCommand>,
) -> String {
    let history_id = history::session_started(
        &ctx.db,
        NewSession {
            profile_id: target.profile_id.as_deref(),
            protocol: "ssh",
            label: &target.label,
            host: &target.host,
            port: Some(target.port),
            username: &target.username,
        },
    )
    .map_err(|e| log::warn!("could not record session history: {e}"))
    .ok();

    let result = run_inner(&ctx, &target, cols, rows, commands, history_id).await;
    let (status, reason) = match &result {
        Ok(reason) => ("closed", reason.clone()),
        Err(e) if e.kind == ErrorKind::Cancelled => ("closed", "Disconnected".to_string()),
        Err(e) => ("failed", e.message.clone()),
    };
    if let Some(id) = history_id {
        let error = (status == "failed").then_some(reason.as_str());
        let _ = history::session_status(&ctx.db, id, status, error);
    }
    match result {
        Ok(_) => ctx.status(SessionState::Disconnected, None),
        Err(e) if e.kind == ErrorKind::Cancelled => ctx.status(SessionState::Disconnected, None),
        Err(e) => {
            ctx.sink.event(SessionEvent::Error { error: e.clone() });
            ctx.status(SessionState::Failed, Some(&e.message));
        }
    }
    reason
}

async fn run_inner(
    ctx: &Arc<SessionCtx>,
    target: &SshTarget,
    cols: u16,
    rows: u16,
    mut commands: mpsc::Receiver<SessionCommand>,
    history_id: Option<i64>,
) -> AppResult<String> {
    ctx.status(
        SessionState::Connecting,
        Some(&format!("Connecting to {}:{}", target.host, target.port)),
    );
    let timeout = Duration::from_secs(target.options.connect_timeout_secs.into());

    // 1. TCP connect.
    let started = Instant::now();
    let stream = tokio::select! {
        r = tokio::time::timeout(timeout, TcpStream::connect((target.host.as_str(), target.port))) => match r {
            Err(_) => return Err(AppError::new(ErrorKind::Timeout, "The connection timed out")),
            Ok(Err(e)) => return Err(map_connect_io(&e, &target.host, target.port)),
            Ok(Ok(s)) => s,
        },
        _ = ctx.cancel.cancelled() => return Err(AppError::cancelled()),
    };
    let connect_ms = started.elapsed().as_millis() as u64;
    let _ = stream.set_nodelay(true);

    // 2. SSH handshake + host key verification.
    let config = Arc::new(client::Config {
        keepalive_interval: (target.options.keepalive_interval_secs > 0)
            .then(|| Duration::from_secs(target.options.keepalive_interval_secs.into())),
        keepalive_max: target.options.keepalive_max as usize,
        inactivity_timeout: None,
        nodelay: true,
        ..Default::default()
    });
    let host_info = Arc::new(Mutex::new(HostKeyInfo::default()));
    let handler = ClientHandler {
        ctx: ctx.clone(),
        host: target.host.clone(),
        port: target.port,
        info: host_info.clone(),
    };
    let mut handle = with_pausable_timeout(
        ctx,
        timeout,
        client::connect_stream(config, stream, handler),
    )
    .await?
    .map_err(map_handler_error)?;

    // 3. Authentication.
    ctx.status(SessionState::Authenticating, Some("Authenticating"));
    let auth = with_cancel(ctx, authenticate(ctx, &mut handle, target, timeout)).await;
    if let Err(e) = auth {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        return Err(e);
    }

    // 4. Interactive shell.
    let channel = with_timeout(ctx, timeout, handle.channel_open_session()).await?;
    channel
        .request_pty(
            false,
            &target.term_type,
            cols.into(),
            rows.into(),
            0,
            0,
            &[],
        )
        .await
        .map_err(map_russh_error)?;
    for var in &target.env {
        // Servers commonly refuse env requests (AcceptEnv); this is not fatal.
        let _ = channel
            .set_env(false, var.name.as_str(), var.value.as_str())
            .await;
    }
    channel.request_shell(true).await.map_err(map_russh_error)?;

    let info = host_info.lock().unwrap_or_else(|p| p.into_inner()).clone();
    if let Some(id) = &target.profile_id {
        let _ = profiles::mark_connected(&ctx.db, id);
    }
    if let Some(id) = history_id {
        let _ = history::session_status(&ctx.db, id, "connected", None);
    }
    ctx.sink.event(SessionEvent::Connected {
        info: ConnectionInfo {
            host: target.host.clone(),
            port: target.port,
            username: target.username.clone(),
            host_key_fingerprint: info.fingerprint,
            host_key_algorithm: info.algorithm,
            connect_ms: Some(connect_ms),
            shell: None,
        },
    });
    ctx.status(SessionState::Connected, None);

    let (mut reader, writer) = channel.split();
    let writer = Arc::new(writer);

    // Input is written from its own task so a full remote window can never
    // stall the reading side.
    let input_writer = writer.clone();
    let input_cancel = ctx.cancel.clone();
    let input_task = tauri::async_runtime::spawn(async move {
        loop {
            let cmd = tokio::select! {
                c = commands.recv() => c,
                _ = input_cancel.cancelled() => None,
            };
            let Some(cmd) = cmd else { break };
            let result = match cmd {
                SessionCommand::Write(data) => input_writer.data_bytes(data).await,
                SessionCommand::Resize { cols, rows } => {
                    input_writer
                        .window_change(cols.into(), rows.into(), 0, 0)
                        .await
                }
            };
            if result.is_err() {
                break;
            }
        }
    });

    let shell_confirmed = AtomicBool::new(false);
    let mut exit_code: Option<u32> = None;
    let mut exit_signal: Option<String> = None;
    let mut metrics_interval = tokio::time::interval(Duration::from_secs(5));
    metrics_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut previous_metrics: Option<(LinuxSnapshot, Instant)> = None;
    let mut metrics_failures = 0_u8;
    let mut metrics_monitoring = true;
    let reason: String;
    loop {
        let msg = tokio::select! {
            m = reader.wait() => m,
            _ = metrics_interval.tick(), if metrics_monitoring => {
                let sampled_at = Instant::now();
                match collect_linux_snapshot(&handle).await {
                    Some(snapshot) => {
                        metrics_failures = 0;
                        let elapsed = previous_metrics
                            .map(|(_, at)| sampled_at.saturating_duration_since(at))
                            .unwrap_or_default();
                        let previous = previous_metrics.map(|(previous, _)| previous);
                        let metrics = calculate_metrics(previous, snapshot, elapsed);
                        previous_metrics = Some((snapshot, sampled_at));
                        ctx.sink.event(SessionEvent::Metrics { metrics });
                    }
                    None => {
                        metrics_failures += 1;
                        if metrics_failures >= 3 {
                            metrics_monitoring = false;
                            ctx.sink.event(SessionEvent::MetricsUnavailable);
                        }
                    }
                }
                continue;
            }
            _ = ctx.cancel.cancelled() => {
                reason = "Disconnected".into();
                break;
            }
        };
        match msg {
            Some(ChannelMsg::Data { data }) => ctx.sink.data(&data),
            Some(ChannelMsg::ExtendedData { data, .. }) => ctx.sink.data(&data),
            Some(ChannelMsg::Success) => shell_confirmed.store(true, Ordering::SeqCst),
            Some(ChannelMsg::Failure) if !shell_confirmed.load(Ordering::SeqCst) => {
                input_task.abort();
                let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                return Err(AppError::new(
                    ErrorKind::Unsupported,
                    "The server refused to start an interactive shell",
                ));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
            Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                exit_signal = Some(format!("{signal_name:?}"))
            }
            Some(ChannelMsg::Eof) => {}
            Some(ChannelMsg::Close) | None => {
                reason = match (exit_code, &exit_signal) {
                    (Some(code), _) => format!("Shell exited with status {code}"),
                    (None, Some(sig)) => format!("Shell terminated by signal {sig}"),
                    _ if handle.is_closed() => {
                        "The connection was closed by the remote host".into()
                    }
                    _ => "Connection closed".into(),
                };
                break;
            }
            Some(_) => {}
        }
    }
    if exit_code.is_some() || exit_signal.is_some() {
        ctx.sink.event(SessionEvent::Exit {
            code: exit_code,
            signal: exit_signal,
        });
    }
    input_task.abort();
    let _ = writer.close().await;
    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
    Ok(reason)
}

async fn collect_linux_snapshot(handle: &Handle<ClientHandler>) -> Option<LinuxSnapshot> {
    let open = tokio::time::timeout(Duration::from_secs(3), handle.channel_open_session())
        .await
        .ok()?
        .ok()?;
    let mut channel = open;
    channel
        .exec(true, LINUX_METRICS_COMMAND.as_bytes())
        .await
        .ok()?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let mut output = Vec::with_capacity(2048);
    let mut exit_status = None;
    loop {
        let message = tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                let _ = channel.close().await;
                return None;
            }
            message = channel.wait() => message?,
        };
        match message {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                if output.len().saturating_add(data.len()) > MAX_METRICS_OUTPUT {
                    let _ = channel.close().await;
                    return None;
                }
                output.extend_from_slice(&data);
            }
            ChannelMsg::ExitStatus { exit_status: code } => exit_status = Some(code),
            ChannelMsg::Failure => {
                let _ = channel.close().await;
                return None;
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    if exit_status.is_some_and(|code| code != 0) {
        return None;
    }
    parse_linux_snapshot(&output)
}

async fn with_cancel<T>(
    ctx: &SessionCtx,
    fut: impl std::future::Future<Output = AppResult<T>>,
) -> AppResult<T> {
    tokio::select! {
        r = fut => r,
        _ = ctx.cancel.cancelled() => Err(AppError::cancelled()),
    }
}

async fn with_timeout<T>(
    ctx: &SessionCtx,
    timeout: Duration,
    fut: impl std::future::Future<Output = Result<T, russh::Error>>,
) -> AppResult<T> {
    tokio::select! {
        r = tokio::time::timeout(timeout, fut) => match r {
            Ok(r) => r.map_err(map_russh_error),
            Err(_) => Err(AppError::new(ErrorKind::Timeout, "The server did not respond in time")),
        },
        _ = ctx.cancel.cancelled() => Err(AppError::cancelled()),
    }
}

fn auth_failed(methods: &MethodSet) -> AppError {
    let offered: Vec<&str> = methods
        .iter()
        .map(|m| match m {
            MethodKind::None => "none",
            MethodKind::Password => "password",
            MethodKind::PublicKey => "publickey",
            MethodKind::HostBased => "hostbased",
            MethodKind::KeyboardInteractive => "keyboard-interactive",
            _ => "other",
        })
        .collect();
    let suffix = if offered.is_empty() {
        String::new()
    } else {
        format!(" (server accepts: {})", offered.join(", "))
    };
    AppError::new(
        ErrorKind::Authentication,
        format!("Authentication failed{suffix}"),
    )
}

fn is_key_based_auth(method: AuthMethod) -> bool {
    matches!(method, AuthMethod::PublicKey | AuthMethod::Agent)
}

/// Authenticates with the profile's method and follows up on partial success
/// (multi-factor setups such as publickey + keyboard-interactive).
async fn authenticate(
    ctx: &SessionCtx,
    handle: &mut Handle<ClientHandler>,
    target: &SshTarget,
    timeout: Duration,
) -> AppResult<()> {
    let key_based = is_key_based_auth(target.auth_method);
    let mut result = match target.auth_method {
        AuthMethod::Password => auth_password(ctx, handle, target, timeout).await?,
        AuthMethod::KeyboardInteractive => {
            auth_keyboard_interactive(ctx, handle, target, None, timeout).await?
        }
        AuthMethod::PublicKey => auth_public_key(ctx, handle, target, timeout).await?,
        AuthMethod::Agent => auth_agent(handle, target, timeout).await?,
    };
    for _ in 0..3 {
        match result {
            AuthResult::Success => return Ok(()),
            AuthResult::Failure {
                partial_success: true,
                remaining_methods,
            } => {
                if key_based {
                    return Err(AppError::new(
                        ErrorKind::Authentication,
                        "The server requires an additional authentication method. Password fallback is disabled for key-based connections.",
                    ));
                }
                result = if remaining_methods.contains(&MethodKind::KeyboardInteractive) {
                    auth_keyboard_interactive(ctx, handle, target, None, timeout).await?
                } else if remaining_methods.contains(&MethodKind::Password) {
                    auth_password(ctx, handle, target, timeout).await?
                } else {
                    return Err(auth_failed(&remaining_methods));
                };
            }
            AuthResult::Failure {
                remaining_methods, ..
            } => return Err(auth_failed(&remaining_methods)),
        }
    }
    Err(AppError::new(
        ErrorKind::Authentication,
        "Authentication failed",
    ))
}

fn saved_secret(ctx: &SessionCtx, key: Option<SecretKey>) -> Option<Secret> {
    let key = key?;
    match ctx.secrets.get(&key) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("could not read saved credential: {e}");
            None
        }
    }
}

fn store_secret(ctx: &SessionCtx, profile_id: Option<&str>, kind: SecretFlag, secret: &str) {
    let Some(id) = profile_id else { return };
    let key = match kind {
        SecretFlag::Password => SecretKey::password(id),
        SecretFlag::Passphrase => SecretKey::passphrase(id),
    };
    match ctx.secrets.set(&key, secret) {
        Ok(()) => {
            let _ = profiles::set_secret_flag(&ctx.db, id, kind, true);
        }
        Err(e) => {
            log::warn!("could not save credential: {e}");
            ctx.sink.event(SessionEvent::Banner {
                text: format!("TermLink could not save the credential: {}", e.message),
            });
        }
    }
}

fn forget_secret(ctx: &SessionCtx, profile_id: Option<&str>, kind: SecretFlag) {
    let Some(id) = profile_id else { return };
    let key = match kind {
        SecretFlag::Password => SecretKey::password(id),
        SecretFlag::Passphrase => SecretKey::passphrase(id),
    };
    let _ = ctx.secrets.delete(&key);
    let _ = profiles::set_secret_flag(&ctx.db, id, kind, false);
}

async fn auth_password(
    ctx: &SessionCtx,
    handle: &mut Handle<ClientHandler>,
    target: &SshTarget,
    timeout: Duration,
) -> AppResult<AuthResult> {
    let profile_id = target.profile_id.as_deref();
    let mut saved = saved_secret(ctx, profile_id.map(SecretKey::password));
    let mut error: Option<String> = None;
    let mut last_methods = MethodSet::empty();
    for _ in 0..MAX_PASSWORD_ATTEMPTS {
        let (password, from_saved, save) = match saved.take() {
            Some(s) => (s, true, false),
            None => {
                let answer = ctx
                    .ask_credentials(
                        AuthPromptKind::Password,
                        format!("Password for {}@{}", target.username, target.host),
                        String::new(),
                        vec![PromptField {
                            label: "Password".into(),
                            echo: false,
                        }],
                        profile_id.is_some(),
                        error.take(),
                    )
                    .await?;
                let save = answer.save;
                let mut values = answer.values;
                (values.remove(0), false, save)
            }
        };
        let result = with_timeout(
            ctx,
            timeout,
            handle.authenticate_password(target.username.as_str(), password.as_str()),
        )
        .await?;
        match result {
            AuthResult::Success
            | AuthResult::Failure {
                partial_success: true,
                ..
            } => {
                if save {
                    store_secret(ctx, profile_id, SecretFlag::Password, &password);
                }
                return Ok(result);
            }
            AuthResult::Failure {
                remaining_methods, ..
            } => {
                if from_saved {
                    forget_secret(ctx, profile_id, SecretFlag::Password);
                    error = Some("The saved password was rejected and has been removed".into());
                } else {
                    error = Some("Incorrect password, please try again".into());
                }
                // Many servers (PAM) only offer keyboard-interactive; answer its
                // password prompt with the password the user already provided.
                if !remaining_methods.contains(&MethodKind::Password)
                    && remaining_methods.contains(&MethodKind::KeyboardInteractive)
                {
                    let r = auth_keyboard_interactive(ctx, handle, target, Some(password), timeout)
                        .await?;
                    return Ok(r);
                }
                last_methods = remaining_methods;
            }
        }
    }
    Ok(AuthResult::Failure {
        remaining_methods: last_methods,
        partial_success: false,
    })
}

async fn auth_keyboard_interactive(
    ctx: &SessionCtx,
    handle: &mut Handle<ClientHandler>,
    target: &SshTarget,
    known_password: Option<Secret>,
    timeout: Duration,
) -> AppResult<AuthResult> {
    let mut response = with_timeout(
        ctx,
        timeout,
        handle.authenticate_keyboard_interactive_start(target.username.as_str(), None),
    )
    .await?;
    let mut known_password = known_password;
    for _ in 0..16 {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(AuthResult::Success),
            KeyboardInteractiveAuthResponse::Failure {
                remaining_methods,
                partial_success,
            } => {
                return Ok(AuthResult::Failure {
                    remaining_methods,
                    partial_success,
                })
            }
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                let answers: Vec<String> = if prompts.is_empty() {
                    Vec::new()
                } else if prompts.len() == 1 && !prompts[0].echo && known_password.is_some() {
                    let pw = known_password.take().unwrap_or_default();
                    vec![pw.as_str().to_string()]
                } else {
                    let title = if name.trim().is_empty() {
                        format!("Verification for {}@{}", target.username, target.host)
                    } else {
                        super::sanitize_display(&name, 200)
                    };
                    let fields = prompts
                        .iter()
                        .map(|p| PromptField {
                            label: super::sanitize_display(p.prompt.trim(), 200),
                            echo: p.echo,
                        })
                        .collect();
                    let answer = ctx
                        .ask_credentials(
                            AuthPromptKind::KeyboardInteractive,
                            title,
                            super::sanitize_display(&instructions, 2000),
                            fields,
                            false,
                            None,
                        )
                        .await?;
                    answer
                        .values
                        .iter()
                        .map(|v| v.as_str().to_string())
                        .collect()
                };
                // Answers are moved into russh, which owns them from here on.
                response = with_timeout(
                    ctx,
                    timeout,
                    handle.authenticate_keyboard_interactive_respond(answers),
                )
                .await?;
            }
        }
    }
    Err(AppError::new(
        ErrorKind::Authentication,
        "The server requested too many verification rounds",
    ))
}

/// Expands a leading `~` to the user's home directory.
pub fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    } else if path == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

async fn read_key_file(path: &str) -> AppResult<Secret> {
    let path = expand_home(path);
    let content = tokio::task::spawn_blocking(move || -> AppResult<Secret> {
        let meta = std::fs::metadata(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                AppError::validation("The private key file does not exist")
            }
            std::io::ErrorKind::PermissionDenied => {
                AppError::validation("Permission denied reading the private key file")
            }
            _ => AppError::validation("The private key file could not be read"),
        })?;
        if !meta.is_file() || meta.len() > MAX_KEY_FILE_BYTES {
            return Err(AppError::validation(
                "The selected file is not a private key",
            ));
        }
        let text = std::fs::read_to_string(&path)
            .map_err(|_| AppError::validation("The private key file could not be read"))?;
        Ok(zeroize::Zeroizing::new(text))
    })
    .await
    .map_err(|_| AppError::internal("Key loading was interrupted"))??;
    Ok(content)
}

async fn auth_public_key(
    ctx: &SessionCtx,
    handle: &mut Handle<ClientHandler>,
    target: &SshTarget,
    timeout: Duration,
) -> AppResult<AuthResult> {
    let path = target
        .key_path
        .as_deref()
        .ok_or_else(|| AppError::validation("No private key file is configured"))?;
    let content = read_key_file(path).await?;
    let profile_id = target.profile_id.as_deref();

    let key = match decode_secret_key(&content, None) {
        Ok(k) => k,
        Err(russh::keys::Error::KeyIsEncrypted) => {
            let mut saved = saved_secret(ctx, profile_id.map(SecretKey::passphrase));
            let mut error = None;
            let mut decoded = None;
            for _ in 0..MAX_PASSWORD_ATTEMPTS {
                let (passphrase, from_saved, save) = match saved.take() {
                    Some(s) => (s, true, false),
                    None => {
                        let answer = ctx
                            .ask_credentials(
                                AuthPromptKind::Passphrase,
                                "Private key passphrase".into(),
                                format!("Enter the passphrase for {path}"),
                                vec![PromptField {
                                    label: "Passphrase".into(),
                                    echo: false,
                                }],
                                profile_id.is_some(),
                                error.take(),
                            )
                            .await?;
                        let save = answer.save;
                        let mut values = answer.values;
                        (values.remove(0), false, save)
                    }
                };
                match decode_secret_key(&content, Some(passphrase.as_str())) {
                    Ok(k) => {
                        if save {
                            store_secret(ctx, profile_id, SecretFlag::Passphrase, &passphrase);
                        }
                        decoded = Some(k);
                        break;
                    }
                    Err(_) => {
                        if from_saved {
                            forget_secret(ctx, profile_id, SecretFlag::Passphrase);
                            error = Some(
                                "The saved passphrase is no longer valid and has been removed"
                                    .into(),
                            );
                        } else {
                            error = Some("Incorrect passphrase, please try again".into());
                        }
                    }
                }
            }
            decoded.ok_or_else(|| {
                AppError::new(
                    ErrorKind::Authentication,
                    "The private key could not be decrypted",
                )
            })?
        }
        Err(e) => {
            log::warn!("private key decode failed: {e}");
            return Err(AppError::validation(
                "The private key file is not in a supported format (OpenSSH, PEM or PuTTY PPK)",
            ));
        }
    };
    drop(content);

    let hash = if key.algorithm().is_rsa() {
        with_timeout(ctx, timeout, handle.best_supported_rsa_hash())
            .await?
            .flatten()
    } else {
        None
    };
    with_timeout(
        ctx,
        timeout,
        handle.authenticate_publickey(
            target.username.as_str(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        ),
    )
    .await
}

type DynAgent = russh::keys::agent::client::AgentClient<
    Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin>,
>;

async fn connect_agent() -> AppResult<DynAgent> {
    use russh::keys::agent::client::AgentClient;
    let unavailable = || {
        AppError::new(
            ErrorKind::Authentication,
            "No SSH agent is running. Start the OpenSSH Authentication Agent service or Pageant.",
        )
    };
    #[cfg(windows)]
    {
        if let Ok(agent) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            return Ok(agent.dynamic());
        }
        if let Ok(agent) = AgentClient::connect_pageant().await {
            return Ok(agent.dynamic());
        }
        Err(unavailable())
    }
    #[cfg(unix)]
    {
        AgentClient::connect_env()
            .await
            .map(|a| a.dynamic())
            .map_err(|_| unavailable())
    }
}

async fn auth_agent(
    handle: &mut Handle<ClientHandler>,
    target: &SshTarget,
    timeout: Duration,
) -> AppResult<AuthResult> {
    let mut agent = connect_agent().await?;
    let identities = agent.request_identities().await.map_err(|_| {
        AppError::new(
            ErrorKind::Authentication,
            "The SSH agent could not list keys",
        )
    })?;
    let mut last = AuthResult::Failure {
        remaining_methods: MethodSet::empty(),
        partial_success: false,
    };
    let mut tried = 0;
    for identity in identities {
        let russh::keys::agent::AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        tried += 1;
        let hash = if key.algorithm().is_rsa() {
            tokio::time::timeout(timeout, handle.best_supported_rsa_hash())
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
                .flatten()
        } else {
            None
        };
        let r = tokio::time::timeout(
            timeout,
            handle.authenticate_publickey_with(target.username.as_str(), key, hash, &mut agent),
        )
        .await
        .map_err(|_| AppError::new(ErrorKind::Timeout, "The server did not respond in time"))?
        .map_err(|e| {
            log::warn!("agent signing failed: {e}");
            AppError::new(
                ErrorKind::Authentication,
                "The SSH agent could not sign the request",
            )
        })?;
        match r {
            AuthResult::Success
            | AuthResult::Failure {
                partial_success: true,
                ..
            } => return Ok(r),
            other => last = other,
        }
    }
    if tried == 0 {
        return Err(AppError::new(
            ErrorKind::Authentication,
            "The SSH agent has no keys loaded",
        ));
    }
    Ok(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_home_handles_tilde() {
        let home = home_dir().unwrap();
        assert_eq!(
            expand_home("~/.ssh/id_ed25519"),
            home.join(".ssh/id_ed25519")
        );
        assert_eq!(expand_home("/abs/key"), PathBuf::from("/abs/key"));
    }

    #[test]
    fn auth_failure_lists_methods() {
        let set = MethodSet::from(&[MethodKind::PublicKey, MethodKind::Password][..]);
        let e = auth_failed(&set);
        assert_eq!(e.kind, ErrorKind::Authentication);
        assert!(e.message.contains("publickey, password"));
    }

    #[test]
    fn key_auth_never_falls_back_to_account_password() {
        assert!(is_key_based_auth(AuthMethod::PublicKey));
        assert!(is_key_based_auth(AuthMethod::Agent));
        assert!(!is_key_based_auth(AuthMethod::Password));
        assert!(!is_key_based_auth(AuthMethod::KeyboardInteractive));
    }
}
