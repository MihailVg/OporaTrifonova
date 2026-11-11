import crypto from 'node:crypto';
import { config } from './config.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function generatePatientCode() {
  let body = '';
  for (let i = 0; i < 8; i += 1) {
    body += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (i === 3) body += '-';
  }
  return `OP-${body}`;
}

export function normalizeCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidCode(code) {
  return /^[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,8}){1,3}$/.test(code);
}

export function makeDoctorToken() {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      iat: Date.now(),
      exp: Date.now() + config.doctorSessionHours * 60 * 60 * 1000,
    }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyDoctorToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');

  if (!safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data?.v === 1 && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function checkDoctorPassword(input) {
  const expected = sha256(config.doctorPassword);
  const actual = sha256(String(input ?? ''));
  return safeEqual(actual, expected);
}

export function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}
