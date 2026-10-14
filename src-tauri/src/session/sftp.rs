//! SFTP file transfers over an authenticated SSH session.
//!
//! The SFTP subsystem is opened as an extra channel on the *same* connection as
//! the interactive shell, so it reuses the host-key trust and credentials the
//! user already approved — no second login. One [`SftpSession`] is cached per
//! SSH session and shared across operations (russh-sftp multiplexes requests
//! internally). Transfers stream in bounded chunks so a large file never has to
//! fit in memory, and every transfer can be cancelled mid-flight.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use super::ssh::ClientHandler;
use crate::error::{AppError, AppResult, ErrorKind};

/// Streaming chunk size. Large enough for throughput, small enough that
/// cancellation is responsive and memory use stays flat.
const CHUNK_BYTES: usize = 64 * 1024;
/// Minimum interval between progress events, to avoid flooding the UI.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// Upper bound on entries removed in one recursive delete, as a safety net.
const MAX_RECURSIVE_ENTRIES: usize = 100_000;
const MAX_PATH_LEN: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Modification time in milliseconds since the Unix epoch, if known.
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<LocalEntry>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transferred: u64,
    pub total: Option<u64>,
    pub bytes_per_second: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

impl TransferDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            TransferDirection::Upload => "upload",
            TransferDirection::Download => "download",
        }
    }
}

// ---------------------------------------------------------------------------
// Validation

/// Rejects obviously unsafe remote paths before they reach the server. The
/// server still enforces its own permissions; this only screens out control
/// characters and absurd lengths.
pub fn validate_remote_path(path: &str) -> AppResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("A remote path is required"));
    }
    if trimmed.len() > MAX_PATH_LEN {
        return Err(AppError::validation("The remote path is too long"));
    }
    if trimmed
        .chars()
        .any(|c| c == '\0' || (c.is_control() && c != ' '))
    {
        return Err(AppError::validation(
            "The remote path contains invalid characters",
        ));
    }
    Ok(trimmed.to_string())
}

/// Validates a local path: it must be absolute (the file browser always works
/// with resolved paths) and free of NUL bytes.
pub fn validate_local_path(path: &str) -> AppResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("A local path is required"));
    }
    if trimmed.len() > MAX_PATH_LEN || trimmed.contains('\0') {
        return Err(AppError::validation("The local path is invalid"));
    }
    let p = PathBuf::from(trimmed);
    if !p.is_absolute() {
        return Err(AppError::validation("The local path must be absolute"));
    }
    Ok(p)
}

// ---------------------------------------------------------------------------
// Error mapping

fn map_sftp(err: russh_sftp::client::error::Error) -> AppError {
    use russh_sftp::client::error::Error as E;
    match err {
        E::Status(status) => {
            // A protocol status carries a server-provided message; surface a
            // short, user-facing form.
            let msg = status.error_message.trim();
            let message = if msg.is_empty() {
                format!("SFTP error ({:?})", status.status_code)
            } else {
                msg.to_string()
            };
            let kind = match status.status_code {
                russh_sftp::protocol::StatusCode::NoSuchFile => ErrorKind::NotFound,
                russh_sftp::protocol::StatusCode::PermissionDenied => ErrorKind::Io,
                _ => ErrorKind::Io,
            };
            AppError::new(kind, message)
        }
        other => {
            log::warn!("sftp error: {other}");
            AppError::new(ErrorKind::Network, "The SFTP operation failed")
        }
    }
}

fn map_russh(err: russh::Error) -> AppError {
    log::warn!("sftp transport error: {err}");
    AppError::new(ErrorKind::Network, "The SFTP channel could not be opened")
}

// ---------------------------------------------------------------------------
// Bridge

/// Shares one SSH session's authenticated connection with the SFTP subsystem.
/// Created when an SSH session starts; populated with the connection handle once
/// authentication succeeds and cleared when the session ends.
pub struct SftpBridge {
    pub profile_id: Option<String>,
    handle: Mutex<Option<Arc<Handle<ClientHandler>>>>,
    session: AsyncMutex<Option<Arc<SftpSession>>>,
}

impl SftpBridge {
    pub fn new(profile_id: Option<String>) -> Self {
        Self {
            profile_id,
            handle: Mutex::new(None),
            session: AsyncMutex::new(None),
        }
    }

