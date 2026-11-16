import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { seedProjects, seedUsers } from './seed';

export type Db = DatabaseSync;

// raise this when the schema changes; old db files get rebuilt from seed
const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS project_members_user ON project_members(user_id);
  CREATE TABLE IF NOT EXISTS measurement_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS measurement_groups_project ON measurement_groups(project_id);
  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES measurement_groups(id) ON DELETE CASCADE,
    value INTEGER NOT NULL,
    label TEXT NOT NULL,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS measurements_created_at ON measurements(created_at);
  CREATE INDEX IF NOT EXISTS measurements_group ON measurements(group_id);
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const ALL_TABLES = [
  'measurements',
  'measurement_groups',
  'project_members',
  'projects',
  'sessions',
  'users',
  'meta',
];
// reset only clears projects; users stay signed in
const PROJECT_TABLES = ['measurements', 'measurement_groups', 'project_members', 'projects'];

function newEpoch(db: Db) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('epoch', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(randomUUID());
}

// random label for this set of measurement ids; changes after a reset
export function getEpoch(db: Db): string {
  return (db.prepare(`SELECT value FROM meta WHERE key = 'epoch'`).get() as { value: string })
    .value;
}

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  const hasTables = !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get();
  // old db files do not get new columns from CREATE IF NOT EXISTS, so rebuild them
  if (hasTables && version !== SCHEMA_VERSION) {
    console.warn(`Database schema is out of date (v${version}); rebuilding it from the seed data.`);
    for (const table of ALL_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count === 0) {
    db.exec('BEGIN');
    try {
      seedUsers(db);
      seedProjects(db);
      newEpoch(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function resetDb(db: Db) {
  db.exec('BEGIN');
  try {
    for (const table of PROJECT_TABLES) {
      db.exec(`DELETE FROM ${table}`);
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
    }
    seedProjects(db);
    // ids start from 1 again after reset
    newEpoch(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
