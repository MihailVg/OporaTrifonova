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
} from '/shared/options.js';
import { lineChart } from './charts.js';
import {
  api,
  clearDoctorSession,
  clearFormErrors,
  confirmDialog,
  downloadFile,
  escapeHtml,
  formatDateRu,
  formatDateWithWeekday,
  formatDateTimeRu,
  formatTimeRu,
  getDoctorSession,
  icon,
  initials,
  qs,
  qsa,
  setDoctorSession,
  setFormStatus,
  setLoading,
  showFormErrors,
  toast,
} from './ui.js';

const loginScreen = qs('[data-doctor-login]');
const dashboard = qs('[data-doctor-dashboard]');
const loginForm = qs('[data-doctor-login-form]');
const loginStatus = qs('[data-doctor-login-status]');
const loading = qs('[data-dashboard-loading]');
const patientDialog = qs('[data-patient-dialog]');
const patientDialogBody = qs('[data-patient-dialog-body]');

let state = {
  overview: null,
  patients: [],
  alerts: [],
  feedback: [],
  alertFilter: 'all',
  demoCode: '',
};
let currentPatientId = null;
let initialized = false;

function showDashboard() {
  if (loginScreen) loginScreen.hidden = true;
  if (dashboard) dashboard.hidden = false;
  document.body.classList.add('doctor-session');
}

function showLogin(message = '') {
  if (dashboard) dashboard.hidden = true;
  if (loginScreen) loginScreen.hidden = false;
  document.body.classList.remove('doctor-session');
  if (message) toast(message, 'info');
}

function telegramStatusLabel(status) {
  switch (status) {
    case 'sent':
      return 'Telegram: отправлено';
    case 'partial':
      return 'Telegram: частично';
    case 'failed':
      return 'Telegram: ошибка';
    case 'not_configured':
      return 'Telegram не настроен';
    case 'seed':
      return 'демо-сигнал';
    default:
      return 'Telegram: ожидание';
  }
}

function painBadge(value) {
  const pain = Number(value);
  const cls = pain >= 7 ? 'pain-badge--high' : pain >= 4 ? 'pain-badge--mid' : '';
  return `<span class="pain-badge ${cls}">${pain}<small>/10</small></span>`;
}

function trendHtml(trend) {
  if (trend === null || trend === undefined) return '<span class="trend trend--flat">—</span>';
  const value = Number(trend);
  if (value < 0) {
    return `<span class="trend trend--down">${icon('trend-down')} ${Math.abs(value)}</span>`;
  }
  if (value > 0) {
    return `<span class="trend trend--up">${icon('arrow-up-right')} +${value}</span>`;
  }
  return '<span class="trend trend--flat">0</span>';
}

function renderStats() {
  const stats = state.overview?.stats ?? {};
  qs('[data-stat="patients"]').textContent = stats.patients ?? 0;
  qs('[data-stat="today"]').textContent = stats.surveysToday ?? 0;
  qs('[data-stat="avg"]').textContent =
    stats.avgPain7 === null || stats.avgPain7 === undefined ? '—' : String(stats.avgPain7);
  qs('[data-stat="alerts"]').textContent = stats.newAlerts ?? 0;

  const count = qs('[data-alerts-count]');
  if (count) {
    count.hidden = !stats.newAlerts;
    count.textContent = String(stats.newAlerts ?? 0);
  }

  const updated = qs('[data-overview-updated]');
  if (updated) updated.textContent = `Обновлено в ${formatTimeRu(new Date().toISOString())}`;
  const date = qs('[data-doctor-date]');
  if (date && state.overview?.today) {
    date.textContent = formatDateWithWeekday(state.overview.today);
  }
}

function renderOverviewChart() {
  const chart = state.overview?.chart ?? [];
  const svg = qs('[data-overview-chart]');
  const empty = qs('[data-overview-chart-empty]');
  const hasData = chart.some((point) => point.avg !== null && point.avg !== undefined);
  if (!hasData) {
    if (empty) empty.hidden = false;
    if (svg) svg.hidden = true;
    return;
  }
  const hasChart = lineChart(
    svg,
    chart.map((point) => ({ date: point.date, avg: point.avg, max: point.max })),
    { height: 260 },
  );
  if (svg) svg.hidden = !hasChart;
  if (empty) empty.hidden = hasChart;
}

