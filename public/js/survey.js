import { painLabels } from '/shared/options.js';
import { lineChart } from './charts.js';
import {
  api,
  clearFormErrors,
  debounce,
  escapeHtml,
  formatDateWithWeekday,
  formatTimeRu,
  getPatientSession,
  icon,
  qs,
  qsa,
  redirectToLogin,
  setFormStatus,
  setLoading,
  showFormErrors,
  toast,
} from './ui.js';

const session = getPatientSession();
const form = qs('[data-survey-form]');
const successPanel = qs('[data-survey-success]');
const banner = qs('[data-survey-existing]');
const progressBar = qs('[data-progress-bar]');
const stepLabel = qs('[data-step-label]');
const prevButton = qs('[data-prev]');
const nextButton = qs('[data-next]');
const submitButton = qs('[data-submit]');
const draftStatus = qs('[data-draft-status]');
const saveNote = qs('[data-save-note]');
const status = form?.querySelector('[data-form-status]');

const STEP_FIELDS = {
  1: ['painAvg', 'painMax', 'locations', 'characters', 'nightWake'],
  2: ['numbness', 'weakness', 'mobility', 'edema', 'sleepHours', 'sleepQuality', 'mood', 'activity'],
  3: ['medName', 'medDose', 'medTimes', 'relief', 'sideEffects', 'adherence', 'note'],
};

let currentStep = 1;
let todayDate = '';
let existingSurvey = null;
let draftKey = '';
let saved = false;
let lastDraftAt = '';

function fieldStep(name) {
  for (const [step, fields] of Object.entries(STEP_FIELDS)) {
    if (fields.includes(name)) return Number(step);
  }
  return 1;
}

function firstErrorStep(errors) {
  return Math.min(...Object.keys(errors).map(fieldStep));
}

function painDescriptor(value) {
  return painLabels[Number(value)] || '';
}

function setRange(name, value) {
  const input = form.querySelector(`[name="${name}"]`);
  if (!input) return;
  input.value = String(value ?? 0);
  const output = form.querySelector(`[data-range-value="${name}"]`);
  if (output) output.textContent = input.value;
  if (name === 'painAvg') {
    const descriptor = form.querySelector('[data-pain-descriptor]');
    if (descriptor) descriptor.textContent = painDescriptor(input.value);
    const max = form.querySelector('[name="painMax"]');
    if (max && Number(max.value) < Number(input.value)) setRange('painMax', input.value);
  }
}

function setRadio(name, value) {
  qsa(`[name="${name}"]`, form).forEach((input) => {
    input.checked = String(input.value) === String(value);
  });
}

function setCheckboxes(name, values = []) {
  const list = Array.isArray(values) ? values.map(String) : [];
  qsa(`[name="${name}"]`, form).forEach((input) => {
    input.checked = list.includes(input.value);
  });
}

function toggleMedFields() {
  const select = form.querySelector('[data-med-select]');
  const fields = form.querySelector('[data-med-fields]');
  if (!select || !fields) return;
  const show = select.value !== 'none';
  fields.hidden = !show;
}

function prefill(values) {
  if (!values) return;
  setRange('painAvg', values.painAvg ?? 0);
  setRange('painMax', values.painMax ?? 0);
  setCheckboxes('locations', values.locations);
  setCheckboxes('characters', values.characters);
  setRadio('nightWake', values.nightWake || 'none');
  for (const name of ['numbness', 'weakness', 'mobility', 'edema']) {
    setRadio(name, values[name] ?? 0);
  }
  const sleepHours = form.querySelector('[name="sleepHours"]');
  if (sleepHours) sleepHours.value = String(values.sleepHours ?? 7);
  setRange('sleepQuality', values.sleepQuality ?? 6);
  setRange('mood', values.mood ?? 6);
  setRange('activity', values.activity ?? 6);

  const medSelect = form.querySelector('[data-med-select]');
  if (medSelect) medSelect.value = values.medName || 'none';
  const dose = form.querySelector('[name="medDose"]');
  if (dose) dose.value = values.medDose || '';
  const times = form.querySelector('[name="medTimes"]');
  if (times) times.value = values.medTimes ?? 1;
  setRange('relief', values.relief ?? 5);
  if (values.medName && values.medName !== 'none') {
    setCheckboxes('sideEffects', values.sideEffects?.length ? values.sideEffects : ['none']);
  } else {
    setCheckboxes('sideEffects', ['none']);
  }
  if (values.adherence) setRadio('adherence', values.adherence);
  const note = form.querySelector('[name="note"]');
  if (note) note.value = values.note || '';
  toggleMedFields();
}

