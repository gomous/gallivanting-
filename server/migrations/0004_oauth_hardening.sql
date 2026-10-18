-- OAuth hardening: RFC 7592 client management + refresh-token families.

-- Hash of the registration_access_token handed out at registration (RFC 7592).
ALTER TABLE oauth_clients ADD COLUMN registration_token_hash TEXT NOT NULL DEFAULT '';

-- Every refresh token descends from one authorization code. The family is revoked
-- as a unit when a code or refresh token is replayed.
ALTER TABLE oauth_refresh_tokens ADD COLUMN family_id TEXT NOT NULL DEFAULT '';
UPDATE oauth_refresh_tokens SET family_id = token_hash WHERE family_id = '';
CREATE INDEX idx_oauth_refresh_family ON oauth_refresh_tokens(family_id);