function alertHtml(alert, { compact = false } = {}) {
  const isNew = alert.status === 'new';
  return `
    <article class="alert-item ${isNew ? 'alert-item--new' : ''}" data-alert-id="${escapeHtml(alert.id)}">
      <div class="alert-item__head">
        <span class="alert-item__name">${escapeHtml(alert.patientName)}</span>
        <span class="alert-item__pain">боль ${Number(alert.pain)}/10</span>
        <span class="alert-item__time">${escapeHtml(formatDateTimeRu(alert.createdAt))}</span>
      </div>
      ${alert.comment ? `<p class="alert-item__comment">${escapeHtml(alert.comment)}</p>` : ''}
      <div class="alert-item__foot">
        <span class="alert-item__status">${isNew ? 'Не обработан' : 'Обработан'} · ${escapeHtml(telegramStatusLabel(alert.telegramStatus))}</span>
        <div class="alert-item__actions">
          <button class="alert-item__action" type="button" data-open-patient="${escapeHtml(alert.patientId)}">Карта</button>
          ${
            isNew
              ? `<button class="alert-item__action" type="button" data-handle-alert="${escapeHtml(alert.id)}">Обработать</button>`
              : '<button class="alert-item__action is-done" type="button" disabled>Готово</button>'
          }
        </div>
      </div>
    </article>
  `;
}