    /// Records the authenticated connection handle once the session connects.
    pub(crate) fn set_handle(&self, handle: Arc<Handle<ClientHandler>>) {
        *self.handle.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);
    }

    /// Releases the cached SFTP session and connection handle when the SSH
    /// session ends, so later operations fail cleanly instead of hanging.
    pub async fn shutdown(&self) {
        self.handle.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(session) = self.session.lock().await.take() {
            let _ = session.close().await;
        }
    }

    fn handle(&self) -> AppResult<Arc<Handle<ClientHandler>>> {
        self.handle
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .ok_or_else(|| {
                AppError::new(
                    ErrorKind::SessionClosed,
                    "The SSH session is not connected, so files cannot be transferred",
                )
            })
    }

    /// Returns the cached SFTP session, opening the subsystem on first use.
    async fn session(&self) -> AppResult<Arc<SftpSession>> {
        let mut guard = self.session.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let handle = self.handle()?;
        let channel = handle.channel_open_session().await.map_err(map_russh)?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(map_russh)?;
        let session = SftpSession::new(channel.into_stream())
            .await
            .map_err(map_sftp)?;
        let session = Arc::new(session);
        *guard = Some(session.clone());
        Ok(session)
    }

    /// Resolves a path to its absolute form (also used to discover the SFTP home
    /// directory by canonicalizing ".").
    pub async fn realpath(&self, path: &str) -> AppResult<String> {
        let sftp = self.session().await?;
        sftp.canonicalize(path.to_string()).await.map_err(map_sftp)
    }

    pub async fn list(&self, path: &str) -> AppResult<SftpListing> {
        let sftp = self.session().await?;
        let dir = sftp.read_dir(path.to_string()).await.map_err(map_sftp)?;
        let mut entries = Vec::new();
        for item in dir {
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = item.metadata();
            entries.push(SftpEntry {
                name,
                path: item.path(),
                kind: entry_kind(&meta),
                size: meta.len(),
                modified: meta.mtime.map(|s| s as i64 * 1000),
                permissions: meta.permissions,
            });
        }
        sort_entries(&mut entries, |e| (e.kind, e.name.clone()));
        Ok(SftpListing {
            path: path.to_string(),
            entries,
        })
    }

    pub async fn make_dir(&self, path: &str) -> AppResult<()> {
        let sftp = self.session().await?;
        sftp.create_dir(path.to_string()).await.map_err(map_sftp)
    }

    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        let sftp = self.session().await?;
        sftp.rename(from.to_string(), to.to_string())
            .await
            .map_err(map_sftp)
    }

    /// Removes a file, or a directory. Directories are only removed when
    /// `recursive` is set; otherwise a non-empty directory is an error.
    pub async fn remove(&self, path: &str, recursive: bool) -> AppResult<()> {
        let sftp = self.session().await?;
        let meta = sftp
            .symlink_metadata(path.to_string())
            .await
            .map_err(map_sftp)?;
        if meta.is_dir() {
            if recursive {
                remove_recursive(&sftp, path).await
            } else {
                sftp.remove_dir(path.to_string()).await.map_err(map_sftp)
            }
        } else {
            sftp.remove_file(path.to_string()).await.map_err(map_sftp)
        }
    }

    /// Downloads a remote file to a local path, streaming in chunks. Returns the
    /// number of bytes written. A cancelled download removes the partial file.
    pub async fn download<F: Fn(TransferProgress)>(
        &self,
        remote: &str,
        local: &Path,
        cancel: &CancellationToken,
        progress: F,
    ) -> AppResult<u64> {
        let sftp = self.session().await?;
        let total = sftp
            .metadata(remote.to_string())
            .await
            .ok()
            .and_then(|m| m.size);
        let mut source = sftp.open(remote.to_string()).await.map_err(map_sftp)?;
        let mut dest = tokio::fs::File::create(local).await?;
        let result = copy_stream(&mut source, &mut dest, total, cancel, progress).await;
        if result.is_err() {
            drop(dest);
            let _ = tokio::fs::remove_file(local).await;
        } else {
            dest.flush().await?;
        }
        result
    }

    /// Uploads a local file to a remote path, streaming in chunks. Returns the
    /// number of bytes written. A cancelled upload removes the partial file.
    pub async fn upload<F: Fn(TransferProgress)>(
        &self,
        local: &Path,
        remote: &str,
        cancel: &CancellationToken,
        progress: F,
    ) -> AppResult<u64> {
        let meta = tokio::fs::metadata(local).await?;
        if !meta.is_file() {
            return Err(AppError::validation("Only files can be uploaded"));
        }
        let total = Some(meta.len());
        let sftp = self.session().await?;
        let mut source = tokio::fs::File::open(local).await?;
        let mut dest = sftp.create(remote.to_string()).await.map_err(map_sftp)?;
        let result = copy_stream(&mut source, &mut dest, total, cancel, progress).await;
        match &result {
            Ok(_) => {
                dest.flush().await?;
                dest.shutdown().await?;
            }
            Err(_) => {
                let _ = dest.shutdown().await;
                let _ = sftp.remove_file(remote.to_string()).await;
            }
        }
        result
    }
}

