//! Local SSH server for manual testing and the app smoke test.
//!
//! DEVELOPMENT ONLY. It listens on 127.0.0.1, accepts a single fixed test
//! account and provides a simulated line-based shell (it never executes
//! commands). Run with:
//!
//!   cargo run --example dev_ssh_server -- [port]
//!
//! Credentials: user `tester`, password `termlink-dev` (override with the
//! TERMLINK_DEV_PASSWORD environment variable). A fresh host key is generated
//! on every start, so TermLink will (correctly) ask you to verify it.

use std::sync::Arc;

use bytes::Bytes;
use russh::keys::{Algorithm, HashAlg, PrivateKey};
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use tokio::net::TcpListener;

#[derive(Clone)]
struct DevShell {
    password: String,
    line: Vec<u8>,
    cols: u32,
    rows: u32,
}

const PROMPT: &str = "\x1b[32mtester@termlink-dev\x1b[0m:\x1b[34m~\x1b[0m$ ";

impl DevShell {
    fn respond(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
        line: &str,
    ) -> Result<bool, russh::Error> {
        let out = match line.trim() {
            "" => String::new(),
            "exit" | "logout" => {
                session.data(channel, Bytes::from_static(b"logout\r\n"))?;
                session.exit_status_request(channel, 0)?;
                session.eof(channel)?;
                session.close(channel)?;
                return Ok(false);
            }
            "help" => "Simulated shell. Try: whoami, size, colors, unicode, seq, exit\r\n".into(),
            "whoami" => "tester\r\n".into(),
            "size" => format!("{}x{}\r\n", self.cols, self.rows),
            "colors" => (0..8)
                .map(|i| format!("\x1b[3{i}m██ color {i}\x1b[0m\r\n"))
                .collect(),
            "unicode" => "UTF-8 ✓ — 你好 — λ → ∞ — 🙂\r\n".into(),
            "seq" => (1..=200).map(|i| format!("line {i}\r\n")).collect(),
            other => format!("termlink-dev: {other}: simulated shell does not run commands\r\n"),
        };
        session.data(channel, Bytes::from(format!("{out}{PROMPT}")))?;
        Ok(true)
    }
}

impl server::Handler for DevShell {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "tester" && password == self.password {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::Reject {
                proceed_with_methods: Some(MethodSet::from(&[MethodKind::Password][..])),
                partial_success: false,
            })
        }
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

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        _channel: ChannelId,
        _term: &str,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        _modes: &[(russh::Pty, u32)],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        let banner = format!(
            "\x1b[1;36mTermLink dev SSH server\x1b[0m (simulated shell, nothing is executed)\r\nType \x1b[1mhelp\x1b[0m for commands.\r\n{PROMPT}"
        );
        session.data(channel, Bytes::from(banner))?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        for &b in data {
            match b {
                b'\r' | b'\n' => {
                    session.data(channel, Bytes::from_static(b"\r\n"))?;
                    let line = String::from_utf8_lossy(&self.line).into_owned();
                    self.line.clear();
                    if !self.respond(channel, session, &line)? {
                        return Ok(());
                    }
                }
                0x7f | 0x08 => {
                    if self.line.pop().is_some() {
                        session.data(channel, Bytes::from_static(b"\x08 \x08"))?;
                    }
                }
                0x03 => {
                    self.line.clear();
                    session.data(channel, Bytes::from(format!("^C\r\n{PROMPT}")))?;
                }
                b if b >= 0x20 => {
                    self.line.push(b);
                    session.data(channel, Bytes::copy_from_slice(&[b]))?;
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|p| p.parse().ok())
        .unwrap_or(2222);
    let password = std::env::var("TERMLINK_DEV_PASSWORD").unwrap_or_else(|_| "termlink-dev".into());
    let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
    let fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256);
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        methods: MethodSet::from(&[MethodKind::Password][..]),
        auth_rejection_time: std::time::Duration::from_millis(300),
        ..Default::default()
    });
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    println!("TermLink dev SSH server listening on 127.0.0.1:{port}");
    println!("host key fingerprint: {fingerprint}");
    println!("login: tester / (password from TERMLINK_DEV_PASSWORD or the default)");
    loop {
        let (socket, peer) = listener.accept().await?;
        let config = config.clone();
        let handler = DevShell {
            password: password.clone(),
            line: Vec::new(),
            cols: 80,
            rows: 24,
        };
        tokio::spawn(async move {
            println!("connection from {peer}");
            if let Ok(session) = server::run_stream(config, socket, handler).await {
                let _ = session.await;
            }
        });
    }
}
