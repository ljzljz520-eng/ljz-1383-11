'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL CHECK (stage IN ('education', 'internship', 'work')),
  title TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'paused', 'retired')),
  moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('draft', 'pending_review', 'approved', 'rejected')),
  start_value TEXT,
  start_precision TEXT CHECK (start_precision IS NULL OR start_precision IN ('year', 'month', 'day')),
  start_year INTEGER,
  start_month INTEGER,
  start_day INTEGER,
  end_value TEXT,
  end_precision TEXT CHECK (end_precision IS NULL OR end_precision IN ('year', 'month', 'day')),
  end_year INTEGER,
  end_month INTEGER,
  end_day INTEGER,
  ongoing INTEGER NOT NULL DEFAULT 1,
  sort_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  merged_into_id TEXT REFERENCES experiences(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiences_stage ON experiences(stage);
CREATE INDEX IF NOT EXISTS idx_experiences_moderation ON experiences(moderation_status);
CREATE INDEX IF NOT EXISTS idx_experiences_sort ON experiences(ongoing DESC, end_year DESC, end_month DESC, end_day DESC, start_year DESC, start_month DESC, start_day DESC, sort_index, id);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experience_skills (
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, skill_id)
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  personal_contribution INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contributions_experience ON contributions(experience_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status, personal_contribution);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  cover_icon TEXT NOT NULL DEFAULT '✦',
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'paused', 'retired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_profiles (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  experience_id TEXT UNIQUE REFERENCES experiences(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT '',
  artifact_summary TEXT NOT NULL DEFAULT '',
  link_label TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_experiences (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  relation_note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, experience_id)
);
CREATE INDEX IF NOT EXISTS idx_work_experiences_experience ON work_experiences(experience_id);

CREATE TABLE IF NOT EXISTS experience_aliases (
  slug TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_experience_aliases_target ON experience_aliases(experience_id);

CREATE TABLE IF NOT EXISTS experience_merges (
  id TEXT PRIMARY KEY,
  source_experience_id TEXT NOT NULL,
  target_experience_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  migrated_contributions INTEGER NOT NULL DEFAULT 0,
  migrated_skills INTEGER NOT NULL DEFAULT 0,
  migrated_work_links INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_experience_merges_target ON experience_merges(target_experience_id);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'current', 'archived')),
  content_hash TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  published_by TEXT NOT NULL DEFAULT 'owner',
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_current ON releases((1)) WHERE status = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_running ON releases((1)) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS release_experiences (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  lifecycle_status TEXT NOT NULL,
  start_value TEXT,
  start_precision TEXT,
  start_year INTEGER,
  start_month INTEGER,
  start_day INTEGER,
  end_value TEXT,
  end_precision TEXT,
  end_year INTEGER,
  end_month INTEGER,
  end_day INTEGER,
  ongoing INTEGER NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  UNIQUE(release_id, draft_id),
  UNIQUE(release_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_release_experiences_release ON release_experiences(release_id);
CREATE INDEX IF NOT EXISTS idx_release_experiences_stage ON release_experiences(release_id, stage);

CREATE TABLE IF NOT EXISTS release_experience_aliases (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  experience_id TEXT NOT NULL REFERENCES release_experiences(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_id, slug)
);

CREATE TABLE IF NOT EXISTS release_skills (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(release_id, draft_id),
  UNIQUE(release_id, slug)
);

CREATE TABLE IF NOT EXISTS release_experience_skills (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES release_experiences(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES release_skills(id) ON DELETE CASCADE,
  PRIMARY KEY (release_id, experience_id, skill_id)
);

CREATE TABLE IF NOT EXISTS release_contributions (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES release_experiences(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  personal_contribution INTEGER NOT NULL CHECK (personal_contribution = 1),
  status TEXT NOT NULL CHECK (status = 'approved')
);
CREATE INDEX IF NOT EXISTS idx_release_contributions_experience ON release_contributions(release_id, experience_id);

CREATE TABLE IF NOT EXISTS release_works (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  cover_icon TEXT NOT NULL DEFAULT '✦',
  lifecycle_status TEXT NOT NULL,
  UNIQUE(release_id, draft_id),
  UNIQUE(release_id, slug)
);

CREATE TABLE IF NOT EXISTS release_work_profiles (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES release_works(id) ON DELETE CASCADE,
  experience_id TEXT REFERENCES release_experiences(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT '',
  artifact_summary TEXT NOT NULL DEFAULT '',
  link_label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_id, work_id)
);

CREATE TABLE IF NOT EXISTS release_work_experiences (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES release_works(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES release_experiences(id) ON DELETE CASCADE,
  relation_note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, work_id, experience_id)
);
CREATE INDEX IF NOT EXISTS idx_release_work_experiences_experience ON release_work_experiences(release_id, experience_id);
`;

function openDatabase(filename = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'archive.db')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function initDatabase(filename = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'archive.db')) {
  const db = openDatabase(filename);
  db.exec(SCHEMA);
  return db;
}

module.exports = { initDatabase, openDatabase, SCHEMA };