fn entry_kind(meta: &russh_sftp::protocol::FileAttributes) -> EntryKind {
    if meta.is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else if meta.is_regular() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

/// Copies from an async reader to an async writer in bounded chunks, reporting
/// throttled progress and honouring cancellation between chunks.
async fn copy_stream<R, W, F>(
    source: &mut R,
    dest: &mut W,
    total: Option<u64>,
    cancel: &CancellationToken,
    progress: F,
) -> AppResult<u64>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
    F: Fn(TransferProgress),
{
    let mut buf = vec![0u8; CHUNK_BYTES];
    let mut transferred = 0u64;
    let started = Instant::now();
    let mut last_emit = Instant::now()
        .checked_sub(PROGRESS_INTERVAL)
        .unwrap_or_else(Instant::now);
    progress(TransferProgress {
        transferred: 0,
        total,
        bytes_per_second: 0.0,
    });
    loop {
        let read = tokio::select! {
            _ = cancel.cancelled() => return Err(AppError::cancelled()),
            n = source.read(&mut buf) => n?,
        };
        if read == 0 {
            break;
        }
        tokio::select! {
            _ = cancel.cancelled() => return Err(AppError::cancelled()),
            w = dest.write_all(&buf[..read]) => w?,
        }
        transferred += read as u64;
        let now = Instant::now();
        if now.duration_since(last_emit) >= PROGRESS_INTERVAL {
            last_emit = now;
            let secs = started.elapsed().as_secs_f64();
            progress(TransferProgress {
                transferred,
                total,
                bytes_per_second: if secs > 0.0 {
                    transferred as f64 / secs
                } else {
                    0.0
                },
            });
        }
    }
    let secs = started.elapsed().as_secs_f64();
    progress(TransferProgress {
        transferred,
        total: total.or(Some(transferred)),
        bytes_per_second: if secs > 0.0 {
            transferred as f64 / secs
        } else {
            0.0
        },
    });
    Ok(transferred)
}

/// Deletes a directory tree: files first, then directories deepest-first.
async fn remove_recursive(sftp: &SftpSession, root: &str) -> AppResult<()> {
    let mut stack = vec![root.to_string()];
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    while let Some(dir) = stack.pop() {
        dirs.push(dir.clone());
        let listing = sftp.read_dir(dir).await.map_err(map_sftp)?;
        for item in listing {
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            if item.metadata().is_dir() {
                stack.push(item.path());
            } else {
                files.push(item.path());
            }
            if files.len() + dirs.len() + stack.len() > MAX_RECURSIVE_ENTRIES {
                return Err(AppError::validation(
                    "The directory has too many entries to delete at once",
                ));
            }
        }
    }
    for file in files {
        sftp.remove_file(file).await.map_err(map_sftp)?;
    }
    for dir in dirs.iter().rev() {
        sftp.remove_dir(dir.clone()).await.map_err(map_sftp)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Local filesystem browsing (the user's own machine)

pub fn local_home() -> AppResult<String> {
    super::ssh::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::internal("The home directory could not be determined"))
}

pub fn local_list(path: &Path) -> AppResult<LocalListing> {
    let mut entries = Vec::new();
    let read = std::fs::read_dir(path)?;
    for item in read {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        // symlink_metadata does not follow links, so a broken link still lists.
        let meta = match item
            .metadata()
            .or_else(|_| std::fs::symlink_metadata(item.path()))
        {
            Ok(m) => m,
            Err(_) => continue,
        };
        let kind = if meta.file_type().is_symlink() {
            EntryKind::Symlink
        } else if meta.is_dir() {
            EntryKind::Dir
        } else if meta.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        entries.push(LocalEntry {
            name,
            path: item.path().to_string_lossy().into_owned(),
            kind,
            size: if meta.is_file() { meta.len() } else { 0 },
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64),
        });
    }
    sort_entries(&mut entries, |e| (e.kind, e.name.clone()));
    Ok(LocalListing {
        path: path.to_string_lossy().into_owned(),
        parent: path.parent().map(|p| p.to_string_lossy().into_owned()),
        entries,
    })
}

/// Sorts directories before files, then by name (case-insensitive).
fn sort_entries<T, K: Fn(&T) -> (EntryKind, String)>(entries: &mut [T], key: K) {
    entries.sort_by(|a, b| {
        let (ka, na) = key(a);
        let (kb, nb) = key(b);
        let rank = |k: EntryKind| if k == EntryKind::Dir { 0 } else { 1 };
        rank(ka)
            .cmp(&rank(kb))
            .then_with(|| na.to_lowercase().cmp(&nb.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_remote_paths() {
        assert!(validate_remote_path("").is_err());
        assert!(validate_remote_path("/etc/\0passwd").is_err());
        assert!(validate_remote_path("/var/log/syslog").is_ok());
        assert_eq!(validate_remote_path("  /srv/app  ").unwrap(), "/srv/app");
    }

    #[test]
    fn requires_absolute_local_paths() {
        assert!(validate_local_path("relative/path").is_err());
        assert!(validate_local_path("").is_err());
        let abs = if cfg!(windows) {
            r"C:\Users\x\f.txt"
        } else {
            "/home/x/f.txt"
        };
        assert!(validate_local_path(abs).is_ok());
    }

    #[test]
    fn lists_a_local_directory_dirs_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("zeta")).unwrap();
        std::fs::write(dir.path().join("alpha.txt"), b"hello").unwrap();
        let listing = local_list(dir.path()).unwrap();
        assert_eq!(listing.entries.len(), 2);
        assert_eq!(listing.entries[0].kind, EntryKind::Dir);
        assert_eq!(listing.entries[0].name, "zeta");
        assert_eq!(listing.entries[1].name, "alpha.txt");
        assert_eq!(listing.entries[1].size, 5);
    }
}
