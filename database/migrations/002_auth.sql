-- Authentication for fictional prototype accounts.
-- Run ONCE after database/migrations/001_core.sql.
-- Password hashes and session token hashes are never plaintext passwords/tokens.
BEGIN;
CREATE TABLE auth_credentials (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_profile_idx ON auth_sessions (profile_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);
COMMIT;