function getValues() {
  const fd = new FormData(form);
  const get = (name) => String(fd.get(name) ?? '');
  const num = (name) => Number(get(name));
  const locationValues = fd.getAll('locations').map(String);
  const characterValues = fd.getAll('characters').map(String);
  const medName = get('medName') || 'none';
  const tookMedicine = medName !== 'none';
  const sideEffects = tookMedicine ? fd.getAll('sideEffects').map(String) : [];

  return {
    painAvg: num('painAvg'),
    painMax: num('painMax'),
    locations: locationValues,
    characters: characterValues,
    nightWake: get('nightWake'),
    numbness: num('numbness'),
    weakness: num('weakness'),
    mobility: num('mobility'),
    edema: num('edema'),
    medName,
    medDose: tookMedicine ? get('medDose').trim() : '',
    medTimes: tookMedicine && get('medTimes') !== '' ? num('medTimes') : null,
    relief: tookMedicine && get('relief') !== '' ? num('relief') : null,
    sideEffects,
    adherence: get('adherence'),
    sleepHours: get('sleepHours') === '' ? 0 : num('sleepHours'),
    sleepQuality: num('sleepQuality'),
    mood: num('mood'),
    activity: num('activity'),
    note: get('note').trim(),
  };
}

function validateStep(step) {
  const values = getValues();
  const errors = {};

  if (step === 1) {
    if (!Number.isInteger(values.painAvg) || values.painAvg < 0 || values.painAvg > 10) {
      errors.painAvg = 'Оцените среднюю боль от 0 до 10.';
    }
    if (!Number.isInteger(values.painMax) || values.painMax < 0 || values.painMax > 10) {
      errors.painMax = 'Оцените максимальную боль от 0 до 10.';
    }
    if (Number.isFinite(values.painAvg) && Number.isFinite(values.painMax) && values.painMax < values.painAvg) {
      errors.painMax = 'Максимальная боль не может быть ниже средней.';
    }
    if ((values.painAvg > 0 || values.painMax > 0) && !values.locations.length) {
      errors.locations = 'Отметьте хотя бы одну область боли.';
    }
    if ((values.painAvg > 0 || values.painMax > 0) && !values.characters.length) {
      errors.characters = 'Отметьте хотя бы один характер боли.';
    }
    if (!values.nightWake) errors.nightWake = 'Укажите, просыпались ли вы ночью.';
  }

  if (step === 2) {
    for (const name of ['numbness', 'weakness', 'mobility', 'edema']) {
      if (!Number.isInteger(values[name]) || values[name] < 0 || values[name] > 3) {
        errors[name] = 'Выберите один из вариантов.';
      }
    }
    if (!Number.isFinite(values.sleepHours) || values.sleepHours < 0 || values.sleepHours > 14) {
      errors.sleepHours = 'Укажите сон от 0 до 14 часов.';
    }
    for (const name of ['sleepQuality', 'mood', 'activity']) {
      if (!Number.isInteger(values[name]) || values[name] < 0 || values[name] > 10) {
        errors[name] = 'Оцените от 0 до 10.';
      }
    }
  }

  if (step === 3) {
    if (!values.medName) errors.medName = 'Выберите препарат или «Не принимала».';
    if (values.medName !== 'none') {
      if (values.medTimes !== null && (!Number.isInteger(values.medTimes) || values.medTimes < 0 || values.medTimes > 20)) {
        errors.medTimes = 'Количество приёмов — от 0 до 20.';
      }
      if (!Number.isInteger(values.relief) || values.relief < 0 || values.relief > 10) {
        errors.relief = 'Оцените, насколько помогло, от 0 до 10.';
      }
      if (!values.sideEffects.length) {
        errors.sideEffects = 'Отметьте «Не было» или укажите эффекты.';
      }
    }
    if (!values.adherence) errors.adherence = 'Укажите, получалось ли принимать лечение.';
    if (values.note.length > 1000) errors.note = 'Слишком длинное примечание — до 1000 символов.';
  }

  return errors;
}

