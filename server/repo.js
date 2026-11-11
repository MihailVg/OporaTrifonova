import crypto from 'node:crypto';
import { q } from './db.js';
import {
  generatePatientCode,
  normalizeCode,
  randomToken,
  sha256,
} from './auth.js';
import { config, isTelegramConfigured } from './config.js';
import { site } from '../shared/site.js';
import { ageInDays, daysAgo, nowIso, shiftDate } from './time.js';
import {
  adherenceOptions,
  edemaScale,
  labelOf,
  labelsOf,
  medOptions,
  mobilityScale,
  nightWake,
  painCharacters,
  painLocations,
  sideEffectOptions,
  symptomScale,
} from '../shared/options.js';

const jsonArray = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  try {
    const parsed = JSON.parse(value ?? '[]');
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return '[]';
  }
};

const parseArray = (value) => {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const round1 = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

export function mapPatient(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone || null,
    diagnosis: row.diagnosis,
    createdAt: row.created_at,
    consentAt: row.consent_at,
  };
}

export function mapSurvey(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    date: row.date,
    painAvg: row.pain_avg,
    painMax: row.pain_max,
    locations: parseArray(row.locations),
    characters: parseArray(row.characters),
    nightWake: row.night_wake,
    numbness: row.numbness,
    weakness: row.weakness,
    mobility: row.mobility,
    edema: row.edema,
    medName: row.med_name,
    medDose: row.med_dose,
    medTimes: row.med_times,
    relief: row.relief,
    sideEffects: parseArray(row.side_effects),
    adherence: row.adherence,
    sleepHours: Number(row.sleep_hours),
    sleepQuality: row.sleep_quality,
    mood: row.mood,
    activity: row.activity,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    pain: row.pain,
    comment: row.comment,
    status: row.status,
    telegramStatus: row.telegram_status,
    createdAt: row.created_at,
  };
}

export function mapFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    message: row.message,
    telegramStatus: row.telegram_status,
    createdAt: row.created_at,
  };
}

