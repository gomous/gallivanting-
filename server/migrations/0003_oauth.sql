-- MCP OAuth authorization server state (RFC 7591 DCR, RFC 6749 auth code + PKCE,
-- refresh token rotation). Stateless JWT access tokens are signed with TOKEN_KEY;
-- these tables hold the server-side state the JWT cannot carry.

-- Dynamically registered OAuth clients (Claude or any MCP client that POSTs /oauth/register).
CREATE TABLE oauth_clients (
  client_id        TEXT PRIMARY KEY,
  client_secret    TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  redirect_uris    TEXT NOT NULL DEFAULT '[]',
  grant_types      TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  response_types   TEXT NOT NULL DEFAULT '["code"]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at       TEXT NOT NULL
);

-- Short-lived authorization codes, single use, bound to a PKCE challenge.
CREATE TABLE oauth_codes (
  code_hash        TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  role             TEXT NOT NULL,
  code_challenge   TEXT NOT NULL DEFAULT '',
  code_challenge_method TEXT NOT NULL DEFAULT 'plain',
  redirect_uri     TEXT NOT NULL DEFAULT '',
  scope            TEXT NOT NULL DEFAULT '',
  expires_at       TEXT NOT NULL,
  used_at          TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_oauth_codes_client ON oauth_codes(client_id);

-- Refresh tokens are opaque and rotated on every exchange.
CREATE TABLE oauth_refresh_tokens (
  token_hash       TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  role             TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT '',
  expires_at       TEXT NOT NULL,
  rotated_to       TEXT,
  revoked_at       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_oauth_refresh_user ON oauth_refresh_tokens(user_id);