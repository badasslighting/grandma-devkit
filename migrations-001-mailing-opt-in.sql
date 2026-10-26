-- Run once in the D1 console on an existing database.
ALTER TABLE users ADD COLUMN mailing_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mailing_opt_in_at INTEGER;
