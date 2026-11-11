import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, isTelegramConfigured } from './config.js';
import { site } from '../shared/site.js';
import * as options from '../shared/options.js';
import * as repo from './repo.js';
import { getDbKind } from './db.js';
import {
  alarmMessage,
  feedbackMessage,
  sendTelegram,
  sendTestTelegram,
  telegramStatusFromResult,
} from './notify.js';
import {
  bearerToken,
  checkDoctorPassword,
  makeDoctorToken,
  sha256,
  verifyDoctorToken,
} from './auth.js';
import {
  parseAlarm,
  parseCodeLogin,
  parseDoctorLogin,
  parseFeedback,
  parseRegistration,
  parseSurvey,
} from './validate.js';
import { clinicToday } from './time.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, status, code, message, fields) {
  const error = { code, message };
  if (fields) error.fields = fields;
  return res.status(status).json({ ok: false, error });
}

function createLimiter({ windowMs, max, message, keyPrefix = '' }) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  timer.unref?.();

  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return fail(res, 429, 'rate_limited', message);
    }
    return next();
  };
}

const requirePatient = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return fail(res, 401, 'unauthorized', 'Нужно войти в дневник.');
  const patient = await repo.findPatientByTokenHash(sha256(token));
  if (!patient) return fail(res, 401, 'unauthorized', 'Сессия истекла. Войдите по коду ещё раз.');
  req.patient = patient;
  return next();
});

const requireDoctor = asyncHandler(async (req, res, next) => {
  if (!verifyDoctorToken(bearerToken(req))) {
    return fail(res, 401, 'unauthorized', 'Нужно войти в кабинет врача.');
  }
  return next();
});

function parseUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? ''),
  );
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(config.isProduction
            ? { upgradeInsecureRequests: [] }
            : { upgradeInsecureRequests: null }),
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: '96kb' }));
  app.use(express.urlencoded({ extended: false, limit: '96kb' }));

  app.use(
    '/shared',
    express.static(path.join(root, 'shared'), {
      maxAge: config.isProduction ? '7d' : 0,
      etag: true,
      dotfiles: 'ignore',
    }),
  );
  app.use(
    express.static(path.join(root, 'public'), {
      maxAge: config.isProduction ? '7d' : 0,
      etag: true,
      dotfiles: 'ignore',
    }),
  );

  app.use((req, res, next) => {
    res.locals.site = site;
    res.locals.options = options;
    res.locals.year = site.year;
    res.locals.version = config.version;
    res.locals.currentPath = req.path;
    res.locals.isDemo = site.demo;
    res.locals.telegramConfigured = isTelegramConfigured;
    res.locals.bodyClass = '';
    res.locals.page = '';
    res.locals.scripts = [];
    res.locals.minimal = false;
    res.locals.noindex = site.demo;
    res.locals.title = site.name;
    res.locals.description = site.description;
    next();
  });

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - started;
      if (!req.path.startsWith('/api/health')) {
        console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration} мс)`);
      }
    });
    next();
  });

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.svg'));
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(site.demo ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (req, res) => {
    res.json({
      ok: true,
      data: {
        status: 'ok',
        db: getDbKind(),
        telegram: isTelegramConfigured,
        time: new Date().toISOString(),
      },
    });
  });

  const registerLimiter = createLimiter({
    windowMs: 60 * 60 * 1000,
    max: 30,
    keyPrefix: 'register',
    message: 'Слишком много попыток регистрации. Попробуйте позже.',
  });
  const patientLoginLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyPrefix: 'patient-login',
    message: 'Слишком много попыток входа. Подождите 15 минут.',
  });
  const doctorLoginLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    max: 12,
    keyPrefix: 'doctor-login',
    message: 'Слишком много попыток входа. Подождите 15 минут.',
  });
  const feedbackLimiter = createLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyPrefix: 'feedback',
    message: 'Слишком много сообщений. Попробуйте позже или напишите в Telegram.',
  });
  const alertLimiter = createLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyPrefix: 'alerts',
    message: 'Слишком много сигналов. Если боль нестерпима — звоните 103.',
  });

  api.post(
    '/patients',
    registerLimiter,
    asyncHandler(async (req, res) => {
      const parsed = parseRegistration(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Проверьте поля формы.', parsed.errors);
      }
      const { patient, token } = await repo.createPatient(parsed.value);
      return ok(res, { patient, token }, 201);
    }),
  );

  api.post(
    '/patients/login',
    patientLoginLimiter,
    asyncHandler(async (req, res) => {
      const parsed = parseCodeLogin(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Проверьте код доступа.', parsed.errors);
      }
      const row = await repo.findPatientByCode(parsed.value.code);
      if (!row) {
        return fail(
          res,
          404,
          'code_not_found',
          'Код не найден. Проверьте его в личном кабинете или зарегистрируйтесь заново.',
        );
      }
      const token = await repo.rotatePatientToken(row.id);
      return ok(res, { patient: repo.mapPatient(row), token });
    }),
  );

  api.get(
    '/patient/me',
    requirePatient,
    asyncHandler(async (req, res) => {
      const data = await repo.getPatientCabinet(req.patient.id);
      return ok(res, data);
    }),
  );

  api.get(
    '/patient/surveys',
    requirePatient,
    asyncHandler(async (req, res) => {
      const surveys = await repo.listSurveys(req.patient.id, 60);
      return ok(res, { surveys });
    }),
  );

  api.post(
    '/patient/surveys',
    requirePatient,
    asyncHandler(async (req, res) => {
      const parsed = parseSurvey(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Проверьте ответы дневника.', parsed.errors);
      }
      const date = clinicToday();
      const existed = await repo.getSurveyForDate(req.patient.id, date);
      const survey = await repo.upsertSurvey(req.patient.id, date, parsed.value);
      const surveys = await repo.listSurveys(req.patient.id, 60);
      return ok(res, {
        survey,
        updated: Boolean(existed),
        stats: repo.summarizeSurveys(surveys),
      });
    }),
  );

  api.post(
    '/patient/alerts',
    requirePatient,
    alertLimiter,
    asyncHandler(async (req, res) => {
      const parsed = parseAlarm(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Проверьте сигнал.', parsed.errors);
      }

      const latest = await repo.latestAlertForPatient(req.patient.id);
      if (latest) {
        const elapsed = Date.now() - new Date(latest.createdAt).getTime();
        const cooldown = config.alarmCooldownSec * 1000;
        if (elapsed < cooldown) {
          return res.status(429).json({
            ok: false,
            error: {
              code: 'cooldown',
              message: 'Сигнал уже отправлен. Дайте врачу время увидеть его.',
              retryAfterSec: Math.ceil((cooldown - elapsed) / 1000),
            },
          });
        }
      }

      const patient = repo.mapPatient(req.patient);
      const alert = await repo.createAlert({
        patient,
        pain: parsed.value.pain,
        comment: parsed.value.comment,
        telegramStatus: 'pending',
      });

      const result = await sendTelegram(
        alarmMessage({
          patient,
          pain: parsed.value.pain,
          comment: parsed.value.comment,
          createdAt: alert.createdAt,
        }),
      );
      const status = telegramStatusFromResult(result);
      await repo.setAlertTelegramStatus(alert.id, status);

      return ok(
        res,
        {
          alert: { ...alert, telegramStatus: status },
          telegram: { delivered: result.ok, reason: result.reason ?? null },
          emergency: site.emergency,
        },
        201,
      );
    }),
  );

  api.get(
    '/patient/alerts',
    requirePatient,
    asyncHandler(async (req, res) => {
      const alerts = await repo.listPatientAlerts(req.patient.id, 10);
      return ok(res, { alerts });
    }),
  );

  api.post(
    '/feedback',
    feedbackLimiter,
    asyncHandler(async (req, res) => {
      if (String(req.body?.website ?? '').trim()) {
        return ok(res, { stored: true, delivered: false }, 201);
      }
      const parsed = parseFeedback(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Проверьте поля формы.', parsed.errors);
      }
      const feedback = await repo.createFeedback(parsed.value);
      const result = await sendTelegram(
        feedbackMessage({
          name: parsed.value.name,
          contact: parsed.value.contact,
          message: parsed.value.message,
          createdAt: feedback.createdAt,
        }),
      );
      await repo.setFeedbackTelegramStatus(feedback.id, telegramStatusFromResult(result));
      return ok(res, { stored: true, delivered: result.ok }, 201);
    }),
  );

  api.post(
    '/doctor/login',
    doctorLoginLimiter,
    asyncHandler(async (req, res) => {
      const parsed = parseDoctorLogin(req.body);
      if (!parsed.ok) {
        return fail(res, 422, 'validation_error', 'Введите пароль.', parsed.errors);
      }
      if (!checkDoctorPassword(parsed.value.password)) {
        return fail(res, 401, 'invalid_credentials', 'Неверный пароль. Проверьте раскладку.');
      }
      return ok(res, {
        token: makeDoctorToken(),
        expiresInHours: config.doctorSessionHours,
      });
    }),
  );

  api.get(
    '/doctor/overview',
    requireDoctor,
    asyncHandler(async (req, res) => {
      const data = await repo.getDoctorOverview();
      return ok(res, { ...data, dbKind: getDbKind() });
    }),
  );

  api.get(
    '/doctor/patients/:id',
    requireDoctor,
    asyncHandler(async (req, res) => {
      if (!parseUuid(req.params.id)) return fail(res, 404, 'not_found', 'Пациент не найден.');
      const data = await repo.getPatientDetail(req.params.id);
      if (!data) return fail(res, 404, 'not_found', 'Пациент не найден.');
      return ok(res, data);
    }),
  );

  api.patch(
    '/doctor/alerts/:id',
    requireDoctor,
    asyncHandler(async (req, res) => {
      if (!parseUuid(req.params.id)) return fail(res, 404, 'not_found', 'Сигнал не найден.');
      const alert = await repo.markAlertHandled(req.params.id);
      if (!alert) return fail(res, 404, 'not_found', 'Сигнал не найден.');
      return ok(res, { alert });
    }),
  );

  api.delete(
    '/doctor/patients/:id',
    requireDoctor,
    asyncHandler(async (req, res) => {
      if (!parseUuid(req.params.id)) return fail(res, 404, 'not_found', 'Пациент не найден.');
      const deleted = await repo.deletePatient(req.params.id);
      if (!deleted) return fail(res, 404, 'not_found', 'Пациент не найден.');
      return ok(res, { deleted: true });
    }),
  );

  api.get(
    '/doctor/export.csv',
    requireDoctor,
    asyncHandler(async (req, res) => {
      const { csv, count } = await repo.buildSurveysCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="opora-surveys-${clinicToday()}.csv"`,
      );
      res.setHeader('X-Row-Count', String(count));
      return res.send(csv);
    }),
  );

  api.post(
    '/doctor/test-telegram',
    requireDoctor,
    asyncHandler(async (req, res) => {
      const result = await sendTestTelegram();
      return ok(res, {
        configured: isTelegramConfigured,
        delivered: result.ok,
        reason: result.reason ?? null,
        sent: result.sent ?? 0,
        failed: result.failed ?? 0,
      });
    }),
  );

  api.post(
    '/doctor/demo-seed',
    requireDoctor,
    asyncHandler(async (req, res) => {
      if (!site.demo) {
        return fail(res, 403, 'demo_disabled', 'Демо-режим отключён в настройках сайта.');
      }
      const result = await repo.seedDemoPatient();
      return ok(res, {
        code: result.code,
        surveys: result.surveys,
        patient: repo.mapPatient(result.patient),
      });
    }),
  );

  api.use((req, res) => fail(res, 404, 'not_found', 'Такого метода API нет.'));

  app.use('/api', api);

  const page = (view, optionsForPage) =>
    asyncHandler(async (req, res) => {
      res.render(`pages/${view}`, {
        ...res.locals,
        ...optionsForPage,
      });
    });

  app.get(
    '/',
    page('index', {
      title: 'Жизнь после операции — без боли и одиночества',
      description: site.description,
      page: 'home',
      scripts: ['/js/home.js'],
    }),
  );

  app.get(
    '/info',
    page('info', {
      title: 'Постмастэктомическая нейропатия и плексопатия — понятно о важном',
      description:
        'Что такое постмастэктомическая нейропатия и плексопатия, почему возникает боль, как её лечат и когда нужно срочно обратиться к врачу.',
      page: 'info',
      scripts: ['/js/info.js'],
    }),
  );

  app.get(
    '/login',
    page('login', {
      title: 'Вход в дневник',
      description: 'Войдите по коду пациента или создайте личный дневник боли.',
      page: 'login',
      bodyClass: 'page-auth',
      minimal: true,
      scripts: ['/js/auth.js'],
    }),
  );

  app.get(
    '/cabinet',
    page('cabinet', {
      title: 'Мой дневник',
      description: 'Ежедневный дневник боли, динамика и связь с врачом.',
      page: 'cabinet',
      bodyClass: 'page-cabinet',
      scripts: ['/js/cabinet.js'],
    }),
  );

  app.get(
    '/survey',
    page('survey', {
      title: 'Утренний дневник',
      description: 'Отметьте, как вы себя чувствуете сегодня.',
      page: 'survey',
      bodyClass: 'page-survey',
      minimal: true,
      scripts: ['/js/survey.js'],
    }),
  );

  app.get(
    '/doctor',
    page('doctor', {
      title: 'Кабинет врача',
      description: 'Динамика пациентов, тревожные сигналы и обратная связь.',
      page: 'doctor',
      bodyClass: 'page-doctor',
      minimal: true,
      noindex: true,
      scripts: ['/js/doctor.js'],
    }),
  );

  app.get(
    '/privacy',
    page('privacy', {
      title: 'Политика обработки персональных данных',
      description: 'Как «Опора» обращается с персональными данными пациентов.',
      page: 'privacy',
      bodyClass: 'page-legal',
    }),
  );

  app.get(
    '/consent',
    page('consent', {
      title: 'Согласие на обработку персональных данных',
      description: 'Текст согласия на обработку персональных данных и данных о здоровье.',
      page: 'consent',
      bodyClass: 'page-legal',
    }),
  );

  app.get(
    '/terms',
    page('terms', {
      title: 'Пользовательское соглашение',
      description: 'Условия использования демонстрационного сервиса «Опора».',
      page: 'terms',
      bodyClass: 'page-legal',
    }),
  );

  app.use((req, res) => {
    res.status(404).render('pages/404', {
      ...res.locals,
      title: 'Страница не найдена',
      description: 'Такой страницы нет.',
      page: '404',
      scripts: [],
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api/')) {
      if (error?.type === 'entity.parse.failed') {
        return fail(res, 400, 'invalid_json', 'Некорректный JSON в запросе.');
      }
      if (error?.type === 'entity.too.large') {
        return fail(res, 413, 'too_large', 'Слишком большой запрос.');
      }
    }
    console.error('[error]', error);
    if (req.path.startsWith('/api/')) {
      return fail(res, 500, 'server_error', 'Что-то пошло не так. Попробуйте ещё раз.');
    }
    return res.status(500).render('pages/500', {
      ...res.locals,
      title: 'Внутренняя ошибка',
      description: 'Что-то пошло не так.',
      page: '500',
      scripts: [],
    });
  });

  return app;
}
