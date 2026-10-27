CREATE TABLE IF NOT EXISTS verified_sessions (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verified_sessions_expires ON verified_sessions(expires);
CREATE TABLE IF NOT EXISTS newsletter_signups (
  email TEXT PRIMARY KEY,
  consent_at INTEGER NOT NULL
);
