import { site } from '/shared/site.js';

/* --------------------------------------------------------------------------
   DOM и форматирование
   -------------------------------------------------------------------------- */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: site.timezone,
  day: 'numeric',
  month: 'long',
});

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: site.timezone,
  weekday: 'long',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: site.timezone,
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: site.timezone,
  hour: '2-digit',
  minute: '2-digit',
});

const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: site.timezone,
  day: '2-digit',
  month: '2-digit',
});

export function parseDateOnly(date) {
  return new Date(`${date}T12:00:00Z`);
}

export function formatDateRu(date) {
  return dateFormatter.format(parseDateOnly(date));
}

export function formatDateWithWeekday(date) {
  return `${dateFormatter.format(parseDateOnly(date))}, ${weekdayFormatter.format(parseDateOnly(date))}`;
}

export function formatDateTimeRu(iso) {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatTimeRu(iso) {
  return timeFormatter.format(new Date(iso));
}

export function formatShortDate(date) {
  return shortDateFormatter.format(parseDateOnly(date));
}

export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] || '';
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function plural(number, one, few, many) {
  const abs = Math.abs(Number(number));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* --------------------------------------------------------------------------
   Хранилище сессий
   -------------------------------------------------------------------------- */

const PATIENT_KEY = 'opora.patient.v1';
const DOCTOR_KEY = 'opora.doctor.v1';

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getPatientSession() {
  return readJson(window.localStorage, PATIENT_KEY);
}

export function setPatientSession(session) {
  return writeJson(window.localStorage, PATIENT_KEY, session);
}

export function clearPatientSession() {
  try {
    window.localStorage.removeItem(PATIENT_KEY);
  } catch {
    /* приватный режим */
  }
}

export function getDoctorSession() {
  return readJson(window.sessionStorage, DOCTOR_KEY);
}

export function setDoctorSession(session) {
  return writeJson(window.sessionStorage, DOCTOR_KEY, session);
}

export function clearDoctorSession() {
  try {
    window.sessionStorage.removeItem(DOCTOR_KEY);
  } catch {
    /* приватный режим */
  }
}

export function safeNextPath(fallback = '/cabinet') {
  try {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) {
      return next;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', fields = null, retryAfterSec = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterSec = retryAfterSec;
  }
}

function authToken(kind) {
  if (kind === 'patient') return getPatientSession()?.token ?? '';
  if (kind === 'doctor') return getDoctorSession()?.token ?? '';
  return '';
}

export async function api(path, { method = 'GET', body = null, auth = null, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';

  const token = authToken(auth);
  if (auth && !token) {
    throw new ApiError('Сессия истекла. Войдите ещё раз.', 401, 'unauthorized');
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(
      'Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.',
      0,
      'network',
    );
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok || !payload?.ok) {
    const details = payload?.error;
    throw new ApiError(
      details?.message || `Не удалось выполнить запрос (${response.status}).`,
      response.status,
      details?.code || 'request_failed',
      details?.fields || null,
      details?.retryAfterSec || null,
    );
  }

  return payload.data;
}

export async function downloadFile(path, filename, auth = null) {
  const token = authToken(auth);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { headers, credentials: 'same-origin' });
  if (!response.ok) {
    let message = 'Не удалось скачать файл.';
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------------------
   Тосты
   -------------------------------------------------------------------------- */

function ensureToastRegion() {
  let region = qs('#toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  return region;
}

export function toast(message, type = 'success', duration = 4500) {
  const region = ensureToastRegion();
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
  node.innerHTML = `<span class="toast__icon">${icon(iconName)}</span><span class="toast__text"></span><button class="toast__close" type="button" aria-label="Закрыть">×</button>`;
  node.querySelector('.toast__text').textContent = message;
  const remove = () => {
    node.style.opacity = '0';
    node.style.transform = 'translateX(8px)';
    node.style.transition = 'opacity .18s, transform .18s';
    setTimeout(() => node.remove(), 190);
  };
  node.querySelector('.toast__close').addEventListener('click', remove);
  region.append(node);
  if (duration > 0) setTimeout(remove, duration);
  return node;
}

/* --------------------------------------------------------------------------
   Модальные окна
   -------------------------------------------------------------------------- */

let modalCounter = 0;

export function openModal({ title, eyebrow = '', body = '', footer = '', className = '', onClose } = {}) {
  const id = `modal-title-${++modalCounter}`;
  const dialog = document.createElement('dialog');
  dialog.className = `modal ${className}`.trim();
  dialog.setAttribute('aria-labelledby', id);

  const head = document.createElement('div');
  head.className = 'modal__head';
  head.innerHTML = `<div>${eyebrow ? `<p class="eyebrow"><span class="eyebrow__dot"></span>${escapeHtml(eyebrow)}</p>` : ''}<h2 id="${id}">${escapeHtml(title || '')}</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Закрыть">${icon('close')}</button>`;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal__body';
  if (body instanceof Node) bodyEl.append(body);
  else bodyEl.innerHTML = body;

  dialog.append(head, bodyEl);

  if (footer) {
    const foot = document.createElement('div');
    foot.className = 'modal__foot';
    if (footer instanceof Node) foot.append(footer);
    else foot.innerHTML = footer;
    dialog.append(foot);
  }

  document.body.append(dialog);
  document.body.classList.add('modal-open');

  const close = () => {
    if (dialog.open) dialog.close();
  };

  head.querySelector('[data-close-dialog]').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    onClose?.();
  });

  dialog.showModal();
  requestAnimationFrame(() => {
    const focusable = dialog.querySelector('button, [href], input, select, textarea');
    focusable?.focus({ preventScroll: true });
  });

  return { dialog, body: bodyEl, close };
}

export function confirmDialog({
  title = 'Подтвердить действие',
  message = '',
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      modal.close();
    };

    const body = document.createElement('p');
    body.className = 'alarm-form__intro';
    body.textContent = message;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.innerHTML = `<button class="btn btn--ghost btn--sm" type="button" data-cancel>${escapeHtml(cancelLabel)}</button><button class="btn ${danger ? 'btn--coral' : 'btn--primary'} btn--sm" type="button" data-confirm>${escapeHtml(confirmLabel)}</button>`;

    const modal = openModal({
      title,
      body,
      footer,
      className: danger ? 'modal--danger' : '',
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    footer.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    footer.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
  });
}

/* --------------------------------------------------------------------------
   Формы
   -------------------------------------------------------------------------- */

export function clearFormErrors(form) {
  qsa('.field.is-invalid, .checkbox.is-invalid', form).forEach((field) => {
    field.classList.remove('is-invalid');
  });
  qsa('[aria-invalid="true"]', form).forEach((input) => input.removeAttribute('aria-invalid'));
  qsa('[data-error-for]', form).forEach((node) => {
    node.textContent = '';
  });
}

export function showFormErrors(form, errors = {}) {
  clearFormErrors(form);
  const firstInputs = [];

  for (const [name, message] of Object.entries(errors)) {
    if (!message) continue;
    const errorNode = form.querySelector(`[data-error-for="${name}"]`);
    if (errorNode) {
      errorNode.textContent = message;
      if (!errorNode.id) errorNode.id = `field-error-${name}`;
    }

    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    const field = input.closest('.field') || input.closest('.checkbox');
    field?.classList.add('is-invalid');
    if (errorNode?.id) {
      const ids = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      ids.add(errorNode.id);
      input.setAttribute('aria-describedby', [...ids].join(' '));
    }
    input.setAttribute('aria-invalid', 'true');
    firstInputs.push(input);
  }

  if (firstInputs.length) {
    const first = firstInputs[0];
    first.focus({ preventScroll: false });
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return firstInputs.length;
}

export function setFormStatus(element, message, type = 'success') {
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('is-error', type === 'error');
}

export function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle('is-loading', loading);
  button.disabled = Boolean(loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.append(area);
      area.select();
      const result = document.execCommand('copy');
      area.remove();
      return result;
    } catch {
      return false;
    }
  }
}

/* --------------------------------------------------------------------------
   Общие инициализаторы
   -------------------------------------------------------------------------- */

export function initSite() {
  const header = qs('[data-header]');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = qs('[data-menu-toggle]');
  const nav = qs('#site-nav');
  const setMenu = (open) => {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
  };

  toggle?.addEventListener('click', () => {
    setMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });
  qsa('a', nav ?? document.createElement('div')).forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) setMenu(false);
  });

  if (getPatientSession()) {
    qsa('[data-patient-cta]').forEach((element) => {
      element.textContent = 'Мой дневник';
    });
  }

  qsa('[data-print]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });
  qsa('[data-reload]').forEach((button) => {
    button.addEventListener('click', () => window.location.reload());
  });
  qsa('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });
  });
}

export function initReveal() {
  const elements = qsa('[data-reveal]');
  if (!elements.length || !('IntersectionObserver' in window)) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );

  elements.forEach((element, index) => {
    element.classList.add('will-reveal');
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
    observer.observe(element);
  });
}

export function redirectToLogin() {
  clearPatientSession();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}`);
}
