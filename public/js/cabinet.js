import {
  adherenceOptions,
  edemaScale,
  labelOf,
  labelsOf,
  medOptions,
  mobilityScale,
  nightWake,
  painCharacters,
  painLabels,
  painLocations,
  sideEffectOptions,
  symptomScale,
} from '/shared/options.js';
import { lineChart } from './charts.js';
import {
  api,
  clearPatientSession,
  confirmDialog,
  copyText,
  escapeHtml,
  formatDateRu,
  formatDateWithWeekday,
  formatDateTimeRu,
  formatTimeRu,
  firstName,
  getPatientSession,
  icon,
  initials,
  plural,
  qs,
  redirectToLogin,
  setPatientSession,
  toast,
} from './ui.js';

const session = getPatientSession();
let historyLimit = 14;
let data = null;

function painText(value) {
  return painLabels[Number(value)] || '—';
}

function formatSleep(hours) {
  return `${String(hours).replace('.', ',')} ч`;
}

function formatMed(survey) {
  if (!survey.medName || survey.medName === 'none') return 'Не принимала';
  const name = labelOf(medOptions, survey.medName);
  return survey.medDose ? `${name} · ${survey.medDose}` : name;
}

function recordHtml(survey, index) {
  const weekday = formatDateWithWeekday(survey.date).split(', ').at(-1) || '';
  const flags = [];
  if (Number(survey.painMax) >= 7) flags.push('Высокая боль');
  if (Number(survey.sleepQuality) <= 4) flags.push('Плохой сон');
  if (survey.medName !== 'none' && Number(survey.relief) <= 3) flags.push('Слабая помощь');

  return `
    <details class="record" ${index === 0 ? 'open' : ''}>
      <summary class="record__summary">
        <span class="record__date"><strong>${escapeHtml(formatDateRu(survey.date))}</strong>${escapeHtml(weekday)}</span>
        <span class="record__mid">
          <span class="record__pain">${Number(survey.painAvg)}<small>/10</small></span>
          <span class="record__flags">${flags.map((flag) => `<span class="record__flag">${escapeHtml(flag)}</span>`).join('')}</span>
        </span>
        <svg class="icon record__chevron" aria-hidden="true"><use href="#i-chevron-down"></use></svg>
      </summary>
      <div class="record__body">
        <div class="record__grid">
          <div class="record__item"><span>Максимальная боль</span><strong>${Number(survey.painMax)}/10</strong></div>
          <div class="record__item"><span>Сон</span><strong>${escapeHtml(formatSleep(survey.sleepHours))}</strong></div>
          <div class="record__item"><span>Ночью</span><strong>${escapeHtml(labelOf(nightWake, survey.nightWake))}</strong></div>
          <div class="record__item"><span>Препарат</span><strong>${escapeHtml(formatMed(survey))}</strong></div>
          <div class="record__item"><span>Помощь препарата</span><strong>${survey.relief !== null ? `${Number(survey.relief)}/10` : '—'}</strong></div>
          <div class="record__item"><span>Побочные эффекты</span><strong>${escapeHtml(labelsOf(sideEffectOptions, survey.sideEffects).join(', ') || '—')}</strong></div>
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

function renderTodayCard(today) {
  const card = qs('[data-today-card]');
  if (!card) return;
  card.setAttribute('aria-busy', 'false');

  if (!today) {
    card.innerHTML = `
      <div class="today-card__top">
        <div>
          <p class="today-card__eyebrow">${escapeHtml(formatDateWithWeekday(data.todayDate))}</p>
          <h2 class="today-card__title">Как вы себя чувствуете сегодня?</h2>
        </div>
        <span class="today-card__status">${icon('clock')} Не заполнено</span>
      </div>
      <p class="today-card__meta">Пять минут утром — и врачу будет видна динамика за неделю. Заполняйте до обезболивающего, так точнее.</p>
      <div class="today-card__actions">
        <a class="btn btn--primary" href="/survey">Заполнить дневник ${icon('arrow-right')}</a>
        <button class="btn btn--ghost" type="button" data-open-alarm>${icon('bell')} Сильная боль</button>
      </div>
    `;
    return;
  }

  card.innerHTML = `
    <div class="today-card__top">
      <div>
        <p class="today-card__eyebrow">${escapeHtml(formatDateWithWeekday(today.date))}</p>
        <h2 class="today-card__title">Дневник на сегодня заполнен</h2>
      </div>
      <span class="today-card__status today-card__status--done">${icon('check-circle')} Заполнено</span>
    </div>
    <div class="today-card__pain">
      <strong>${Number(today.painAvg)}</strong><span>/10</span>
      <span class="pill">${escapeHtml(painText(today.painAvg))}</span>
    </div>
    <p class="today-card__meta">Обновлено в ${escapeHtml(formatTimeRu(today.updatedAt))} · спасибо, что отмечаете</p>
    <div class="today-card__metrics">
      <div class="today-card__metric"><span>Максимальная</span><strong>${Number(today.painMax)}/10</strong></div>
      <div class="today-card__metric"><span>Сон</span><strong>${escapeHtml(formatSleep(today.sleepHours))}</strong></div>
      <div class="today-card__metric"><span>Препарат</span><strong>${escapeHtml(formatMed(today))}</strong></div>
    </div>
    <div class="today-card__actions">
      <a class="btn btn--primary" href="/survey">Изменить запись ${icon('arrow-right')}</a>
      <button class="btn btn--ghost" type="button" data-open-alarm>${icon('bell')} Сильная боль</button>
    </div>
  `;
}

function renderChart(surveys) {
  const svg = qs('[data-chart]');
  const empty = qs('[data-chart-empty]');
  const points = [...surveys]
    .reverse()
    .slice(-14)
    .map((survey) => ({
      date: survey.date,
      avg: Number(survey.painAvg),
      max: Number(survey.painMax),
    }));

  const hasChart = lineChart(svg, points, { height: 220 });
  if (svg) svg.hidden = !hasChart;
  if (empty) empty.hidden = hasChart;

  const avg = data?.stats?.avgPain7;
  qs('[data-chart-avg]').textContent = avg !== null && avg !== undefined ? `${avg} / 10` : '—';
  qs('[data-chart-count]').textContent = String(data?.stats?.total ?? surveys.length);

  const deltaNode = qs('[data-chart-delta]');
  if (points.length > 1) {
    const delta = Number((points.at(-1).avg - points[0].avg).toFixed(1));
    deltaNode.textContent = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`;
    deltaNode.classList.toggle('is-good', delta < 0);
    deltaNode.classList.toggle('is-bad', delta > 0);
  } else {
    deltaNode.textContent = '—';
    deltaNode.classList.remove('is-good', 'is-bad');
  }
}

