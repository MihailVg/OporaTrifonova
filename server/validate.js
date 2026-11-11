import {
  adherenceOptions,
  edemaScale,
  medOptions,
  mobilityScale,
  nightWake,
  painCharacters,
  painLocations,
  sideEffectOptions,
  symptomScale,
} from '../shared/options.js';

const oneOf = (list) => new Set(list.map((item) => item.value));
const LOCATIONS = oneOf(painLocations);
const CHARACTERS = oneOf(painCharacters);
const NIGHT_WAKE = oneOf(nightWake);
const MEDS = oneOf(medOptions);
const SIDE_EFFECTS = oneOf(sideEffectOptions);
const ADHERENCE = oneOf(adherenceOptions);
const SYMPTOM = oneOf(symptomScale);
const MOBILITY = oneOf(mobilityScale);
const EDEMA = oneOf(edemaScale);

function text(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function integer(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  return Number.NaN;
}

function decimal(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return Number.NaN;
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

function values(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 40)).filter(Boolean))];
}

export function parseRegistration(body = {}) {
  const errors = {};
  const name = text(body.name, 80).replace(/\s+/g, ' ');
  const phone = text(body.phone, 30);
  const consent = bool(body.consent);

  if (name.length < 2) errors.name = 'Укажите имя и фамилию — минимум 2 символа.';
  if (name.length > 80) errors.name = 'Имя слишком длинное — до 80 символов.';
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (!/^[+\d][\d\s()\-]{8,}$/.test(phone) || digits.length < 10 || digits.length > 15) {
      errors.phone = 'Проверьте номер: 10–15 цифр, можно с +7 и пробелами.';
    }
  }
  if (!consent) errors.consent = 'Без согласия на обработку данных мы не можем создать дневник.';

  return { ok: Object.keys(errors).length === 0, errors, value: { name, phone, consent } };
}

export function parseCodeLogin(body = {}) {
  const errors = {};
  const raw = text(body.code, 40);
  const code = raw.toUpperCase().replace(/[–—−]/g, '-').replace(/\s+/g, '').replace(/-+/g, '-');
  if (!/^[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,8}){1,3}$/.test(code)) {
    errors.code = 'Введите код из личного кабинета, например OP-7K3Q-9X2M.';
  }
  return { ok: Object.keys(errors).length === 0, errors, value: { code } };
}