async function insertRow(table, values, conflict = '') {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ${conflict} RETURNING *`;
  const rows = await q(sql, columns.map((column) => values[column]));
  return rows[0] ?? null;
}

export async function createPatient({ name, phone, consent = true }) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const consentAt = nowIso();
  const createdAt = consentAt;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generatePatientCode();
    const exists = await q('SELECT 1 FROM patients WHERE code = $1', [code]);
    if (exists.length > 0) continue;

    try {
      const row = await insertRow('patients', {
        id: crypto.randomUUID(),
        code,
        name,
        phone: phone || null,
        diagnosis: site.diagnosis,
        token_hash: tokenHash,
        consent_at: consentAt,
        created_at: createdAt,
      });
      return { patient: mapPatient(row), token };
    } catch (error) {
      if (error?.code === '23505' && attempt < 5) continue;
      throw error;
    }
  }

  throw new Error('Не удалось создать уникальный код пациента');
}

export async function findPatientByCode(code) {
  const rows = await q('SELECT * FROM patients WHERE code = $1 LIMIT 1', [normalizeCode(code)]);
  return rows[0] ?? null;
}

export async function findPatientByTokenHash(tokenHash) {
  const rows = await q('SELECT * FROM patients WHERE token_hash = $1 LIMIT 1', [tokenHash]);
  return rows[0] ?? null;
}

export async function getPatientById(id) {
  const rows = await q('SELECT * FROM patients WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function rotatePatientToken(patientId) {
  const token = randomToken(32);
  await q('UPDATE patients SET token_hash = $1 WHERE id = $2', [sha256(token), patientId]);
  return token;
}

export async function getSurveyForDate(patientId, date) {
  const rows = await q('SELECT * FROM surveys WHERE patient_id = $1 AND date = $2 LIMIT 1', [
    patientId,
    date,
  ]);
  return mapSurvey(rows[0]);
}

export async function listSurveys(patientId, limit = 30) {
  const rows = await q(
    'SELECT * FROM surveys WHERE patient_id = $1 ORDER BY date DESC LIMIT $2',
    [patientId, Math.min(Math.max(Number(limit) || 30, 1), 120)],
  );
  return rows.map(mapSurvey);
}

export async function upsertSurvey(patientId, date, data) {
  const timestamp = nowIso();
  const values = {
    id: crypto.randomUUID(),
    patient_id: patientId,
    date,
    pain_avg: data.painAvg,
    pain_max: data.painMax,
    locations: jsonArray(data.locations),
    characters: jsonArray(data.characters),
    night_wake: data.nightWake,
    numbness: data.numbness,
    weakness: data.weakness,
    mobility: data.mobility,
    edema: data.edema,
    med_name: data.medName,
    med_dose: data.medDose,
    med_times: data.medTimes,
    relief: data.relief,
    side_effects: jsonArray(data.sideEffects),
    adherence: data.adherence,
    sleep_hours: data.sleepHours,
    sleep_quality: data.sleepQuality,
    mood: data.mood,
    activity: data.activity,
    note: data.note,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updates = columns
    .filter((column) => !['id', 'patient_id', 'date', 'created_at'].includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');

  const rows = await q(
    `INSERT INTO surveys (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (patient_id, date)
     DO UPDATE SET ${updates}
     RETURNING *`,
    columns.map((column) => values[column]),
  );
  return mapSurvey(rows[0]);
}

export async function latestAlertForPatient(patientId) {
  const rows = await q(
    'SELECT * FROM alerts WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1',
    [patientId],
  );
  return mapAlert(rows[0]);
}

export async function createAlert({ patient, pain, comment, telegramStatus = 'pending', createdAt }) {
  const row = await insertRow('alerts', {
    id: crypto.randomUUID(),
    patient_id: patient.id,
    patient_name: patient.name,
    pain,
    comment: comment || null,
    status: 'new',
    telegram_status: telegramStatus,
    created_at: createdAt || nowIso(),
  });
  return mapAlert(row);
}

export async function setAlertTelegramStatus(id, status) {
  await q('UPDATE alerts SET telegram_status = $1 WHERE id = $2', [status, id]);
}

export async function listAlerts(limit = 30) {
  const rows = await q('SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1', [
    Math.min(Math.max(Number(limit) || 30, 1), 100),
  ]);
  return rows.map(mapAlert);
}

export async function listPatientAlerts(patientId, limit = 5) {
  const rows = await q(
    'SELECT * FROM alerts WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2',
    [patientId, Math.min(Math.max(Number(limit) || 5, 1), 30)],
  );
  return rows.map(mapAlert);
}

export async function markAlertHandled(id) {
  const rows = await q(
    "UPDATE alerts SET status = 'handled' WHERE id = $1 RETURNING *",
    [id],
  );
  return mapAlert(rows[0]);
}

export async function createFeedback({ name, contact, message, telegramStatus = 'pending' }) {
  const row = await insertRow('feedback', {
    id: crypto.randomUUID(),
    name,
    contact,
    message,
    consent_at: nowIso(),
    telegram_status: telegramStatus,
    created_at: nowIso(),
  });
  return mapFeedback(row);
}

export async function setFeedbackTelegramStatus(id, status) {
  await q('UPDATE feedback SET telegram_status = $1 WHERE id = $2', [status, id]);
}

export async function listFeedback(limit = 10) {
  const rows = await q('SELECT * FROM feedback ORDER BY created_at DESC LIMIT $1', [
    Math.min(Math.max(Number(limit) || 10, 1), 50),
  ]);
  return rows.map(mapFeedback);
}

export async function countPatients() {
  const rows = await q('SELECT COUNT(*)::int AS count FROM patients');
  return rows[0]?.count ?? 0;
}

export async function countSurveysForDate(date) {
  const rows = await q('SELECT COUNT(*)::int AS count FROM surveys WHERE date = $1', [date]);
  return rows[0]?.count ?? 0;
}

export async function countNewAlerts() {
  const rows = await q("SELECT COUNT(*)::int AS count FROM alerts WHERE status = 'new'");
  return rows[0]?.count ?? 0;
}

export async function listSurveysSince(date) {
  const rows = await q('SELECT * FROM surveys WHERE date >= $1 ORDER BY date ASC', [date]);
  return rows.map(mapSurvey);
}

export function buildPatientSummary(surveys, last, alerts = []) {
  const sorted = [...surveys].sort((a, b) => a.date.localeCompare(b.date));
  const lastSurvey = last ?? sorted.at(-1) ?? null;
  const comparison = sorted.length > 1 ? sorted[Math.max(0, sorted.length - 8)] : null;
  const trend = lastSurvey && comparison ? lastSurvey.painAvg - comparison.painAvg : null;
  const lastAlert = alerts[0] ?? null;
  const daysSince = lastSurvey ? ageInDays(lastSurvey.date) : null;

  return {
    last: lastSurvey,
    trend: trend === null ? null : round1(trend),
    lastAlert,
    daysSince,
    needsAttention:
      Boolean(lastSurvey && lastSurvey.painMax >= 7) ||
      Boolean(daysSince !== null && daysSince > 1) ||
      Boolean(lastAlert && lastAlert.status === 'new'),
  };
}

export async function getDoctorOverview() {
  const today = daysAgo(0);
  const since = daysAgo(13);
  const [patients, surveys, alerts, feedback, newAlerts] = await Promise.all([
    q('SELECT * FROM patients ORDER BY created_at DESC'),
    listSurveysSince(since),
    listAlerts(25),
    listFeedback(6),
    countNewAlerts(),
  ]);

  const surveysByPatient = new Map();
  for (const survey of surveys) {
    if (!surveysByPatient.has(survey.patientId)) surveysByPatient.set(survey.patientId, []);
    surveysByPatient.get(survey.patientId).push(survey);
  }

  const alertsByPatient = new Map();
  for (const alert of alerts) {
    if (!alertsByPatient.has(alert.patientId)) alertsByPatient.set(alert.patientId, []);
    alertsByPatient.get(alert.patientId).push(alert);
  }

  const patientsView = patients
    .map((row) => {
      const patient = mapPatient(row);
      const ownSurveys = surveysByPatient.get(patient.id) ?? [];
      const ownAlerts = alertsByPatient.get(patient.id) ?? [];
      const summary = buildPatientSummary(ownSurveys, null, ownAlerts);
      return {
        ...patient,
        last: summary.last,
        trend: summary.trend,
        lastAlert: summary.lastAlert,
        daysSince: summary.daysSince,
        needsAttention: summary.needsAttention,
      };
    })
    .sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return (b.last?.date ?? b.createdAt).localeCompare(a.last?.date ?? a.createdAt);
    });

  const days = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = daysAgo(offset);
    const own = surveys.filter((survey) => survey.date === date);
    const avg = own.length
      ? own.reduce((sum, survey) => sum + survey.painAvg, 0) / own.length
      : null;
    const maxAvg = own.length
      ? own.reduce((sum, survey) => sum + survey.painMax, 0) / own.length
      : null;
    days.push({ date, avg: round1(avg), max: round1(maxAvg), count: own.length });
  }

  const week = surveys.filter((survey) => survey.date >= daysAgo(6));
  const avgPain7 = week.length
    ? round1(week.reduce((sum, survey) => sum + survey.painAvg, 0) / week.length)
    : null;

  return {
    today,
    stats: {
      patients: patients.length,
      surveysToday: surveys.filter((survey) => survey.date === today).length,
      avgPain7,
      newAlerts,
      surveysWindow: surveys.length,
    },
    patients: patientsView,
    chart: days,
    alerts,
    feedback,
    telegramConfigured: isTelegramConfigured,
  };
}

export function summarizeSurveys(surveys) {
  if (!surveys.length) {
    return {
      total: 0,
      avgPain7: null,
      firstPain: null,
      lastPain: null,
      delta: null,
      streak: 0,
    };
  }
  const sorted = [...surveys].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  const first = sorted[0];
  const week = sorted.filter((survey) => survey.date >= daysAgo(6));
  const avgPain7 = week.length
    ? round1(week.reduce((sum, survey) => sum + survey.painAvg, 0) / week.length)
    : null;

  let streak = 0;
  let cursor = daysAgo(0);
  const dates = new Set(sorted.map((survey) => survey.date));
  if (!dates.has(cursor) && dates.has(daysAgo(1))) cursor = daysAgo(1);
  while (dates.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }

  return {
    total: sorted.length,
    avgPain7,
    firstPain: first.painAvg,
    lastPain: last.painAvg,
    delta: sorted.length > 1 ? round1(last.painAvg - first.painAvg) : null,
    streak,
  };
}

export async function getPatientCabinet(patientId) {
  const patient = await getPatientById(patientId);
  if (!patient) return null;
  const [surveys, alerts] = await Promise.all([
    listSurveys(patientId, 60),
    listPatientAlerts(patientId, 5),
  ]);
  const today = daysAgo(0);
  return {
    patient: mapPatient(patient),
    todayDate: today,
    today: surveys.find((survey) => survey.date === today) ?? null,
    surveys,
    alerts,
    stats: summarizeSurveys(surveys),
  };
}

export async function getPatientDetail(patientId) {
  const patient = await getPatientById(patientId);
  if (!patient) return null;
  const [surveys, alerts] = await Promise.all([
    listSurveys(patientId, 90),
    listPatientAlerts(patientId, 20),
  ]);
  return {
    patient: mapPatient(patient),
    surveys,
    alerts,
    stats: summarizeSurveys(surveys),
  };
}

export async function deletePatient(patientId) {
  await q('DELETE FROM alerts WHERE patient_id = $1', [patientId]);
  await q('DELETE FROM surveys WHERE patient_id = $1', [patientId]);
  const rows = await q('DELETE FROM patients WHERE id = $1 RETURNING id', [patientId]);
  return rows.length > 0;
}

export async function getFeedbackForDoctor(limit = 20) {
  return listFeedback(limit);
}

function csvEscape(value) {
  const string = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""').replace(/\r?\n/g, ' ')}"`;
}

export async function buildSurveysCsv() {
  const surveys = await q(
    `SELECT s.*, p.code AS code, p.name AS patient_name, p.phone AS patient_phone
     FROM surveys s
     JOIN patients p ON p.id = s.patient_id
     ORDER BY p.name ASC, s.date DESC`,
  );

  const header = [
    'Код',
    'Пациент',
    'Телефон',
    'Дата',
    'Боль средняя',
    'Боль максимальная',
    'Области боли',
    'Характер боли',
    'Ночные пробуждения',
    'Онемение',
    'Слабость',
    'Подвижность плеча',
    'Отек руки',
    'Препарат',
    'Доза',
    'Приемов',
    'Эффект препарата 0-10',
    'Нежелательные эффекты',
    'Приверженность',
    'Сон, ч',
    'Качество сна',
    'Настроение',
    'Активность',
    'Примечание',
  ];

  const lines = [header.map(csvEscape).join(';')];
  for (const row of surveys) {
    const survey = mapSurvey(row);
    lines.push(
      [
        row.code,
        row.patient_name,
        row.patient_phone,
        survey.date,
        survey.painAvg,
        survey.painMax,
        labelsOf(painLocations, survey.locations).join(', '),
        labelsOf(painCharacters, survey.characters).join(', '),
        labelOf(nightWake, survey.nightWake),
        labelOf(symptomScale, survey.numbness),
        labelOf(symptomScale, survey.weakness),
        labelOf(mobilityScale, survey.mobility),
        labelOf(edemaScale, survey.edema),
        labelOf(medOptions, survey.medName),
        survey.medDose,
        survey.medTimes,
        survey.relief,
        labelsOf(sideEffectOptions, survey.sideEffects).join(', '),
        labelOf(adherenceOptions, survey.adherence),
        survey.sleepHours,
        survey.sleepQuality,
        survey.mood,
        survey.activity,
        survey.note,
      ]
        .map(csvEscape)
        .join(';'),
    );
  }

  return { csv: `\uFEFF${lines.join('\r\n')}`, count: surveys.length };
}

const DEMO_CODE = 'OP-DEMO-2026';
const DEMO_PAIN = [8, 7, 8, 7, 6, 7, 6, 5, 6, 5, 5, 4, 6, 4, 5, 3, 4, 3, 4, 3, 3];

export async function seedDemoPatient() {
  const existing = await q('SELECT id FROM patients WHERE code = $1', [DEMO_CODE]);
  for (const row of existing) {
    await deletePatient(row.id);
  }
  await q("DELETE FROM feedback WHERE contact = '@maria_demo'");

  const token = randomToken(32);
  const createdAt = nowIso();
  const row = await insertRow('patients', {
    id: crypto.randomUUID(),
    code: DEMO_CODE,
    name: 'Мария Демидова',
    phone: '+7 (900) 000-00-01',
    diagnosis: site.diagnosis,
    token_hash: sha256(token),
    consent_at: createdAt,
    created_at: createdAt,
  });
  const patient = mapPatient(row);
  const total = DEMO_PAIN.length;

  for (let index = 0; index < total; index += 1) {
    const date = daysAgo(total - 1 - index);
    const pain = DEMO_PAIN[index];
    const improving = index > total - 7;
    await upsertSurvey(patient.id, date, {
      painAvg: pain,
      painMax: Math.min(10, pain + (index % 3 === 0 ? 2 : 1)),
      locations: improving ? ['chest_wall', 'axilla'] : ['chest_wall', 'axilla', 'upper_arm'],
      characters: improving ? ['burning', 'numbness'] : ['burning', 'shooting', 'numbness'],
      nightWake: pain >= 7 ? 'two_three' : pain >= 5 ? 'once' : 'none',
      numbness: Math.max(1, 3 - Math.floor(index / 7)),
      weakness: Math.max(1, 2 - Math.floor(index / 10)),
      mobility: Math.max(1, 2 - Math.floor(index / 9)),
      edema: index < 7 ? 2 : 1,
      medName: 'pregabalin',
      medDose: '75 мг',
      medTimes: 2,
      relief: improving ? 7 : 5,
      sideEffects: index < 5 ? ['drowsiness'] : ['none'],
      adherence: 'full',
      sleepHours: Math.min(8, 5.5 + index * 0.1),
      sleepQuality: Math.min(8, 4 + Math.floor(index / 4)),
      mood: Math.min(8, 4 + Math.floor(index / 3)),
      activity: Math.min(8, 4 + Math.floor(index / 4)),
      note:
        index === 5
          ? 'Усилилась жгучая боль после прогулки. Обсудить с врачом.'
          : index === total - 2
            ? 'Стало легче спать, боль к вечеру меньше.'
            : null,
    });
  }

  const oldDate = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const newDate = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString();
  await createAlert({
    patient,
    pain: 9,
    comment: 'Сильная жгучая боль, не могла спать.',
    telegramStatus: 'seed',
    createdAt: oldDate,
  });
  await createAlert({
    patient,
    pain: 8,
    comment: 'Боль усилилась к вечеру, таблетка помогла не полностью.',
    telegramStatus: 'seed',
    createdAt: newDate,
  });
  await q("UPDATE alerts SET status = 'handled' WHERE patient_id = $1 AND created_at = $2", [
    patient.id,
    oldDate,
  ]);

  await createFeedback({
    name: 'Мария Демидова',
    contact: '@maria_demo',
    message: 'Спасибо за дневник — стало проще замечать, что влияет на боль. И удобно, что врач видит динамику.',
    telegramStatus: 'seed',
  });

  return { patient, code: DEMO_CODE, surveys: total };
}

