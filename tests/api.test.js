import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opora-api-test-'));
process.env.PGLITE_DIR = path.join(tempDir, 'pglite');
process.env.DOCTOR_PASSWORD = 'test-doctor-password';
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
process.env.TZ = 'Europe/Kaliningrad';

const { initDb, closeDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

await initDb();
const app = createApp();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kaliningrad',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

after(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('полный сценарий работы онлайн-дневника', async (t) => {
  let token = '';
  let doctorToken = '';
  let patientId = '';
  let patientCode = '';

  await t.test('главная страница и health-check доступны', async () => {
    const page = await request(app).get('/').expect(200);
    assert.match(page.text, /Опора/);
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.data.status, 'ok');
  });

  await t.test('регистрация пациента', async () => {
    const response = await request(app)
      .post('/api/patients')
      .send({ name: 'Тестовая Пациентка', phone: '+7 900 000-00-02', consent: true })
      .expect(201);
    assert.equal(response.body.ok, true);
    assert.match(response.body.data.patient.code, /^OP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    token = response.body.data.token;
    patientId = response.body.data.patient.id;
    patientCode = response.body.data.patient.code;
    assert.ok(token.length > 30);
  });

  await t.test('без согласия регистрация отклоняется', async () => {
    const response = await request(app)
      .post('/api/patients')
      .send({ name: 'Без Согласия', consent: false })
      .expect(422);
    assert.equal(response.body.error.code, 'validation_error');
    assert.ok(response.body.error.fields.consent);
  });

  await t.test('дневник сохраняется и возвращается', async () => {
    const response = await request(app)
      .post('/api/patient/surveys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        painAvg: 6,
        painMax: 8,
        locations: ['chest_wall', 'axilla'],
        characters: ['burning', 'shooting'],
        nightWake: 'once',
        numbness: 2,
        weakness: 1,
        mobility: 1,
        edema: 1,
        medName: 'pregabalin',
        medDose: '75 мг',
        medTimes: 2,
        relief: 6,
        sideEffects: ['drowsiness'],
        adherence: 'full',
        sleepHours: 6.5,
        sleepQuality: 5,
        mood: 6,
        activity: 6,
        note: 'Тестовая запись',
      })
      .expect(200);
    assert.equal(response.body.data.survey.date, today);
    assert.equal(response.body.data.survey.painAvg, 6);

    const cabinet = await request(app)
      .get('/api/patient/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(cabinet.body.data.patient.code, patientCode);
    assert.equal(cabinet.body.data.today.painAvg, 6);
    assert.equal(cabinet.body.data.stats.total, 1);
  });

  await t.test('тревожный сигнал сохраняется без Telegram', async () => {
    const response = await request(app)
      .post('/api/patient/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ pain: 9, comment: 'Сильная боль' })
      .expect(201);
    assert.equal(response.body.data.alert.telegramStatus, 'not_configured');
    assert.equal(response.body.data.telegram.delivered, false);
  });

  await t.test('повторный сигнал ограничен кулдауном', async () => {
    const response = await request(app)
      .post('/api/patient/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ pain: 8 })
      .expect(429);
    assert.equal(response.body.error.code, 'cooldown');
    assert.ok(response.body.error.retryAfterSec > 0);
  });

  await t.test('вход врача и обзор', async () => {
    const login = await request(app)
      .post('/api/doctor/login')
      .send({ password: 'test-doctor-password' })
      .expect(200);
    doctorToken = login.body.data.token;

    const overview = await request(app)
      .get('/api/doctor/overview')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    assert.equal(overview.body.data.stats.patients, 1);
    assert.equal(overview.body.data.patients[0].last.painAvg, 6);
    assert.equal(overview.body.data.patients[0].needsAttention, true);
    assert.equal(overview.body.data.alerts[0].pain, 9);
  });

  await t.test('врач видит карту пациента и CSV', async () => {
    const detail = await request(app)
      .get(`/api/doctor/patients/${patientId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    assert.equal(detail.body.data.surveys.length, 1);
    assert.equal(detail.body.data.alerts.length, 1);

    const csv = await request(app)
      .get('/api/doctor/export.csv')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /"Код";"Пациент";"Телефон"/);
  });

  await t.test('обратная связь принимается', async () => {
    const response = await request(app)
      .post('/api/feedback')
      .send({
        name: 'Тестовый Отправитель',
        contact: '@test',
        message: 'Проверка формы обратной связи.',
        consent: true,
      })
      .expect(201);
    assert.equal(response.body.data.stored, true);
  });

  await t.test('демо-данные создаются и видны в обзоре', async () => {
    const seeded = await request(app)
      .post('/api/doctor/demo-seed')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    assert.equal(seeded.body.data.code, 'OP-DEMO-2026');
    assert.equal(seeded.body.data.surveys, 21);

    const overview = await request(app)
      .get('/api/doctor/overview')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    const demo = overview.body.data.patients.find((patient) => patient.code === 'OP-DEMO-2026');
    assert.ok(demo);
    assert.ok(demo.last);
    assert.equal(demo.last.painAvg, 3);
  });

  await t.test('удаление пациента убирает его данные', async () => {
    await request(app)
      .delete(`/api/doctor/patients/${patientId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);

    const detail = await request(app)
      .get(`/api/doctor/patients/${patientId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(404);
    assert.equal(detail.body.error.code, 'not_found');

    const overview = await request(app)
      .get('/api/doctor/overview')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    assert.equal(overview.body.data.patients.length, 1);
    assert.equal(overview.body.data.patients[0].code, 'OP-DEMO-2026');
  });
});
