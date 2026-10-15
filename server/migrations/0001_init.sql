-- Gallivanter D1 schema v1. D1 is the single source of truth.
-- Google Sheets is a one-way, read-only copy written by the sync job.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  picture     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- Session cookie holds a random token; only its SHA-256 hash is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Google tokens, refresh token encrypted with AES-GCM (TOKEN_KEY secret).
CREATE TABLE google_tokens (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc  TEXT NOT NULL,
  access_token       TEXT NOT NULL DEFAULT '',
  access_expires_at  INTEGER NOT NULL DEFAULT 0,
  scope              TEXT NOT NULL DEFAULT '',
  updated_at         TEXT NOT NULL
);

-- A workspace is one CRM. Personal = 1 member; team = many members.
CREATE TABLE workspaces (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  owner_id         TEXT NOT NULL REFERENCES users(id),
  personal         INTEGER NOT NULL DEFAULT 0,
  sheet_id         TEXT NOT NULL DEFAULT '',
  settings         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE members (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_members_user ON members(user_id);

CREATE TABLE invites (
  token_hash    TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  created_by    TEXT NOT NULL REFERENCES users(id),
  expires_at    TEXT NOT NULL,
  accepted_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_invites_ws ON invites(workspace_id);

-- One table for all 17 modules. `data` is a JSON object of field values
-- (keys come from src/crm/schema.ts). `search` is lowercase text for LIKE search.
CREATE TABLE records (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module        TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  data          TEXT NOT NULL DEFAULT '{}',
  tags          TEXT NOT NULL DEFAULT '[]',
  search        TEXT NOT NULL DEFAULT '',
  converted_to  TEXT,
  owner_id      TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_records_ws_module ON records(workspace_id, module, deleted_at, updated_at);
CREATE INDEX idx_records_ws_updated ON records(workspace_id, updated_at);

CREATE TABLE record_links (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_id       TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX idx_links_to ON record_links(to_id);

CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id     TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  author_id     TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_notes_record ON notes(record_id, created_at);

-- Timeline doubles as the audit log: every mutation writes one row.
CREATE TABLE timeline (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id     TEXT,
  action        TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  actor_id      TEXT,
  source        TEXT NOT NULL CHECK (source IN ('ui','mcp','ai','system','import')),
  at            TEXT NOT NULL
);
CREATE INDEX idx_timeline_record ON timeline(record_id, at);
CREATE INDEX idx_timeline_ws ON timeline(workspace_id, at);

CREATE TABLE line_items (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id     TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  product_id    TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  quantity      REAL NOT NULL DEFAULT 1,
  price         REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax           REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_line_items_record ON line_items(record_id, position);

CREATE TABLE views (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module        TEXT NOT NULL,
  name          TEXT NOT NULL,
  rules         TEXT NOT NULL DEFAULT '[]',
  match         TEXT NOT NULL DEFAULT 'all' CHECK (match IN ('all','any')),
  columns       TEXT NOT NULL DEFAULT '[]',
  sort          TEXT NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE reports (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  module        TEXT NOT NULL,
  group_by      TEXT NOT NULL DEFAULT '',
  metric        TEXT NOT NULL DEFAULT 'count',
  metric_field  TEXT NOT NULL DEFAULT '',
  rules         TEXT NOT NULL DEFAULT '[]',
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE dashboards (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  report_ids    TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);

-- Tracks the one-way copy to Google Sheets per workspace.
CREATE TABLE sheet_sync (
  workspace_id    TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_synced_at  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  error           TEXT NOT NULL DEFAULT ''
);
