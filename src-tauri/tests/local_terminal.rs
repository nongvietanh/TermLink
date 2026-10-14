//! Local terminal integration test: spawns a real shell in a pseudo-terminal
//! (ConPTY on Windows), sends input, reads output and checks cleanup.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use tokio::sync::mpsc;

use termlink_lib::credentials::{MemoryStore, SecretStore};
use termlink_lib::db::Db;
use termlink_lib::session::{shells, SessionEvent, SessionManager, SessionSink, SessionSpec};

struct Sink {
    data: Arc<Mutex<Vec<u8>>>,
    events: mpsc::UnboundedSender<SessionEvent>,
}

impl SessionSink for Sink {
    fn data(&self, bytes: &[u8]) {
        self.data.lock().unwrap().extend_from_slice(bytes);
    }
    fn event(&self, event: SessionEvent) {
        let _ = self.events.send(event);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn local_shell_roundtrip() {
    let shell_id = if cfg!(windows) { "cmd" } else { "sh" };
    let shell = shells::resolve(Some(shell_id)).expect("shell available");
    let db = Arc::new(Db::open_in_memory().unwrap());
    let manager = SessionManager::new(db, Arc::new(MemoryStore::default()) as Arc<dyn SecretStore>);
    let data = Arc::new(Mutex::new(Vec::new()));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let summary = manager
        .open(
            SessionSpec::Local(shell),
            100,
            30,
            Arc::new(Sink {
                data: data.clone(),
                events: tx,
            }),
        )
        .unwrap();

    // Wait until connected.
    loop {
        match tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .unwrap()
            .unwrap()
        {
            SessionEvent::Connected { .. } => break,
            SessionEvent::Closed { reason } => panic!("closed early: {reason}"),
            _ => {}
        }
    }
    // ConPTY asks for the cursor position (DSR, ESC[6n) before starting the
    // shell and waits for the terminal's answer; xterm.js replies in the app.
    if cfg!(windows) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !String::from_utf8_lossy(&data.lock().unwrap()).contains("\u{1b}[6n") {
            assert!(
                tokio::time::Instant::now() < deadline,
                "no DSR request from ConPTY"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        manager
            .write(&summary.id, Bytes::from_static(b"\x1b[1;1R"))
            .await
            .unwrap();
    }
    manager.resize(&summary.id, 120, 40).await.unwrap();
    manager
        .write(
            &summary.id,
            Bytes::from_static(b"echo TERMLINK_MARKER_42\r"),
        )
        .await
        .unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let out = String::from_utf8_lossy(&data.lock().unwrap()).into_owned();
        // The marker appears twice: echoed input and command output.
        if out.matches("TERMLINK_MARKER_42").count() >= 2 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no output, got {out:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    manager
        .write(&summary.id, Bytes::from_static(b"exit\r"))
        .await
        .unwrap();
    let mut exited = false;
    loop {
        match tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .unwrap()
            .unwrap()
        {
            SessionEvent::Exit { code, .. } => {
                assert_eq!(code, Some(0));
                exited = true;
            }
            SessionEvent::Closed { .. } => break,
            _ => {}
        }
    }
    assert!(exited);
    assert!(manager.list().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn closing_local_session_kills_shell() {
    let shell = shells::resolve(None).expect("shell available");
    let db = Arc::new(Db::open_in_memory().unwrap());
    let manager = SessionManager::new(db, Arc::new(MemoryStore::default()) as Arc<dyn SecretStore>);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let summary = manager
        .open(
            SessionSpec::Local(shell),
            80,
            24,
            Arc::new(Sink {
                data: Arc::new(Mutex::new(Vec::new())),
                events: tx,
            }),
        )
        .unwrap();
    loop {
        if let SessionEvent::Connected { .. } =
            tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .unwrap()
                .unwrap()
        {
            break;
        }
    }
    manager.close(&summary.id);
    loop {
        if let SessionEvent::Closed { .. } =
            tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .unwrap()
                .unwrap()
        {
            break;
        }
    }
    assert!(manager.list().is_empty());
}
