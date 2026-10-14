//! SSH integration tests against a real, in-process SSH server (russh) on
//! 127.0.0.1. These exercise the full protocol path used by the app: TCP
//! connect, key exchange, host-key verification and trust store, password /
//! keyboard-interactive / public-key authentication, PTY + shell, data
//! streaming in both directions, resize, exit status, cancellation, timeouts
//! and remote disconnects.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use russh::keys::ssh_key::LineEnding;
use russh::keys::{Algorithm, PrivateKey, PublicKey, PublicKeyBase64};
use russh::server::{self, Auth, Msg, Response, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use termlink_lib::credentials::{MemoryStore, SecretKey, SecretStore};
use termlink_lib::db::{self, Db};
use termlink_lib::domain::profile::{
    AuthMethod, ProfileInput, Protocol, SshOptions, TerminalPrefs,
};
use termlink_lib::error::ErrorKind;
use termlink_lib::session::ssh::SshTarget;
use termlink_lib::session::{
    HostKeyDecision, PromptResponse, SessionEvent, SessionManager, SessionSink, SessionSpec,
};

const PASSWORD: &str = "correct horse battery staple";
const USER: &str = "tester";

// ---------------------------------------------------------------------------
// Test SSH server

#[derive(Clone, Default)]
struct ServerConfig {
    password: Option<String>,
    kbi_password: Option<String>,
    authorized_key: Option<PublicKey>,
    /// Close the TCP connection right after the shell starts.
    drop_after_shell: bool,
}

#[derive(Clone)]
struct TestHandler {
    cfg: ServerConfig,
    log: Arc<Mutex<Vec<String>>>,
}

impl server::Handler for TestHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == USER && self.cfg.password.as_deref() == Some(password) {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::Reject {
                proceed_with_methods: Some(self.methods()),
                partial_success: false,
            })
        }
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        let Some(expected) = self.cfg.kbi_password.clone() else {
            return Ok(Auth::reject());
        };
        match response {
            None => Ok(Auth::Partial {
                name: "".into(),
                instructions: "".into(),
                prompts: vec![("Password: ".into(), false)].into(),
            }),
            Some(mut r) => {
                let answer = r.next().map(|b| String::from_utf8_lossy(&b).into_owned());
                if user == USER && answer.as_deref() == Some(expected.as_str()) {
                    Ok(Auth::Accept)
                } else {
                    Ok(Auth::reject())
                }
            }
        }
    }

    async fn auth_publickey_offered(
        &mut self,
        _user: &str,
        key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        Ok(self.key_auth(key))
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        if user != USER {
            return Ok(Auth::reject());
        }
        Ok(self.key_auth(key))
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        _channel: ChannelId,
        term: &str,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        _modes: &[(russh::Pty, u32)],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.log
            .lock()
            .unwrap()
            .push(format!("pty {term} {cols}x{rows}"));
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        if self.cfg.drop_after_shell {
            session.disconnect(russh::Disconnect::ByApplication, "bye", "en")?;
            return Ok(());
        }
        session.data(channel, Bytes::from_static(b"WELCOME \xe2\x9c\x93\r\n"))?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if data == b"exit\r" {
            session.exit_status_request(channel, 7)?;
            session.eof(channel)?;
            session.close(channel)?;
            return Ok(());
        }
        let mut echo = b"ECHO:".to_vec();
        echo.extend_from_slice(data);
        session.data(channel, Bytes::from(echo))?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, Bytes::from(format!("RESIZE {cols}x{rows}\r\n")))?;
        Ok(())
    }
}

impl TestHandler {
    fn methods(&self) -> MethodSet {
        let mut kinds = Vec::new();
        if self.cfg.password.is_some() {
            kinds.push(MethodKind::Password);
        }
        if self.cfg.kbi_password.is_some() {
            kinds.push(MethodKind::KeyboardInteractive);
        }
        if self.cfg.authorized_key.is_some() {
            kinds.push(MethodKind::PublicKey);
        }
        MethodSet::from(&kinds[..])
    }

