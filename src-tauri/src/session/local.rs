//! Local terminal sessions backed by a pseudo-terminal (ConPTY on Windows).

use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::{mpsc, oneshot};

use super::shells::ShellInfo;
use super::{ConnectionInfo, SessionCommand, SessionCtx, SessionEvent, SessionState};
use crate::db::history::{self, NewSession};
use crate::error::{AppError, AppResult, ErrorKind};

fn pty_error(context: &str, err: impl std::fmt::Display) -> AppError {
    log::warn!("pty {context} failed: {err}");
    AppError::new(
        ErrorKind::Io,
        format!("Could not {context} the local terminal"),
    )
}

pub async fn run(
    ctx: Arc<SessionCtx>,
    shell: ShellInfo,
    cols: u16,
    rows: u16,
    commands: mpsc::Receiver<SessionCommand>,
) -> String {
    let history_id = history::session_started(
        &ctx.db,
        NewSession {
            profile_id: None,
            protocol: "local",
            label: &shell.name,
            host: "",
            port: None,
            username: "",
        },
    )
    .ok();
    let result = run_inner(&ctx, &shell, cols, rows, commands, history_id).await;
    let (status, reason) = match &result {
        Ok(r) => ("closed", r.clone()),
        Err(e) => ("failed", e.message.clone()),
    };
    if let Some(id) = history_id {
        let error = (status == "failed").then_some(reason.as_str());
        let _ = history::session_status(&ctx.db, id, status, error);
    }
    match result {
        Ok(_) => ctx.status(SessionState::Disconnected, None),
        Err(e) => {
            ctx.sink.event(SessionEvent::Error { error: e.clone() });
            ctx.status(SessionState::Failed, Some(&e.message));
        }
    }
    reason
}

async fn run_inner(
    ctx: &Arc<SessionCtx>,
    shell: &ShellInfo,
    cols: u16,
    rows: u16,
    mut commands: mpsc::Receiver<SessionCommand>,
    history_id: Option<i64>,
) -> AppResult<String> {
    ctx.status(
        SessionState::Connecting,
        Some(&format!("Starting {}", shell.name)),
    );
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| pty_error("open", e))?;

    let mut cmd = CommandBuilder::new(&shell.program);
    cmd.args(&shell.args);
    if let Some(home) = super::ssh::home_dir() {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "TermLink");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| pty_error("start", e))?;
    drop(pair.slave);
    let mut killer = child.clone_killer();
    let master = pair.master;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| pty_error("read from", e))?;
    let writer = master.take_writer().map_err(|e| pty_error("write to", e))?;

    if let Some(id) = history_id {
        let _ = history::session_status(&ctx.db, id, "connected", None);
    }
    ctx.sink.event(SessionEvent::Connected {
        info: ConnectionInfo {
            host: "localhost".into(),
            port: 0,
            username: std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" })
                .unwrap_or_default(),
            host_key_fingerprint: None,
            host_key_algorithm: None,
            connect_ms: None,
            shell: Some(shell.name.clone()),
        },
    });
    ctx.status(SessionState::Connected, None);

    // Blocking reader thread: PTY output -> UI.
    let sink = ctx.sink.clone();
    let (reader_done_tx, reader_done_rx) = oneshot::channel::<()>();
    std::thread::Builder::new()
        .name("termlink-pty-reader".into())
        .spawn(move || {
            let mut buf = vec![0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => sink.data(&buf[..n]),
                }
            }
            let _ = reader_done_tx.send(());
        })
        .map_err(|e| pty_error("start reader for", e))?;

    // Blocking waiter thread: child exit status.
    let (exit_tx, mut exit_rx) = oneshot::channel::<Option<u32>>();
    std::thread::Builder::new()
        .name("termlink-pty-wait".into())
        .spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            let _ = exit_tx.send(code);
        })
        .map_err(|e| pty_error("monitor", e))?;

    // Blocking writer thread: UI input -> PTY.
    let (input_tx, input_rx) = std::sync::mpsc::channel::<bytes::Bytes>();
    std::thread::Builder::new()
        .name("termlink-pty-writer".into())
        .spawn(move || {
            let mut writer = writer;
            while let Ok(data) = input_rx.recv() {
                if writer
                    .write_all(&data)
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        })
        .map_err(|e| pty_error("start writer for", e))?;

    let reason = loop {
        tokio::select! {
            code = &mut exit_rx => {
                let code = code.ok().flatten();
                ctx.sink.event(SessionEvent::Exit { code, signal: None });
                break match code {
                    Some(c) => format!("Shell exited with status {c}"),
                    None => "Shell exited".to_string(),
                };
            }
            cmd = commands.recv() => match cmd {
                Some(SessionCommand::Write(data)) => {
                    if input_tx.send(data).is_err() {
                        break "Shell input closed".to_string();
                    }
                }
                Some(SessionCommand::Resize { cols, rows }) => {
                    let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                }
                None => {
                    let _ = killer.kill();
                    break "Closed".to_string();
                }
            },
            _ = ctx.cancel.cancelled() => {
                let _ = killer.kill();
                break "Closed".to_string();
            }
        }
    };
    drop(input_tx);
    // Dropping the master closes the PTY so the reader sees EOF; give it a
    // moment to flush the remaining output.
    drop(master);
    let _ = tokio::time::timeout(Duration::from_millis(500), reader_done_rx).await;
    Ok(reason)
}
