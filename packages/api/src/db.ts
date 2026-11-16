import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { seedProjects, seedUsers } from './seed';

export type Db = DatabaseSync;

// bump when the schema changes. there are no migrations yet: this is development data, so a
// database from an older version is rebuilt from the seed (see opendb).
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
  -- almost every query starts from "which projects is this user in", so index that lookup.
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
// reset keeps users and sessions, so resetting the demo data doesn't sign everyone out.
const PROJECT_TABLES = ['measurements', 'measurement_groups', 'project_members', 'projects'];

function newEpoch(db: Db) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('epoch', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(randomUUID());
}

/**
 * a random label for the current run of measurement ids. it changes whenever ids start again
 * from 1 (after a reset). a dashboard remembers the id of the last measurement it saw; when the
 * label has changed, that id is from the old run and the dashboard must start fresh.
 */
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
  // fix: `CREATE TABLE IF NOT EXISTS` never changes a table that already exists, so a database
  // from before sign-in was added would keep its old columns and the api would crash on it.
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
  // fix: a failure half-way used to leave the transaction open and the data half deleted. now
  // it is rolled back, so a reset either fully happens or doesn't happen at all.
  db.exec('BEGIN');
  try {
    for (const table of PROJECT_TABLES) {
      db.exec(`DELETE FROM ${table}`);
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
    }
    seedProjects(db);
    // ids start again from 1, so any "last id i saw" that a dashboard is holding is now wrong.
    newEpoch(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