    fn key_auth(&self, key: &PublicKey) -> Auth {
        match &self.cfg.authorized_key {
            Some(k) if k.key_data() == key.key_data() => Auth::Accept,
            _ => Auth::reject(),
        }
    }
}

struct TestServer {
    port: u16,
    host_key: PrivateKey,
    log: Arc<Mutex<Vec<String>>>,
}

async fn start_server(cfg: ServerConfig) -> TestServer {
    let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    start_server_with_key(cfg, host_key).await
}

async fn start_server_with_key(cfg: ServerConfig, host_key: PrivateKey) -> TestServer {
    let mut methods = Vec::new();
    if cfg.password.is_some() {
        methods.push(MethodKind::Password);
    }
    if cfg.kbi_password.is_some() {
        methods.push(MethodKind::KeyboardInteractive);
    }
    if cfg.authorized_key.is_some() {
        methods.push(MethodKind::PublicKey);
    }
    let config = Arc::new(server::Config {
        keys: vec![host_key.clone()],
        methods: MethodSet::from(&methods[..]),
        auth_rejection_time: Duration::from_millis(10),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        inactivity_timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let log = Arc::new(Mutex::new(Vec::new()));
    let handler = TestHandler {
        cfg,
        log: log.clone(),
    };
    tokio::spawn(async move {
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                break;
            };
            let config = config.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    TestServer {
        port,
        host_key,
        log,
    }
}

// ---------------------------------------------------------------------------
// Client harness

struct TestSink {
    data: Arc<Mutex<Vec<u8>>>,
    events: mpsc::UnboundedSender<SessionEvent>,
}

impl SessionSink for TestSink {
    fn data(&self, bytes: &[u8]) {
        self.data.lock().unwrap().extend_from_slice(bytes);
    }
    fn event(&self, event: SessionEvent) {
        let _ = self.events.send(event);
    }
}

struct Harness {
    db: Arc<Db>,
    secrets: Arc<MemoryStore>,
    manager: Arc<SessionManager>,
}

struct Running {
    id: String,
    data: Arc<Mutex<Vec<u8>>>,
    events: mpsc::UnboundedReceiver<SessionEvent>,
}

impl Harness {
    fn new() -> Self {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let secrets = Arc::new(MemoryStore::default());
        let manager = SessionManager::new(db.clone(), secrets.clone() as Arc<dyn SecretStore>);
        Self {
            db,
            secrets,
            manager,
        }
    }

    fn profile(&self, port: u16, auth: AuthMethod, key_path: Option<String>) -> String {
        db::profiles::create(
            &self.db,
            ProfileInput {
                group_id: None,
                name: "test server".into(),
                protocol: Protocol::Ssh,
                host: "127.0.0.1".into(),
                port: port.into(),
                username: USER.into(),
                auth_method: auth,
                key_path,
                favorite: false,
                notes: String::new(),
                color: None,
                tags: vec![],
                terminal: TerminalPrefs::default(),
                ssh: SshOptions::default(),
            },
        )
        .unwrap()
        .id
    }

    fn target(
        &self,
        profile_id: Option<String>,
        port: u16,
        auth: AuthMethod,
        key_path: Option<String>,
    ) -> SshTarget {
        SshTarget {
            profile_id,
            label: "test".into(),
            host: "127.0.0.1".into(),
            port,
            username: USER.into(),
            auth_method: auth,
            key_path,
            options: SshOptions {
                connect_timeout_secs: 5,
                ..SshOptions::default()
            },
            term_type: "xterm-256color".into(),
            env: vec![],
        }
    }

    fn open(&self, target: SshTarget) -> Running {
        let data = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::unbounded_channel();
        let sink = Arc::new(TestSink {
            data: data.clone(),
            events: tx,
        });
        let summary = self
            .manager
            .open(SessionSpec::Ssh(target), 100, 30, sink)
            .unwrap();
        Running {
            id: summary.id,
            data,
            events: rx,
        }
    }

    fn respond(&self, r: &Running, request_id: &str, response: PromptResponse) {
        self.manager.respond(&r.id, request_id, response).unwrap();
    }
}

fn creds(value: &str, save: bool) -> PromptResponse {
    PromptResponse::Credentials {
        values: vec![value.to_string()],
        save,
    }
}

impl Running {
    /// Waits for an event matching `pred`, failing on timeout or session close.
    async fn expect<T>(
        &mut self,
        what: &str,
        mut pred: impl FnMut(&SessionEvent) -> Option<T>,
    ) -> T {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let ev = tokio::time::timeout_at(deadline, self.events.recv())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .unwrap_or_else(|| panic!("event stream ended while waiting for {what}"));
            if let Some(v) = pred(&ev) {
                return v;
            }
            if let SessionEvent::Closed { reason } = &ev {
                panic!("session closed ({reason}) while waiting for {what}");
            }
        }
    }

    async fn host_key_prompt(&mut self) -> (String, String, bool) {
        self.expect("host key prompt", |e| match e {
            SessionEvent::HostKeyPrompt {
                request_id,
                fingerprint,
                status,
                ..
            } => Some((
                request_id.clone(),
                fingerprint.clone(),
                matches!(status, termlink_lib::session::HostKeyStatusKind::Changed),
            )),
            _ => None,
        })
        .await
    }

    async fn auth_prompt(&mut self) -> (String, Option<String>) {
        self.expect("auth prompt", |e| match e {
            SessionEvent::AuthPrompt {
                request_id, error, ..
            } => Some((request_id.clone(), error.clone())),
            _ => None,
        })
        .await
    }

    async fn connected(&mut self) {
        self.expect("connected", |e| {
            matches!(e, SessionEvent::Connected { .. }).then_some(())
        })
        .await
    }

    /// Waits for Closed, returning the error kind seen before it (if any).
    async fn closed(&mut self) -> (Option<ErrorKind>, String) {
        let mut error = None;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let ev = tokio::time::timeout_at(deadline, self.events.recv())
                .await
                .expect("timed out waiting for close")
                .expect("event stream ended without Closed");
            match ev {
                SessionEvent::Error { error: e } => error = Some(e.kind),
                SessionEvent::Closed { reason } => return (error, reason),
                SessionEvent::HostKeyPrompt { .. } | SessionEvent::AuthPrompt { .. } => {
                    panic!("unexpected prompt while waiting for close: {ev:?}")
                }
                _ => {}
            }
        }
    }

    async fn wait_output(&self, needle: &str) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let text = String::from_utf8_lossy(&self.data.lock().unwrap()).into_owned();
            if text.contains(needle) {
                return;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("output never contained {needle:?}; got {text:?}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests

#[tokio::test(flavor = "multi_thread")]
async fn password_session_full_lifecycle() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let profile = h.profile(server.port, AuthMethod::Password, None);

    // First connection: unknown host key must be confirmed by the user.
    let mut s = h.open(h.target(
        Some(profile.clone()),
        server.port,
        AuthMethod::Password,
        None,
    ));
    let (req, fingerprint, changed) = s.host_key_prompt().await;
    assert!(!changed);
    assert_eq!(
        fingerprint,
        server
            .host_key
            .public_key()
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string()
    );
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptAndSave,
        },
    );

    let (req, err) = s.auth_prompt().await;
    assert!(err.is_none());
    h.respond(&s, &req, creds(PASSWORD, true));
    s.connected().await;

    // UTF-8 output from the server arrives intact.
    s.wait_output("WELCOME ✓").await;
    assert!(server
        .log
        .lock()
        .unwrap()
        .iter()
        .any(|l| l == "pty xterm-256color 100x30"));

    // Input and resize travel to the server.
    h.manager
        .write(&s.id, Bytes::from_static(b"ls -la\r"))
        .await
        .unwrap();
    s.wait_output("ECHO:ls -la").await;
    h.manager.resize(&s.id, 132, 43).await.unwrap();
    s.wait_output("RESIZE 132x43").await;

    // Remote exit status is reported and the session cleans up.
    h.manager
        .write(&s.id, Bytes::from_static(b"exit\r"))
        .await
        .unwrap();
    let code = s
        .expect("exit", |e| match e {
            SessionEvent::Exit { code, .. } => Some(*code),
            _ => None,
        })
        .await;
    assert_eq!(code, Some(7));
    let (error, reason) = s.closed().await;
    assert!(error.is_none(), "unexpected error {error:?}");
    assert!(reason.contains("status 7"), "{reason}");
    assert!(
        h.manager.list().is_empty(),
        "session must be removed after close"
    );

    // Trust and credential side effects.
    assert_eq!(db::known_hosts::list(&h.db).unwrap().len(), 1);
    assert_eq!(
        h.secrets
            .get(&SecretKey::password(&profile))
            .unwrap()
            .as_deref()
            .map(String::as_str),
        Some(PASSWORD)
    );
    let p = db::profiles::get(&h.db, &profile).unwrap();
    assert!(p.password_saved);
    assert!(p.last_connected_at.is_some());
    let history = db::history::list_sessions(&h.db, 10).unwrap();
    assert_eq!(history[0].status, "closed");

    // Second connection: trusted host and saved password -> no prompts at all.
    let mut s2 = h.open(h.target(Some(profile), server.port, AuthMethod::Password, None));
    s2.expect("connected without prompts", |e| match e {
        SessionEvent::Connected { .. } => Some(()),
        SessionEvent::HostKeyPrompt { .. } | SessionEvent::AuthPrompt { .. } => {
            panic!("no prompt expected on reconnect, got {e:?}")
        }
        _ => None,
    })
    .await;
    h.manager.close(&s2.id);
    let (error, _) = s2.closed().await;
    assert!(error.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn rejected_host_key_aborts_before_authentication() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::Reject,
        },
    );
    let (error, _) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::HostKeyRejected));
    assert!(db::known_hosts::list(&h.db).unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn changed_host_key_is_flagged_and_cannot_be_accepted_once() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    // Pretend we previously trusted a different key for this endpoint.
    let old = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let old_pub = old.public_key();
    let old_fp = old_pub
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    db::known_hosts::trust(
        &h.db,
        &db::known_hosts::PresentedKey {
            host: "127.0.0.1",
            port: server.port,
            algorithm: "ssh-ed25519",
            public_key: &old_pub.public_key_base64(),
            fingerprint: &old_fp,
        },
        false,
    )
    .unwrap();

    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let previous = s
        .expect("changed host key prompt", |e| match e {
            SessionEvent::HostKeyPrompt {
                request_id,
                status: termlink_lib::session::HostKeyStatusKind::Changed,
                previous,
                ..
            } => Some((request_id.clone(), previous.clone())),
            _ => None,
        })
        .await;
    assert_eq!(previous.1[0].fingerprint, old_fp);
    // "Accept once" is not allowed for a changed key.
    h.respond(
        &s,
        &previous.0,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (error, _) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::HostKeyRejected));

    // Explicitly replacing the key works and removes the old one.
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, _, changed) = s.host_key_prompt().await;
    assert!(changed);
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptAndSave,
        },
    );
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds(PASSWORD, false));
    s.connected().await;
    let hosts = db::known_hosts::list(&h.db).unwrap();
    assert_eq!(hosts.len(), 1);
    assert_ne!(hosts[0].fingerprint, old_fp);
    h.manager.close(&s.id);
    s.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn wrong_password_reprompts_then_fails_after_limit() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );

    let (req, err) = s.auth_prompt().await;
    assert!(err.is_none());
    h.respond(&s, &req, creds("wrong-1", false));
    let (req, err) = s.auth_prompt().await;
    assert!(err.unwrap().contains("Incorrect password"));
    h.respond(&s, &req, creds("wrong-2", false));
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds("wrong-3", false));
    let (error, _) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Authentication));
    // Nothing was trusted permanently ("accept once").
    assert!(db::known_hosts::list(&h.db).unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn rejected_saved_password_is_removed_and_reprompted() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let profile = h.profile(server.port, AuthMethod::Password, None);
    h.secrets
        .set(&SecretKey::password(&profile), "stale")
        .unwrap();
    db::profiles::set_secret_flag(&h.db, &profile, db::profiles::SecretFlag::Password, true)
        .unwrap();

    let mut s = h.open(h.target(
        Some(profile.clone()),
        server.port,
        AuthMethod::Password,
        None,
    ));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptAndSave,
        },
    );
    let (req, err) = s.auth_prompt().await;
    assert!(err.unwrap().contains("saved password was rejected"));
    assert!(h
        .secrets
        .get(&SecretKey::password(&profile))
        .unwrap()
        .is_none());
    assert!(!db::profiles::get(&h.db, &profile).unwrap().password_saved);
    h.respond(&s, &req, creds(PASSWORD, false));
    s.connected().await;
    h.manager.close(&s.id);
    s.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn keyboard_interactive_only_server_accepts_password_flow() {
    let server = start_server(ServerConfig {
        kbi_password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    // One password prompt; TermLink answers the server's keyboard-interactive
    // password challenge with it.
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds(PASSWORD, false));
    s.connected().await;
    s.wait_output("WELCOME").await;
    h.manager.close(&s.id);
    s.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn encrypted_private_key_with_passphrase() {
    let client_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let server = start_server(ServerConfig {
        authorized_key: Some(client_key.public_key().clone()),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let key_path = dir.path().join("id_ed25519");
    let encrypted = client_key.encrypt(&mut rand::rng(), "key-pass").unwrap();
    std::fs::write(
        &key_path,
        encrypted.to_openssh(LineEnding::LF).unwrap().as_bytes(),
    )
    .unwrap();
    let key_path = key_path.to_string_lossy().into_owned();

    let h = Harness::new();
    let profile = h.profile(server.port, AuthMethod::PublicKey, Some(key_path.clone()));
    let mut s = h.open(h.target(
        Some(profile.clone()),
        server.port,
        AuthMethod::PublicKey,
        Some(key_path.clone()),
    ));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptAndSave,
        },
    );
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds("not-it", false));
    let (req, err) = s.auth_prompt().await;
    assert!(err.unwrap().contains("Incorrect passphrase"));
    h.respond(&s, &req, creds("key-pass", true));
    s.connected().await;
    h.manager.close(&s.id);
    s.closed().await;
    assert!(db::profiles::get(&h.db, &profile).unwrap().passphrase_saved);

    // Saved passphrase is reused.
    let mut s = h.open(h.target(
        Some(profile),
        server.port,
        AuthMethod::PublicKey,
        Some(key_path),
    ));
    s.expect("connected", |e| match e {
        SessionEvent::Connected { .. } => Some(()),
        SessionEvent::AuthPrompt { .. } => panic!("saved passphrase should be used"),
        _ => None,
    })
    .await;
    h.manager.close(&s.id);
    s.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn unauthorized_key_fails_authentication() {
    let authorized = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let other = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let server = start_server(ServerConfig {
        authorized_key: Some(authorized.public_key().clone()),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let key_path = dir.path().join("id_other");
    std::fs::write(
        &key_path,
        other.to_openssh(LineEnding::LF).unwrap().as_bytes(),
    )
    .unwrap();
    let h = Harness::new();
    let mut s = h.open(h.target(
        None,
        server.port,
        AuthMethod::PublicKey,
        Some(key_path.to_string_lossy().into_owned()),
    ));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (error, reason) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Authentication));
    assert!(reason.contains("publickey"), "{reason}");
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_key_file_is_a_clear_error() {
    let server = start_server(ServerConfig {
        authorized_key: Some(
            PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
                .unwrap()
                .public_key()
                .clone(),
        ),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(
        None,
        server.port,
        AuthMethod::PublicKey,
        Some("Z:\\nope\\missing_key".into()),
    ));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (error, reason) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Validation));
    assert!(reason.contains("does not exist"), "{reason}");
}

#[tokio::test(flavor = "multi_thread")]
async fn connection_refused_is_reported() {
    // Bind and drop to get a port with nothing listening.
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let h = Harness::new();
    let mut s = h.open(h.target(None, port, AuthMethod::Password, None));
    let (error, reason) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Network));
    assert!(
        reason.contains("refused") || reason.contains("connect"),
        "{reason}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_server_times_out() {
    // Accepts TCP but never speaks SSH.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((sock, _)) = listener.accept().await {
            held.push(sock);
        }
    });
    let h = Harness::new();
    let mut target = h.target(None, port, AuthMethod::Password, None);
    target.options.connect_timeout_secs = 1;
    let started = std::time::Instant::now();
    let mut s = h.open(target);
    let (error, _) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Timeout));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test(flavor = "multi_thread")]