function renderOverviewAlerts() {
  const container = qs('[data-overview-alerts]');
  if (!container) return;
  const alerts = (state.alerts ?? []).slice(0, 4);
  if (!alerts.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 12px">
        <span class="empty-state__icon">${icon('bell')}</span>
        <h3>Сигналов нет</h3>
        <p>Если пациентке станет хуже, сигнал появится здесь и придёт в Telegram.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = alerts.map((alert) => alertHtml(alert, { compact: true })).join('');
}

function attentionHtml(patient) {
  const last = patient.last;
  return `
    <button class="attention-item" type="button" data-open-patient="${escapeHtml(patient.id)}">
      <span class="attention-avatar">${escapeHtml(initials(patient.name))}</span>
      <span class="attention-main">
        <strong>${escapeHtml(patient.name)}</strong>
        <span>${last ? `${escapeHtml(formatDateRu(last.date))} · боль ${Number(last.painMax)}/10` : 'ещё нет записей'}</span>
      </span>
      <span class="attention-pain">${last ? `${Number(last.painAvg)}<small>/10</small>` : '—'}</span>
      ${icon('arrow-right', 'icon attention-arrow')}
    </button>
  `;
}

function renderAttention() {
  const container = qs('[data-attention-list]');
  if (!container) return;
  const patients = (state.patients ?? []).filter((patient) => patient.needsAttention).slice(0, 6);
  if (!patients.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 12px">
        <span class="empty-state__icon">${icon('check-circle')}</span>
        <h3>Все стабильны</h3>
        <p>Нет пациентов с высокой болью, пропущенными записями или новыми сигналами.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = patients.map(attentionHtml).join('');
}

function feedbackHtml(item) {
  return `
    <article class="feedback-item">
      <div class="feedback-item__head">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(formatDateTimeRu(item.createdAt))}</span>
      </div>
      <p class="feedback-item__contact">${escapeHtml(item.contact)}</p>
      <p class="feedback-item__message">${escapeHtml(item.message)}</p>
    </article>
  `;
}

function renderFeedback() {
  const container = qs('[data-feedback-list]');
  if (!container) return;
  const items = (state.feedback ?? []).slice(0, 4);
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 12px">
        <span class="empty-state__icon">${icon('message')}</span>
        <h3>Сообщений пока нет</h3>
        <p>Обращения с сайта появятся здесь.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = items.map(feedbackHtml).join('');
}

function patientRowHtml(patient) {
  const last = patient.last;
  const status = patient.needsAttention
    ? '<span class="status-pill status-pill--attention">Внимание</span>'
    : last
      ? '<span class="status-pill status-pill--ok">Наблюдение</span>'
      : '<span class="status-pill">Нет записей</span>';
  return `
    <tr class="patient-row" data-patient-id="${escapeHtml(patient.id)}">
      <td data-label="Пациент">
        <span class="patient-cell">
          <span class="patient-avatar">${escapeHtml(initials(patient.name))}</span>
          <span><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.phone || 'телефон не указан')}</small></span>
        </span>
      </td>
      <td data-label="Код"><span class="patient-code">${escapeHtml(patient.code)}</span></td>
      <td data-label="Последняя запись">${last ? escapeHtml(formatDateRu(last.date)) : '—'}</td>
      <td data-label="Боль">${last ? painBadge(last.painMax) : '—'}</td>
      <td data-label="Динамика">${last ? trendHtml(patient.trend) : '—'}</td>
      <td data-label="Статус">${status}</td>
      <td data-label="Открыть" class="row-action">
        <button class="icon-button row-action" type="button" data-open-patient="${escapeHtml(patient.id)}" aria-label="Открыть карту: ${escapeHtml(patient.name)}">${icon('arrow-right')}</button>
      </td>
    </tr>
  `;
}

function renderPatientsTable() {
  const tbody = qs('[data-patients-body]');
  const empty = qs('[data-patients-empty]');
  const wrap = qs('.table-wrap');
  if (!tbody) return;

  const query = (qs('[data-patient-search]')?.value || '').trim().toLowerCase();
  const filtered = (state.patients ?? []).filter(
    (patient) =>
      !query ||
      patient.name.toLowerCase().includes(query) ||
      patient.code.toLowerCase().includes(query),
  );

  if (!filtered.length) {
    tbody.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      const title = empty.querySelector('h3');
      if (title) title.textContent = state.patients.length ? 'Ничего не найдено' : 'Пока нет пациентов';
    }
    if (wrap) wrap.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (wrap) wrap.hidden = false;
  tbody.innerHTML = filtered.map(patientRowHtml).join('');
}

function renderAlertsPanel() {
  const container = qs('[data-alerts-list]');
  if (!container) return;
  const filter = state.alertFilter;
  const items = (state.alerts ?? []).filter((alert) => filter === 'all' || alert.status === 'new');
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">${icon('bell')}</span>
        <h3>Сигналов нет</h3>
        <p>Если пациентке станет хуже, сигнал появится здесь.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = items.map((alert) => alertHtml(alert)).join('');
}

function renderSettings() {
  const configured = state.overview?.telegramConfigured;
  const statusNode = qs('[data-telegram-status]');
  if (statusNode && state.overview) {
    statusNode.textContent = configured ? 'Настроен' : 'Не настроен';
    statusNode.classList.toggle('is-ok', Boolean(configured));
    statusNode.classList.toggle('is-warn', !configured);
  }
  const db = qs('[data-db-kind]');
  if (db && state.overview?.dbKind) {
    db.textContent = state.overview.dbKind === 'postgres' ? 'PostgreSQL' : 'PGlite (локальное)';
  }
  const demo = qs('[data-demo-code]');
  if (demo) {
    demo.hidden = !state.demoCode;
    if (state.demoCode) {
      demo.innerHTML = `Демо-данные созданы. Код для входа: <code>${escapeHtml(state.demoCode)}</code>`;
    }
  }
}

function renderAll() {
  renderStats();
  renderOverviewChart();
  renderOverviewAlerts();
  renderAttention();
  renderFeedback();
  renderPatientsTable();
  renderAlertsPanel();
  renderSettings();
}

function currentTab() {
  const active = qs('.doctor-tab.is-active');
  return active?.dataset.doctorTab || 'overview';
}

function setTab(name, { updateHash = true } = {}) {
  qsa('.doctor-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.doctorTab === name);
  });
  qsa('[data-doctor-panel]').forEach((panel) => {
    const active = panel.dataset.doctorPanel === name;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  if (updateHash) {
    try {
      window.history.replaceState(null, '', `#${name}`);
    } catch {
      /* ignore */
    }
  }
}

function showLoadError(message) {
  if (!loading) return;
  loading.hidden = false;
  loading.innerHTML = `<div class="empty-state" style="padding:30px 12px"><span class="empty-state__icon">${icon('alert')}</span><p>${escapeHtml(message)}</p><button class="btn btn--secondary btn--sm" type="button" data-retry-doctor>Повторить</button></div>`;
  loading.querySelector('[data-retry-doctor]')?.addEventListener('click', () => loadOverview());
}

async function loadOverview({ silent = false } = {}) {
  if (loading) {
    loading.hidden = false;
    loading.innerHTML = `<span class="spinner" aria-hidden="true"></span> Загружаем данные…`;
  }
  try {
    const data = await api('/api/doctor/overview', { auth: 'doctor' });
    state.overview = data;
    state.patients = data.patients ?? [];
    state.alerts = data.alerts ?? [];
    state.feedback = data.feedback ?? [];
    renderAll();
    if (loading) loading.hidden = true;
    if (!silent) {
      const tab = currentTab();
      setTab(tab, { updateHash: false });
    }
  } catch (error) {
    if (error.status === 401) {
      clearDoctorSession();
      showLogin('Сессия истекла. Войдите в кабинет ещё раз.');
      return;
    }
    if (!silent) toast(error.message, 'error');
    showLoadError('Не удалось загрузить данные. Проверьте соединение и попробуйте ещё раз.');
  }
}

function initLogin() {
  if (!loginForm) return;
  const password = qs('[data-doctor-password]');
  const submit = loginForm.querySelector('button[type="submit"]');

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(loginForm);
    setFormStatus(loginStatus, '');
    const value = password.value;
    if (!value) {
      showFormErrors(loginForm, { password: 'Введите пароль.' });
      return;
    }

    setLoading(submit, true);
    try {
      const data = await api('/api/doctor/login', {
        method: 'POST',
        body: { password: value },
      });
      setDoctorSession({ token: data.token });
      showDashboard();
      password.value = '';
      await loadOverview();
    } catch (error) {
      if (error.fields) showFormErrors(loginForm, error.fields);
      else setFormStatus(loginStatus, error.message, 'error');
    } finally {
      setLoading(submit, false);
    }
  });
}

function initTabs() {
  qsa('[data-doctor-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.doctorTab));
  });
  const hash = window.location.hash.slice(1);
  if (['overview', 'patients', 'alerts', 'settings'].includes(hash)) setTab(hash, { updateHash: false });
}

