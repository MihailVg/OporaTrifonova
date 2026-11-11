import { site } from '../shared/site.js';

const TZ = site.timezone;

export function nowIso() {
  return new Date().toISOString();
}

/** Дата в часовом поясе клиники в формате YYYY-MM-DD. */
export function clinicToday(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days) {
  return shiftDate(clinicToday(), -days);
}

export function formatDateTimeRu(iso) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDateRu(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).format(date);
}

export function formatShortDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

export function ageInDays(isoDate) {
  const today = new Date(`${clinicToday()}T12:00:00Z`);
  const then = new Date(`${isoDate}T12:00:00Z`);
  return Math.round((today - then) / 86_400_000);
}
