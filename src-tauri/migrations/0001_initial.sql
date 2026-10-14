-- TermLink schema v1.
-- Secret material (passwords, passphrases, private keys) is NEVER stored here.
-- Profiles only carry flags saying whether a secret exists in the OS credential store,
-- and private keys are referenced by file path.

CREATE TABLE groups (
    id          TEXT PRIMARY KEY NOT NULL,
    parent_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    expanded    INTEGER NOT NULL DEFAULT 1 CHECK (expanded IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_groups_parent ON groups(parent_id);

CREATE TABLE profiles (
    id                 TEXT PRIMARY KEY NOT NULL,
    group_id           TEXT REFERENCES groups(id) ON DELETE SET NULL,
    name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    protocol           TEXT NOT NULL DEFAULT 'ssh' CHECK (protocol IN ('ssh', 'local', 'rdp', 'vnc')),
    host               TEXT NOT NULL DEFAULT '',
    port               INTEGER NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
    username           TEXT NOT NULL DEFAULT '',
    auth_method        TEXT NOT NULL DEFAULT 'password'
                       CHECK (auth_method IN ('password', 'public_key', 'agent', 'keyboard_interactive')),
    key_path           TEXT,
    password_saved     INTEGER NOT NULL DEFAULT 0 CHECK (password_saved IN (0, 1)),
    passphrase_saved   INTEGER NOT NULL DEFAULT 0 CHECK (passphrase_saved IN (0, 1)),
    favorite           INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    notes              TEXT NOT NULL DEFAULT '',
    color              TEXT,
    terminal_json      TEXT NOT NULL DEFAULT '{}',
    ssh_json           TEXT NOT NULL DEFAULT '{}',
    sort_order         INTEGER NOT NULL DEFAULT 0,
    last_connected_at  INTEGER,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_profiles_group ON profiles(group_id);
CREATE INDEX idx_profiles_host ON profiles(host COLLATE NOCASE);
CREATE INDEX idx_profiles_name ON profiles(name COLLATE NOCASE);
CREATE INDEX idx_profiles_favorite ON profiles(favorite) WHERE favorite = 1;
CREATE INDEX idx_profiles_last_connected ON profiles(last_connected_at);

CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40)
);

CREATE TABLE profile_tags (
    profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX idx_profile_tags_tag ON profile_tags(tag_id);

-- Trusted SSH host keys. Public keys are not secret.
CREATE TABLE known_hosts (
    id            INTEGER PRIMARY KEY,
    host          TEXT NOT NULL COLLATE NOCASE,
    port          INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    algorithm     TEXT NOT NULL,
    public_key    TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    added_at      INTEGER NOT NULL,
    last_seen_at  INTEGER,
    UNIQUE (host, port, algorithm)
);
CREATE INDEX idx_known_hosts_endpoint ON known_hosts(host, port);

CREATE TABLE session_history (
    id          INTEGER PRIMARY KEY,
    profile_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    protocol    TEXT NOT NULL,
    label       TEXT NOT NULL,
    host        TEXT NOT NULL DEFAULT '',
    port        INTEGER,
    username    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL CHECK (status IN ('connecting', 'connected', 'failed', 'closed')),
    error       TEXT,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER
);
CREATE INDEX idx_session_history_started ON session_history(started_at DESC);
CREATE INDEX idx_session_history_profile ON session_history(profile_id);

CREATE TABLE snippets (
    id                    TEXT PRIMARY KEY NOT NULL,
    name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    command               TEXT NOT NULL CHECK (length(command) BETWEEN 1 AND 20000),
    description           TEXT NOT NULL DEFAULT '',
    category              TEXT NOT NULL DEFAULT '',
    confirm_before_run    INTEGER NOT NULL DEFAULT 0 CHECK (confirm_before_run IN (0, 1)),
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_snippets_category ON snippets(category);

CREATE TABLE snippet_tags (
    snippet_id  TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (snippet_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX idx_snippet_tags_tag ON snippet_tags(tag_id);

-- Commands that TermLink itself sent to a terminal (snippets, palette).
-- Keystrokes typed directly into a terminal are never recorded, because they may
-- contain passwords typed at interactive prompts.
CREATE TABLE command_history (
    id           INTEGER PRIMARY KEY,
    profile_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    target_label TEXT NOT NULL DEFAULT '',
    command      TEXT NOT NULL CHECK (length(command) BETWEEN 1 AND 20000),
    source       TEXT NOT NULL CHECK (source IN ('snippet', 'palette', 'history')),
    executed_at  INTEGER NOT NULL
);
CREATE INDEX idx_command_history_executed ON command_history(executed_at DESC);

CREATE TABLE transfer_history (
    id                 TEXT PRIMARY KEY NOT NULL,
    profile_id         TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    direction          TEXT NOT NULL CHECK (direction IN ('upload', 'download')),
    local_path         TEXT NOT NULL,
    remote_path        TEXT NOT NULL,
    size_bytes         INTEGER,
    transferred_bytes  INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    error              TEXT,
    started_at         INTEGER NOT NULL,
    finished_at        INTEGER
);
CREATE INDEX idx_transfer_history_started ON transfer_history(started_at DESC);

CREATE TABLE port_forwards (
    id           TEXT PRIMARY KEY NOT NULL,
    profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    kind         TEXT NOT NULL CHECK (kind IN ('local', 'remote', 'dynamic')),
    bind_address TEXT NOT NULL DEFAULT '127.0.0.1',
    bind_port    INTEGER NOT NULL CHECK (bind_port BETWEEN 1 AND 65535),
    target_host  TEXT,
    target_port  INTEGER CHECK (target_port IS NULL OR target_port BETWEEN 1 AND 65535),
    auto_start   INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    CHECK (kind = 'dynamic' OR (target_host IS NOT NULL AND target_port IS NOT NULL))
);
CREATE INDEX idx_port_forwards_profile ON port_forwards(profile_id);

-- Application settings stored as validated JSON documents keyed by section.
CREATE TABLE settings (
    key         TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);