function patientRecordHtml(survey, index) {
  const flags = [];
  if (Number(survey.painMax) >= 7) flags.push('Высокая боль');
  if (Number(survey.sleepQuality) <= 4) flags.push('Плохой сон');
  if (survey.medName !== 'none' && Number(survey.relief) <= 3) flags.push('Слабая помощь');
  return `
    <details class="record" ${index === 0 ? 'open' : ''}>
      <summary class="record__summary">
        <span class="record__date"><strong>${escapeHtml(formatDateRu(survey.date))}</strong>${escapeHtml(formatDateWithWeekday(survey.date).split(', ').at(-1) || '')}</span>
        <span class="record__mid">
          <span class="record__pain">${Number(survey.painAvg)}<small>/10</small></span>
          <span class="record__flags">${flags.map((flag) => `<span class="record__flag">${escapeHtml(flag)}</span>`).join('')}</span>
        </span>
        ${icon('chevron-down', 'icon record__chevron')}
      </summary>
      <div class="record__body">
        <div class="record__grid">
          <div class="record__item"><span>Максимальная боль</span><strong>${Number(survey.painMax)}/10</strong></div>
          <div class="record__item"><span>Сон</span><strong>${String(survey.sleepHours).replace('.', ',')} ч</strong></div>
          <div class="record__item"><span>Ночью</span><strong>${escapeHtml(labelOf(nightWake, survey.nightWake))}</strong></div>
          <div class="record__item"><span>Препарат</span><strong>${escapeHtml(labelOf(medOptions, survey.medName))}${survey.medDose ? ` · ${escapeHtml(survey.medDose)}` : ''}</strong></div>
          <div class="record__item"><span>Помощь препарата</span><strong>${survey.relief !== null ? `${Number(survey.relief)}/10` : '—'}</strong></div>
          <div class="record__item"><span>Побочные</span><strong>${escapeHtml(labelsOf(sideEffectOptions, survey.sideEffects).join(', ') || '—')}</strong></div>
          <div class="record__item"><span>Приверженность</span><strong>${escapeHtml(labelOf(adherenceOptions, survey.adherence))}</strong></div>
          <div class="record__item"><span>Настроение / активность</span><strong>${Number(survey.mood)} / ${Number(survey.activity)}</strong></div>
          <div class="record__item"><span>Онемение / слабость</span><strong>${escapeHtml(labelOf(symptomScale, survey.numbness))} / ${escapeHtml(labelOf(symptomScale, survey.weakness))}</strong></div>
          <div class="record__item"><span>Плечо / отёк</span><strong>${escapeHtml(labelOf(mobilityScale, survey.mobility))} / ${escapeHtml(labelOf(edemaScale, survey.edema))}</strong></div>
          <div class="record__item"><span>Области боли</span><strong>${escapeHtml(labelsOf(painLocations, survey.locations).join(', ') || '—')}</strong></div>
          <div class="record__item"><span>Характер боли</span><strong>${escapeHtml(labelsOf(painCharacters, survey.characters).join(', ') || '—')}</strong></div>
        </div>
        ${survey.note ? `<p class="record__note">${escapeHtml(survey.note)}</p>` : ''}
      </div>
    </details>
  `;
}