export function parseSurvey(body = {}) {
  const errors = {};
  const painAvg = integer(body.painAvg);
  const painMax = integer(body.painMax);
  const locations = values(body.locations).filter((value) => LOCATIONS.has(value));
  const characters = values(body.characters).filter((value) => CHARACTERS.has(value));
  const nightWakeValue = text(body.nightWake, 30);
  const numbness = integer(body.numbness);
  const weakness = integer(body.weakness);
  const mobility = integer(body.mobility);
  const edema = integer(body.edema);
  const medName = text(body.medName, 40);
  const medDose = text(body.medDose, 80);
  const medTimes = body.medTimes === '' || body.medTimes === null || body.medTimes === undefined
    ? null
    : integer(body.medTimes);
  const reliefRaw = body.relief === '' || body.relief === null || body.relief === undefined
    ? null
    : integer(body.relief);
  const sideEffects = values(body.sideEffects).filter((value) => SIDE_EFFECTS.has(value));
  const adherence = text(body.adherence, 30);
  const sleepHours = decimal(body.sleepHours);
  const sleepQuality = integer(body.sleepQuality);
  const mood = integer(body.mood);
  const activity = integer(body.activity);
  const note = text(body.note, 1000);

  if (!Number.isInteger(painAvg) || painAvg < 0 || painAvg > 10) {
    errors.painAvg = 'Оцените среднюю боль по шкале от 0 до 10.';
  }
  if (!Number.isInteger(painMax) || painMax < 0 || painMax > 10) {
    errors.painMax = 'Оцените максимальную боль по шкале от 0 до 10.';
  }
  if (Number.isInteger(painAvg) && Number.isInteger(painMax) && painMax < painAvg) {
    errors.painMax = 'Максимальная боль не может быть ниже средней.';
  }
  if (!NIGHT_WAKE.has(nightWakeValue)) {
    errors.nightWake = 'Укажите, просыпались ли вы ночью из-за боли.';
  }
  if ((painMax > 0 || painAvg > 0) && locations.length === 0) {
    errors.locations = 'Отметьте хотя бы одну область боли.';
  }
  if ((painMax > 0 || painAvg > 0) && characters.length === 0) {
    errors.characters = 'Отметьте хотя бы один характер боли.';
  }
  if (!SYMPTOM.has(numbness)) errors.numbness = 'Оцените онемение.';
  if (!SYMPTOM.has(weakness)) errors.weakness = 'Оцените слабость в руке.';
  if (!MOBILITY.has(mobility)) errors.mobility = 'Оцените подвижность плеча.';
  if (!EDEMA.has(edema)) errors.edema = 'Оцените отёк руки.';

  if (!MEDS.has(medName)) {
    errors.medName = 'Укажите, что принимали для облегчения боли.';
  }
  const tookMedicine = medName && medName !== 'none';
  if (tookMedicine) {
    if (medTimes !== null && (!Number.isInteger(medTimes) || medTimes < 0 || medTimes > 20)) {
      errors.medTimes = 'Количество приёмов — от 0 до 20.';
    }
    if (reliefRaw === null || !Number.isInteger(reliefRaw) || reliefRaw < 0 || reliefRaw > 10) {
      errors.relief = 'Оцените, насколько препарат помог, от 0 до 10.';
    }
    if (sideEffects.length === 0) {
      errors.sideEffects = 'Отметьте «Не было» или укажите нежелательные эффекты.';
    }
  }
  if (!ADHERENCE.has(adherence)) {
    errors.adherence = 'Укажите, получалось ли принимать назначенное лечение.';
  }
  if (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 14) {
    errors.sleepHours = 'Укажите сон за сутки — от 0 до 14 часов.';
  }
  for (const [field, value, label] of [
    ['sleepQuality', sleepQuality, 'качество сна'],
    ['mood', mood, 'настроение'],
    ['activity', activity, 'активность'],
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      errors[field] = `Оцените ${label} от 0 до 10.`;
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      painAvg,
      painMax,
      locations,
      characters,
      nightWake: nightWakeValue,
      numbness,
      weakness,
      mobility,
      edema,
      medName,
      medDose: tookMedicine ? medDose || null : null,
      medTimes: tookMedicine ? medTimes : null,
      relief: tookMedicine ? reliefRaw : null,
      sideEffects: tookMedicine ? sideEffects : [],
      adherence,
      sleepHours,
      sleepQuality,
      mood,
      activity,
      note: note || null,
    },
  };
}

export function parseAlarm(body = {}) {
  const errors = {};
  const pain = integer(body.pain);
  const comment = text(body.comment, 500);
  if (!Number.isInteger(pain) || pain < 1 || pain > 10) {
    errors.pain = 'Оцените боль от 1 до 10.';
  }
  return { ok: Object.keys(errors).length === 0, errors, value: { pain, comment: comment || null } };
}

export function parseFeedback(body = {}) {
  const errors = {};
  const name = text(body.name, 80).replace(/\s+/g, ' ');
  const contact = text(body.contact, 120);
  const message = text(body.message, 2000);
  const consent = bool(body.consent);

  if (name.length < 2) errors.name = 'Укажите имя — минимум 2 символа.';
  if (contact.length < 3) errors.contact = 'Оставьте телефон, e-mail или Telegram.';
  if (message.length < 10) errors.message = 'Расскажите чуть подробнее — минимум 10 символов.';
  if (message.length > 2000) errors.message = 'Сообщение слишком длинное — до 2000 символов.';
  if (!consent) errors.consent = 'Отметьте согласие на обработку данных.';

  return { ok: Object.keys(errors).length === 0, errors, value: { name, contact, message, consent } };
}

export function parseDoctorLogin(body = {}) {
  const password = text(body.password, 200);
  return {
    ok: password.length > 0,
    errors: password ? {} : { password: 'Введите пароль.' },
    value: { password },
  };
}
