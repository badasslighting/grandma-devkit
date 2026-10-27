CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  visits     INTEGER NOT NULL DEFAULT 1,
  blocked    INTEGER NOT NULL DEFAULT 0,
  mailing_opt_in    INTEGER NOT NULL DEFAULT 0,
  mailing_opt_in_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id      TEXT PRIMARY KEY,
  email   TEXT NOT NULL REFERENCES users(email),
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS verified_sessions (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verified_sessions_expires ON verified_sessions(expires);
CREATE TABLE IF NOT EXISTS newsletter_signups (
  email TEXT PRIMARY KEY,
  consent_at INTEGER NOT NULL
);