function updateStepUi() {
  qsa('.form-step', form).forEach((panel) => {
    const active = Number(panel.dataset.step) === currentStep;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  if (progressBar) progressBar.style.width = `${(currentStep / 3) * 100}%`;
  if (stepLabel) stepLabel.textContent = `Шаг ${currentStep} из 3`;
  if (prevButton) prevButton.hidden = currentStep === 1;
  if (nextButton) nextButton.hidden = currentStep === 3;
  if (submitButton) submitButton.hidden = currentStep !== 3;
}

function goToStep(step, { scroll = true } = {}) {
  currentStep = Math.min(3, Math.max(1, step));
  updateStepUi();
  if (scroll) {
    const header = qs('.survey-head');
    const top = (header?.getBoundingClientRect().top ?? 0) + window.scrollY - 20;
    window.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
}

function draftStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function saveDraft() {
  if (saved || !draftKey) return;
  const storage = draftStorage();
  if (!storage) return;
  try {
    storage.setItem(
      draftKey,
      JSON.stringify({ date: todayDate, savedAt: new Date().toISOString(), values: getValues() }),
    );
    lastDraftAt = formatTimeRu(new Date().toISOString());
    if (draftStatus) draftStatus.textContent = `Черновик сохранён в ${lastDraftAt}`;
    if (saveNote) saveNote.textContent = 'Черновик сохранён на этом устройстве. Можно вернуться позже.';
  } catch {
    /* переполнение хранилища */
  }
}

function readDraft() {
  const storage = draftStorage();
  if (!storage || !draftKey) return null;
  try {
    const raw = storage.getItem(draftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.date !== todayDate || !parsed.values) return null;
    return parsed;
  } catch {
    return null;
  }
}

function removeDraft() {
  const storage = draftStorage();
  if (!storage || !draftKey) return;
  try {
    storage.removeItem(draftKey);
  } catch {
    /* ignore */
  }
}

const scheduleDraft = debounce(saveDraft, 400);

function onRangeInput(event) {
  const input = event.target.closest('[data-range]');
  if (!input) return;
  const name = input.name;
  const output = form.querySelector(`[data-range-value="${name}"]`);
  if (output) output.textContent = input.value;
  if (name === 'painAvg') {
    const descriptor = form.querySelector('[data-pain-descriptor]');
    if (descriptor) descriptor.textContent = painDescriptor(input.value);
    const max = form.querySelector('[name="painMax"]');
    if (max && Number(max.value) < Number(input.value)) {
      max.value = input.value;
      const maxOutput = form.querySelector('[data-range-value="painMax"]');
      if (maxOutput) maxOutput.textContent = input.value;
    }
  }
}

function onSideEffectsChange(event) {
  if (event.target.name !== 'sideEffects') return;
  const boxes = qsa('[name="sideEffects"]', form);
  if (event.target.value === 'none' && event.target.checked) {
    boxes.forEach((box) => {
      if (box !== event.target) box.checked = false;
    });
  } else if (event.target.checked) {
    const none = boxes.find((box) => box.value === 'none');
    if (none) none.checked = false;
  }
}

function bindInputs() {
  form.addEventListener('input', (event) => {
    onRangeInput(event);
    scheduleDraft();
  });
  form.addEventListener('change', (event) => {
    onSideEffectsChange(event);
    if (event.target.matches('[data-med-select]')) toggleMedFields();
    scheduleDraft();
  });

  prevButton?.addEventListener('click', () => goToStep(currentStep - 1));
  nextButton?.addEventListener('click', () => {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length) {
      showFormErrors(form, errors);
      setFormStatus(status, 'Проверьте выделенные поля.', 'error');
      return;
    }
    clearFormErrors(form);
    setFormStatus(status, '');
    goToStep(currentStep + 1);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saved) return;
    const allErrors = {};
    for (const step of [1, 2, 3]) {
      Object.assign(allErrors, validateStep(step));
    }
    if (Object.keys(allErrors).length) {
      goToStep(firstErrorStep(allErrors));
      showFormErrors(form, allErrors);
      setFormStatus(status, 'Проверьте выделенные поля — так врач получит точные данные.', 'error');
      toast('В дневнике есть незаполненные или некорректные поля.', 'error');
      return;
    }

    clearFormErrors(form);
    setFormStatus(status, '');
    setLoading(submitButton, true);

    try {
      const result = await api('/api/patient/surveys', {
        method: 'POST',
        auth: 'patient',
        body: getValues(),
      });
      saved = true;
      removeDraft();
      form.hidden = true;
      if (banner) banner.hidden = true;
      if (successPanel) successPanel.hidden = false;
      qs('[data-success-title]')?.focus({ preventScroll: true });
      const message = qs('[data-success-message]');
      if (message) {
        message.textContent = result.updated
          ? 'Запись за сегодня обновлена. Врач увидит актуальные данные.'
          : 'Спасибо! Запись за сегодня сохранена. Врач увидит её в кабинете.';
      }
      const successChart = qs('[data-success-chart]');
      try {
        const history = await api('/api/patient/surveys', { auth: 'patient' });
        const points = [...history.surveys]
          .reverse()
          .slice(-14)
          .map((survey) => ({
            date: survey.date,
            avg: Number(survey.painAvg),
            max: Number(survey.painMax),
          }));
        lineChart(successChart, points, { height: 170 });
      } catch {
        /* график не критичен */
      }
      window.scrollTo({
        top: (qs('.survey-head')?.getBoundingClientRect().top ?? 0) + window.scrollY - 20,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
      toast(result.updated ? 'Запись обновлена.' : 'Дневник сохранён.', 'success');
    } catch (error) {
      if (error.status === 401) {
        redirectToLogin();
        return;
      }
      if (error.fields) {
        goToStep(firstErrorStep(error.fields));
        showFormErrors(form, error.fields);
        setFormStatus(status, 'Проверьте выделенные поля.', 'error');
      } else {
        setFormStatus(status, error.message, 'error');
        toast(error.message, 'error');
      }
    } finally {
      setLoading(submitButton, false);
    }
  });
}

async function init() {
  if (!session?.token) {
    redirectToLogin();
    return;
  }

  bindInputs();
  updateStepUi();

  const fallbackDate = new Date().toISOString().slice(0, 10);
  todayDate = fallbackDate;
  qs('[data-survey-date]').textContent = formatDateWithWeekday(todayDate);

  try {
    const cabinet = await api('/api/patient/me', { auth: 'patient' });
    todayDate = cabinet.todayDate || fallbackDate;
    existingSurvey = cabinet.today;
    draftKey = `opora.survey.${cabinet.patient.code}.${todayDate}`;
    qs('[data-survey-date]').textContent = formatDateWithWeekday(todayDate);

    if (existingSurvey) {
      prefill(existingSurvey);
      if (banner) banner.hidden = false;
      if (submitButton) {
        submitButton.innerHTML = `Обновить дневник ${icon('check')}`;
      }
      if (draftStatus) draftStatus.textContent = 'Запись за сегодня уже есть';
    } else {
      const draft = readDraft();
      if (draft) {
        prefill(draft.values);
        if (draftStatus) draftStatus.textContent = `Восстановлен черновик от ${formatTimeRu(draft.savedAt)}`;
        toast('Черновик заполнения восстановлен.', 'info');
      }
    }
  } catch (error) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    toast('Не удалось загрузить сегодняшнюю запись. Можно заполнить дневник заново.', 'error');
  }

  // Применяем значения к полям и проверяем, что ползунки показывают корректные числа.
  for (const name of ['painAvg', 'painMax', 'relief', 'sleepQuality', 'mood', 'activity']) {
    const input = form.querySelector(`[name="${name}"]`);
    if (input) {
      const output = form.querySelector(`[data-range-value="${name}"]`);
      if (output) output.textContent = input.value;
    }
  }
  toggleMedFields();
}

init();