function renderHistory(surveys) {
  const container = qs('[data-history]');
  if (!container) return;
  const countNode = qs('[data-history-count]');
  if (countNode) {
    countNode.textContent = `${surveys.length} ${plural(surveys.length, 'запись', 'записи', 'записей')}`;
  }

  if (!surveys.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">${icon('calendar')}</span>
        <h3>Пока нет записей</h3>
        <p>Заполните первый дневник — здесь появится история, а врач увидит динамику.</p>
        <a class="btn btn--primary btn--sm" href="/survey">Заполнить дневник</a>
      </div>
    `;
    return;
  }

  const visible = surveys.slice(0, historyLimit);
  container.innerHTML = visible.map(recordHtml).join('');

  if (surveys.length > historyLimit) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn--ghost btn--sm history-more';
    more.textContent = `Показать ещё ${Math.min(14, surveys.length - historyLimit)}`;
    more.addEventListener('click', () => {
      historyLimit += 14;
      renderHistory(surveys);
    });
    container.append(more);
  }
}

function renderAlert(alert) {
  const node = qs('[data-last-alert]');
  if (!node) return;
  node.textContent = alert
    ? `Последний сигнал: ${formatDateTimeRu(alert.createdAt)} · ${alert.status === 'new' ? 'новый' : 'обработан'}`
    : 'Сигналов пока не было.';
}

function renderProfile(patient) {
  qs('[data-patient-name]').textContent = patient.name;
  qs('[data-patient-phone]').textContent = patient.phone || 'Телефон не указан';
  qs('[data-patient-code]').textContent = patient.code;
  qs('[data-patient-diagnosis]').textContent = patient.diagnosis;
  qs('[data-patient-diagnosis-full]').textContent = patient.diagnosis;
  qs('[data-patient-since]').textContent = formatDateRu(patient.createdAt.slice(0, 10));
  qs('[data-initials]').textContent = initials(patient.name);
}

function render(dataFromApi) {
  data = dataFromApi;
  const patient = data.patient;

  qs('[data-first-name]').textContent = firstName(patient.name);
  qs('[data-today-label]').textContent = formatDateWithWeekday(data.todayDate);
  qs('[data-survey-cta]').textContent = data.today ? 'Изменить запись' : 'Заполнить дневник';

  const streak = data.stats?.streak ?? 0;
  const streakNode = qs('[data-streak]');
  if (streakNode) {
    streakNode.hidden = streak < 2;
    qs('[data-streak-text]').textContent = `${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд`;
  }

  renderTodayCard(data.today);
  renderChart(data.surveys);
  renderHistory(data.surveys);
  renderAlert(data.alerts?.[0]);
  renderProfile(patient);
}

function renderError() {
  const card = qs('[data-today-card]');
  if (card) {
    card.setAttribute('aria-busy', 'false');
    card.innerHTML = `
      <div class="today-card__top">
        <div>
          <p class="today-card__eyebrow">Не удалось загрузить</p>
          <h2 class="today-card__title">Дневник временно недоступен</h2>
        </div>
        <span class="today-card__status">${icon('alert')} Ошибка</span>
      </div>
      <p class="today-card__meta">Проверьте соединение и попробуйте ещё раз. Если не получается — напишите врачу.</p>
      <div class="today-card__actions">
        <button class="btn btn--primary" type="button" data-retry>Повторить ${icon('refresh')}</button>
        <a class="btn btn--ghost" href="/#feedback">Написать врачу</a>
      </div>
    `;
    card.querySelector('[data-retry]')?.addEventListener('click', () => loadData());
  }
  qs('[data-chart-empty]')?.removeAttribute('hidden');
  const svg = qs('[data-chart]');
  if (svg) svg.hidden = true;
  const history = qs('[data-history]');
  if (history) {
    history.innerHTML = '<div class="empty-state"><p>История загрузится, когда связь восстановится.</p></div>';
  }
}

async function loadData() {
  const card = qs('[data-today-card]');
  card?.setAttribute('aria-busy', 'true');
  try {
    const fresh = await api('/api/patient/me', { auth: 'patient' });
    setPatientSession({ ...session, patient: fresh.patient });
    render(fresh);
  } catch (error) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    toast(error.message, 'error');
    renderError();
  }
}

function initActions() {
  qs('[data-logout]')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Выйти из дневника?',
      message: 'Чтобы вернуться, понадобится код доступа. Он останется в вашем кабинете на этом устройстве до выхода.',
      confirmLabel: 'Выйти',
    });
    if (!confirmed) return;
    clearPatientSession();
    window.location.assign('/');
  });

  qs('[data-copy-code]')?.addEventListener('click', async () => {
    const code = qs('[data-patient-code]')?.textContent || '';
    if (!code || code === '—') return;
    const copied = await copyText(code);
    toast(
      copied ? 'Код доступа скопирован.' : `Не удалось скопировать. Код: ${code}`,
      copied ? 'success' : 'error',
    );
  });

  document.addEventListener('opora:alert-sent', () => {
    loadData();
  });
}

if (!session?.token) {
  redirectToLogin();
} else {
  initActions();
  loadData();
}