async fn time_spent_on_host_key_prompt_does_not_count_toward_timeout() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut target = h.target(None, server.port, AuthMethod::Password, None);
    target.options.connect_timeout_secs = 1;
    let mut s = h.open(target);
    let (req, ..) = s.host_key_prompt().await;
    tokio::time::sleep(Duration::from_millis(1800)).await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds(PASSWORD, false));
    s.connected().await;
    h.manager.close(&s.id);
    s.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn closing_during_prompt_cancels_cleanly() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    h.manager.close(&s.id);
    let closed_prompt = s
        .expect("prompt closed", |e| match e {
            SessionEvent::PromptClosed { request_id } => Some(request_id.clone()),
            _ => None,
        })
        .await;
    assert_eq!(closed_prompt, req);
    let (error, _) = s.closed().await;
    assert!(
        error.is_none(),
        "user cancellation is not an error: {error:?}"
    );
    assert!(h.manager.list().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_disconnect_ends_session() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        drop_after_shell: true,
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (req, _) = s.auth_prompt().await;
    h.respond(&s, &req, creds(PASSWORD, false));
    let (_, reason) = s.closed().await;
    assert!(!reason.is_empty());
    assert!(h.manager.list().is_empty());
    // Writing to a closed session is a clean error.
    let err = h
        .manager
        .write(&s.id, Bytes::from_static(b"x"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionClosed);
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_answers_are_validated() {
    let server = start_server(ServerConfig {
        password: Some(PASSWORD.into()),
        ..Default::default()
    })
    .await;
    let h = Harness::new();
    let mut s = h.open(h.target(None, server.port, AuthMethod::Password, None));
    let (req, ..) = s.host_key_prompt().await;
    // Unknown request ids are rejected.
    assert!(h
        .manager
        .respond(
            &s.id,
            &uuid::Uuid::new_v4().to_string(),
            PromptResponse::Cancel
        )
        .is_err());
    h.respond(
        &s,
        &req,
        PromptResponse::HostKey {
            decision: HostKeyDecision::AcceptOnce,
        },
    );
    let (req, _) = s.auth_prompt().await;
    // Wrong number of answers aborts authentication rather than guessing.
    h.respond(
        &s,
        &req,
        PromptResponse::Credentials {
            values: vec!["a".into(), "b".into()],
            save: false,
        },
    );
    let (error, _) = s.closed().await;
    assert_eq!(error, Some(ErrorKind::Validation));
}