async function openPatient(id) {
  if (!patientDialog || !patientDialogBody) return;
  currentPatientId = id;
  patientDialogBody.innerHTML = `<div class="doctor-loading"><span class="spinner"></span> Загружаем карту…</div>`;
  if (!patientDialog.open) {
    patientDialog.showModal();
    document.body.classList.add('modal-open');
  }
  try {
    const data = await api(`/api/doctor/patients/${encodeURIComponent(id)}`, { auth: 'doctor' });
    const patient = data.patient;
    const stats = data.stats;
    const title = qs('#patient-dialog-title');
    if (title) title.textContent = 'Карта пациента';
    patientDialogBody.innerHTML = `
      <div class="patient-head">
        <span class="patient-head__avatar">${escapeHtml(initials(patient.name))}</span>
        <div>
          <h2>${escapeHtml(patient.name)}</h2>
          <p>${escapeHtml(patient.code)}${patient.phone ? ` · ${escapeHtml(patient.phone)}` : ''}</p>
        </div>
        <span class="patient-head__badge">${data.alerts.some((alert) => alert.status === 'new') ? '<span class="status-pill status-pill--attention">Есть новый сигнал</span>' : '<span class="status-pill status-pill--ok">Наблюдение</span>'}</span>
      </div>
      <div class="patient-stats">
        <div class="patient-stat"><span>Средняя за 7 дней</span><strong>${stats.avgPain7 ?? '—'}</strong></div>
        <div class="patient-stat"><span>Последняя боль</span><strong>${stats.lastPain !== null ? `${stats.lastPain}/10` : '—'}</strong></div>
        <div class="patient-stat"><span>Динамика</span><strong>${stats.delta === null ? '—' : `${stats.delta > 0 ? '+' : stats.delta < 0 ? '−' : ''}${Math.abs(stats.delta)}`}</strong></div>
        <div class="patient-stat"><span>Дней подряд</span><strong>${stats.streak}</strong></div>
      </div>
      <div class="patient-chart-box">
        <div class="chart-legend">
          <span><i class="legend-dot legend-dot--coral"></i> Средняя</span>
          <span><i class="legend-dot legend-dot--sage"></i> Максимальная</span>
        </div>
        <svg class="chart-svg" data-patient-chart role="img" aria-label="График боли пациента"></svg>
      </div>
      <p class="patient-section-title">Записи дневника</p>
      <div class="patient-records">
        ${data.surveys.length ? data.surveys.slice(0, 20).map(patientRecordHtml).join('') : '<div class="empty-state"><p>Пациент ещё не заполнял дневник.</p></div>'}
      </div>
      <div class="patient-actions">
        <button class="danger-button" type="button" data-delete-patient="${escapeHtml(patient.id)}">${icon('trash')} Удалить пациента</button>
        <button class="btn btn--ghost btn--sm" type="button" data-close-patient>Закрыть</button>
      </div>
    `;

    const chartSurveys = [...data.surveys].reverse().slice(-30);
    lineChart(
      qs('[data-patient-chart]'),
      chartSurveys.map((survey) => ({
        date: survey.date,
        avg: Number(survey.painAvg),
        max: Number(survey.painMax),
      })),
      { height: 190 },
    );

    patientDialogBody.querySelector('[data-close-patient]')?.addEventListener('click', closePatientDialog);
    patientDialogBody.querySelector('[data-delete-patient]')?.addEventListener('click', (event) => {
      deletePatient(event.currentTarget.dataset.deletePatient);
    });
  } catch (error) {
    if (error.status === 401) {
      closePatientDialog();
      clearDoctorSession();
      showLogin('Сессия истекла. Войдите ещё раз.');
      return;
    }
    closePatientDialog();
    toast(error.message, 'error');
  }
}

function closePatientDialog() {
  if (patientDialog?.open) patientDialog.close();
  document.body.classList.remove('modal-open');
  currentPatientId = null;
  if (patientDialogBody) patientDialogBody.innerHTML = '';
}

async function deletePatient(id) {
  const confirmed = await confirmDialog({
    title: 'Удалить пациента?',
    message: 'Все записи дневника, сигналы и код доступа будут удалены без возможности восстановления. Используйте это только по запросу пациента или для демо-данных.',
    confirmLabel: 'Удалить навсегда',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/doctor/patients/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      auth: 'doctor',
    });
    closePatientDialog();
    toast('Пациент и его записи удалены.', 'success');
    await loadOverview({ silent: true });
  } catch (error) {
    toast(error.message, 'error');
  }
}

