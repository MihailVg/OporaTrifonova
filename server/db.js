import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let queryFn = null;
let dbKind = null;
let closeFn = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectPostgres() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
    application_name: 'opora-clinic',
  });

  pool.on('error', (error) => {
    console.error('[db] Неожиданная ошибка пула PostgreSQL:', error.message);
  });

  queryFn = async (sql, params = []) => (await pool.query(sql, params)).rows;
  closeFn = async () => pool.end();
  dbKind = 'postgres';

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await queryFn('SELECT 1 AS ok');
      return;
    } catch (error) {
      lastError = error;
      console.warn(`[db] PostgreSQL недоступен, попытка ${attempt}/4: ${error.message}`);
      if (attempt < 4) await sleep(attempt * 1_500);
    }
  }
  throw lastError;
}

async function connectPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(path.dirname(config.pgliteDir), { recursive: true });
  const db = new PGlite(config.pgliteDir);
  await db.waitReady;

  queryFn = async (sql, params = []) => (await db.query(sql, params)).rows;
  closeFn = async () => db.close();
  dbKind = 'pglite';
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    diagnosis TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    pain_avg INTEGER NOT NULL,
    pain_max INTEGER NOT NULL,
    locations TEXT NOT NULL DEFAULT '[]',
    characters TEXT NOT NULL DEFAULT '[]',
    night_wake TEXT NOT NULL,
    numbness INTEGER NOT NULL,
    weakness INTEGER NOT NULL,
    mobility INTEGER NOT NULL,
    edema INTEGER NOT NULL,
    med_name TEXT NOT NULL,
    med_dose TEXT,
    med_times INTEGER,
    relief INTEGER,
    side_effects TEXT NOT NULL DEFAULT '[]',
    adherence TEXT NOT NULL,
    sleep_hours DOUBLE PRECISION NOT NULL,
    sleep_quality INTEGER NOT NULL,
    mood INTEGER NOT NULL,
    activity INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(patient_id, date)
  )`,
  'CREATE INDEX IF NOT EXISTS surveys_patient_date_idx ON surveys(patient_id, date DESC)',
  'CREATE INDEX IF NOT EXISTS surveys_date_idx ON surveys(date)',
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    patient_name TEXT NOT NULL,
    pain INTEGER NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    telegram_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS alerts_created_idx ON alerts(created_at DESC)',
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    message TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    telegram_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at DESC)',
];

export async function initDb() {
  if (queryFn) return dbKind;

  if (config.databaseUrl) {
    await connectPostgres();
  } else {
    await connectPglite();
  }

  for (const statement of SCHEMA) {
    await queryFn(statement);
  }

  console.log(`[db] Хранилище готово: ${dbKind}`);
  return dbKind;
}

export function getDbKind() {
  return dbKind;
}

export async function q(sql, params = []) {
  if (!queryFn) throw new Error('База данных ещё не инициализирована');
  return queryFn(sql, params);
}

export async function closeDb() {
  if (closeFn) {
    await closeFn();
    closeFn = null;
    queryFn = null;
    dbKind = null;
  }
}
