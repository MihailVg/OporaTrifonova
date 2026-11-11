import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../shared/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const asInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const asList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  root,
  site,
  version: '1.0.0',
  isProduction,
  port: asInt(process.env.PORT, 3000),

  databaseUrl: String(process.env.DATABASE_URL ?? '').trim(),
  databaseSsl: String(process.env.DATABASE_SSL ?? 'require').toLowerCase() !== 'disable',
  pgliteDir: process.env.PGLITE_DIR || path.join(root, 'data', 'pglite'),

  doctorPassword: String(process.env.DOCTOR_PASSWORD ?? '').trim() || 'opora-demo-2026',
  sessionSecret: String(process.env.SESSION_SECRET ?? '').trim() || 'dev-only-change-me-please',
  doctorSessionHours: asInt(process.env.DOCTOR_SESSION_HOURS, 12),

  telegramToken: String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim(),
  telegramChatIds: asList(process.env.TELEGRAM_CHAT_ID),
  telegramApiBase: String(process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, ''),

  alarmCooldownSec: Math.max(30, asInt(process.env.ALARM_COOLDOWN_SEC, site.alarmCooldownSec)),
  trustProxy: process.env.TRUST_PROXY !== 'false',
};

export const isTelegramConfigured = Boolean(
  config.telegramToken && config.telegramChatIds.length,
);

if (isProduction && config.sessionSecret === 'dev-only-change-me-please') {
  console.warn('[config] SESSION_SECRET не задан — используется небезопасное значение по умолчанию.');
}
if (
  isProduction &&
  ['dev-only-change-me-please', 'change-me-to-a-long-random-secret'].includes(config.sessionSecret)
) {
  console.warn('[config] SESSION_SECRET выглядит как placeholder. Сгенерируйте случайное значение.');
}
if (isProduction && config.doctorPassword === 'opora-demo-2026') {
  console.warn('[config] DOCTOR_PASSWORD не задан — используется демо-пароль. Смените его перед публикацией.');
}