function initDelegatedActions() {
  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open-patient]');
    if (open) {
      event.preventDefault();
      openPatient(open.dataset.openPatient);
      return;
    }

    const row = event.target.closest('.patient-row');
    if (row && !event.target.closest('button, a')) {
      openPatient(row.dataset.patientId);
      return;
    }

    const handle = event.target.closest('[data-handle-alert]');
    if (handle) {
      event.preventDefault();
      handleAlert(handle.dataset.handleAlert, handle);
    }
  });
}

async function handleAlert(id, button) {
  setLoading(button, true);
  try {
    await api(`/api/doctor/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      auth: 'doctor',
      body: { status: 'handled' },
    });
    toast('Сигнал отмечен обработанным.', 'success');
    await loadOverview({ silent: true });
  } catch (error) {
    if (error.status === 401) {
      clearDoctorSession();
      showLogin('Сессия истекла. Войдите ещё раз.');
      return;
    }
    toast(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

function initSettingsActions() {
  qs('[data-test-telegram]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const statusNode = qs('[data-telegram-status]');
    setLoading(button, true);
    try {
      const result = await api('/api/doctor/test-telegram', {
        method: 'POST',
        auth: 'doctor',
      });
      if (result.delivered) {
        toast('Тестовое сообщение отправлено. Проверьте Telegram.', 'success');
        if (statusNode) {
          statusNode.textContent = 'Настроен, тест доставлен';
          statusNode.classList.add('is-ok');
          statusNode.classList.remove('is-warn');
        }
      } else if (!result.configured) {
        toast('Telegram не настроен: добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.', 'error', 7000);
        if (statusNode) {
          statusNode.textContent = 'Не настроен';
          statusNode.classList.add('is-warn');
          statusNode.classList.remove('is-ok');
        }
      } else {
        toast(`Не удалось отправить: ${result.reason || 'ошибка Telegram'}.`, 'error', 7000);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  });

  qs('[data-demo-seed]')?.addEventListener('click', async (event) => {
    const confirmed = await confirmDialog({
      title: 'Загрузить демо-данные?',
      message: 'Будет создана демонстрационная пациентка с историей за три недели. Если она уже есть, старая демо-история заменится.',
      confirmLabel: 'Загрузить',
    });
    if (!confirmed) return;
    const button = event.currentTarget;
    setLoading(button, true);
    try {
      const result = await api('/api/doctor/demo-seed', { method: 'POST', auth: 'doctor' });
      state.demoCode = result.code;
      toast(`Демо-данные загружены: ${result.surveys} записей.`, 'success', 6000);
      await loadOverview({ silent: true });
      setTab('settings');
      renderSettings();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  });

  qs('[data-export-csv]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setLoading(button, true);
    try {
      await downloadFile('/api/doctor/export.csv', `opora-surveys-${new Date().toISOString().slice(0, 10)}.csv`, 'doctor');
      toast('CSV-файл скачан.', 'success');
    } catch (error) {
      if (error.status === 401) {
        clearDoctorSession();
        showLogin('Сессия истекла. Войдите ещё раз.');
      } else {
        toast(error.message, 'error');
      }
    } finally {
      setLoading(button, false);
    }
  });

  qs('[data-refresh]')?.addEventListener('click', () => loadOverview());
  qs('[data-doctor-logout]')?.addEventListener('click', () => {
    clearDoctorSession();
    state = { ...state, overview: null, patients: [], alerts: [], feedback: [] };
    showLogin();
    toast('Вы вышли из кабинета врача.', 'info');
  });

  qsa('[data-alert-filter] input').forEach((input) => {
    input.addEventListener('change', () => {
      state.alertFilter = input.value;
      renderAlertsPanel();
    });
  });

  qs('[data-patient-search]')?.addEventListener('input', renderPatientsTable);
}

function initDialog() {
  if (!patientDialog) return;
  patientDialog.querySelector('[data-close-dialog]')?.addEventListener('click', closePatientDialog);
  patientDialog.addEventListener('click', (event) => {
    if (event.target === patientDialog) closePatientDialog();
  });
  patientDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePatientDialog();
  });
  patientDialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
  });
}

function init() {
  if (initialized) return;
  initialized = true;
  initTabs();
  initLogin();
  initDelegatedActions();
  initSettingsActions();
  initDialog();

  if (getDoctorSession()?.token) {
    showDashboard();
    loadOverview();
  } else {
    showLogin();
  }
}

init();
