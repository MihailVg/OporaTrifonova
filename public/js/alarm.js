import { site } from '/shared/site.js';
import { painLabels } from '/shared/options.js';
import {
  api,
  clearPatientSession,
  formatDateTimeRu,
  getPatientSession,
  icon,
  initials,
  openModal,
  qs,
  setFormStatus,
  setLoading,
  toast,
} from './ui.js';

let alarmOpen = false;

function painText(value) {
  return painLabels[Number(value)] || 'Сильная';
}

function emergencyLinks() {
  return site.emergency.numbers
    .map((item) => `<a href="${item.href}">${item.label}</a>`)
    .join(' · ');
}

export function openAlarmModal() {
  const session = getPatientSession();
  if (!session?.token) {
    toast('Сначала войдите в дневник — тогда кнопка сможет отправить сигнал врачу.', 'info');
    window.location.assign('/login?next=/cabinet');
    return;
  }
  if (alarmOpen || qs('dialog[open]')) return;
  alarmOpen = true;

  const patient = session.patient || {};
  const form = document.createElement('form');
  form.className = 'alarm-form';
  form.noValidate = true;
  form.innerHTML = `
    <p class="alarm-form__intro">Врач получит сообщение с вашим именем и уровнем боли. Это не служба экстренной помощи — при угрозе жизни звоните 103 или 112.</p>
    <div class="alarm-form__patient">
      <span class="profile-avatar">${escapeInitials(initials(patient.name))}</span>
      <span><strong>${escapeInitials(patient.name)}</strong><small>Код: ${escapeInitials(patient.code)}</small></span>
    </div>
    <div class="field">
      <label class="field__label" for="alarm-pain">Насколько сильная боль сейчас?</label>
      <div class="range-field">
        <div class="range-value"><strong data-alarm-value>8</strong><span>/10</span></div>
        <input class="range" id="alarm-pain" name="pain" type="range" min="1" max="10" step="1" value="8" data-alarm-range>
        <div class="range-labels"><span>Сильная</span><span>Невыносимая</span></div>
        <p class="range-descriptor" data-alarm-descriptor>${painText(8)}</p>
      </div>
      <p class="field__error" data-error-for="pain"></p>
    </div>
    <div class="field">
      <label class="field__label" for="alarm-comment">Что происходит? <span class="field__optional">необязательно</span></label>
      <textarea class="input textarea" id="alarm-comment" name="comment" rows="3" maxlength="500" placeholder="Например: боль усилилась, не помогает обычная таблетка"></textarea>
      <p class="field__error" data-error-for="comment"></p>
    </div>
    <div class="alarm-form__warning">
      ${icon('alert')}
      <p><strong>Если состояние угрожает жизни</strong> — не ждите ответа, звоните ${emergencyLinks()}. Кнопка не заменяет экстренную помощь.</p>
    </div>
    <div class="form-status" data-alarm-status role="status"></div>
    <div class="alarm-form__actions">
      <button class="btn btn--ghost" type="button" data-cancel>Отмена</button>
      <button class="btn btn--coral" type="submit">Отправить сигнал ${icon('send')}</button>
    </div>
  `;

  const modal = openModal({
    title: 'Тревожный сигнал',
    eyebrow: 'Срочная связь',
    body: form,
    className: 'modal--alarm',
    onClose: () => {
      alarmOpen = false;
    },
  });

  const range = form.querySelector('[data-alarm-range]');
  const value = form.querySelector('[data-alarm-value]');
  const descriptor = form.querySelector('[data-alarm-descriptor]');
  const status = form.querySelector('[data-alarm-status]');

  range.addEventListener('input', () => {
    value.textContent = range.value;
    descriptor.textContent = painText(range.value);
  });

  form.querySelector('[data-cancel]').addEventListener('click', modal.close);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setFormStatus(status, '', 'success');
    setLoading(submit, true);

    try {
      const data = await api('/api/patient/alerts', {
        method: 'POST',
        auth: 'patient',
        body: {
          pain: Number(range.value),
          comment: form.querySelector('#alarm-comment').value.trim(),
        },
      });

      const success = document.createElement('div');
      success.className = 'alarm-success';
      success.innerHTML = `
        <div class="alarm-success__icon">${icon('check')}</div>
        <h3>Сигнал отправлен врачу</h3>
        <p>${escapeInitials(patient.name)}, ваш сигнал зафиксирован ${formatDateTimeRu(data.alert.createdAt)}. Врач увидит его в кабинете${data.telegram?.delivered ? ' и в Telegram' : ''}.</p>
        ${
          data.telegram?.delivered
            ? ''
            : '<p class="alarm-form__intro">Дублирование в Telegram сейчас недоступно, но сигнал сохранён в кабинете врача. Если боль нестерпима — звоните 103.</p>'
        }
        <div class="alarm-success__emergency">Если состояние угрожает жизни — <a href="tel:103">103</a> или <a href="tel:112">112</a>. Это не служба экстренной помощи.</div>
        <button class="btn btn--primary btn--block" type="button" data-close>Закрыть</button>
      `;
      form.replaceWith(success);
      const title = modal.dialog.querySelector('h2');
      if (title) title.textContent = 'Сигнал отправлен';
      success.querySelector('[data-close]').addEventListener('click', modal.close);
      success.querySelector('[data-close]').focus();
      toast('Врач получил тревожный сигнал.', 'success');
      document.dispatchEvent(new CustomEvent('opora:alert-sent', { detail: data.alert }));
    } catch (error) {
      if (error.status === 401) {
        clearPatientSession();
        modal.close();
        window.location.assign('/login?next=/cabinet');
        return;
      }
      if (error.code === 'cooldown' && error.retryAfterSec) {
        setFormStatus(
          status,
          `Сигнал уже отправлен. Повторить можно через ${error.retryAfterSec} сек. Если боль нестерпима — звоните 103.`,
          'error',
        );
      } else if (error.status === 429) {
        setFormStatus(status, 'Слишком много сигналов. Если боль нестерпима — звоните 103.', 'error');
      } else {
        setFormStatus(
          status,
          `${error.message} Если боль нестерпима, не ждите — звоните 103 или 112.`,
          'error',
        );
      }
    } finally {
      setLoading(submit, false);
    }
  });

  requestAnimationFrame(() => range.focus({ preventScroll: true }));
}

function escapeInitials(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function initAlarm() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-alarm]');
    if (!trigger) return;
    event.preventDefault();
    openAlarmModal();
  });

  if (document.body.dataset.page === 'doctor') return;
  if (['home', 'cabinet', 'survey'].includes(document.body.dataset.page)) return;
  if (!getPatientSession()?.token) return;
  const root = qs('#alarm-root');
  if (!root || root.querySelector('.alarm-fab')) return;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'alarm-fab';
  fab.setAttribute('aria-label', 'Открыть тревожную кнопку');
  fab.innerHTML = `<span class="alarm-fab__ring" aria-hidden="true"></span><span class="alarm-fab__icon">${icon('bell')}</span><span class="alarm-fab__label">Срочно болит</span>`;
  fab.addEventListener('click', openAlarmModal);
  root.append(fab);
}
