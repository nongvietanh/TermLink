//! Application error model.
//!
//! Every error that crosses the IPC boundary is converted into an [`AppError`],
//! which serializes to `{ "kind": "...", "message": "..." }`. Messages are
//! written for users and must never contain secret material (passwords,
//! passphrases, private keys). Low-level error details are logged instead of
//! being forwarded verbatim when they could contain sensitive context.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Validation,
    NotFound,
    Conflict,
    Database,
    CredentialStore,
    Io,
    Network,
    Timeout,
    Authentication,
    HostKeyRejected,
    SessionClosed,
    Cancelled,
    Unsupported,
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Validation, message)
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(ErrorKind::NotFound, format!("{what} was not found"))
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Conflict, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unsupported, message)
    }

    pub fn session_closed() -> Self {
        Self::new(ErrorKind::SessionClosed, "The session is no longer active")
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "The operation was cancelled")
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        match err {
            rusqlite::Error::QueryReturnedNoRows => AppError::not_found("The requested item"),
            rusqlite::Error::SqliteFailure(e, _)
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                log::warn!("database constraint violation: {err}");
                AppError::conflict("The change conflicts with existing data")
            }
            other => {
                log::error!("database error: {other}");
                AppError::new(ErrorKind::Database, "A local database error occurred")
            }
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind as K;
        let message = match err.kind() {
            K::NotFound => "File or directory not found",
            K::PermissionDenied => "Permission denied",
            K::AlreadyExists => "The file already exists",
            K::TimedOut => "The operation timed out",
            _ => "An input/output error occurred",
        };
        log::warn!("io error: {err}");
        AppError::new(ErrorKind::Io, message)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::validation(format!("Invalid data format: {err}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        log::error!("tauri error: {err}");
        AppError::internal("An internal application error occurred")
    }
}
