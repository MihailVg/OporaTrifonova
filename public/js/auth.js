import {
  api,
  clearFormErrors,
  escapeHtml,
  getPatientSession,
  icon,
  openModal,
  qs,
  qsa,
  safeNextPath,
  setFormStatus,
  setLoading,
  setPatientSession,
  showFormErrors,
  toast,
} from './ui.js';

const tabs = qsa('[data-auth-tab]');
const panels = qsa('[data-auth-panel]');

function activateTab(name, focusTab = false) {
  tabs.forEach((tab) => {
    const active = tab.dataset.authTab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) tab.focus();
  });
  panels.forEach((panel) => {
    const active = panel.dataset.authPanel === name;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  try {
    const url = new URL(window.location.href);
    if (name === 'register') url.searchParams.set('mode', 'register');
    else url.searchParams.delete('mode');
    window.history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }
}

function initTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.authTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.findIndex((item) => item.dataset.authTab === tab.dataset.authTab);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(current + direction + tabs.length) % tabs.length];
      activateTab(next.dataset.authTab, true);
    });
  });
  qsa('[data-auth-switch]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.authSwitch, true));
  });

  const mode = new URLSearchParams(window.location.search).get('mode');
  activateTab(mode === 'register' ? 'register' : 'login');
}

function initLogin() {
  const form = qs('[data-login-form]');
  if (!form) return;
  const codeInput = form.querySelector('[name="code"]');
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-form-status]');

  codeInput.addEventListener('input', () => {
    const position = codeInput.selectionStart;
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9\-–—\s]/g, '');
    codeInput.setSelectionRange(position, position);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    setFormStatus(status, '');
    const code = codeInput.value.trim();
    if (!code) {
      showFormErrors(form, { code: 'Введите код доступа из личного кабинета.' });
      return;
    }

    setLoading(submit, true);
    try {
      const data = await api('/api/patients/login', {
        method: 'POST',
        body: { code },
      });
      setPatientSession({ token: data.token, patient: data.patient });
      toast('Вы вошли в дневник.', 'success', 2500);
      window.location.assign(safeNextPath('/cabinet'));
    } catch (error) {
      if (error.fields) {
        showFormErrors(form, error.fields);
      } else if (error.code === 'code_not_found') {
        showFormErrors(form, { code: error.message });
      } else {
        setFormStatus(status, error.message, 'error');
      }
    } finally {
      setLoading(submit, false);
    }
  });
}

function showCodeModal(patient) {
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="alarm-form__intro">Дневник создан. Код доступа — ваш ключ к записям. Сохраните его: по нему можно войти на другом устройстве.</p>
    <div class="profile-data" style="margin-bottom:18px">
      <div>
        <dt>Код доступа</dt>
        <dd>
          <code style="font-size:15px">${escapeHtml(patient.code)}</code>
          <button class="icon-button" type="button" data-copy-new-code aria-label="Скопировать код">${icon('copy')}</button>
        </dd>
      </div>
    </div>
    <p class="alarm-form__intro">Код также всегда доступен в разделе «Личный кабинет».</p>
    <div class="alarm-form__actions">
      <button class="btn btn--ghost" type="button" data-copy-new-code>${icon('copy')} Скопировать</button>
      <button class="btn btn--primary" type="button" data-go-cabinet>Перейти в кабинет ${icon('arrow-right')}</button>
    </div>
    <div class="form-status" data-code-status role="status"></div>
  `;

  const modal = openModal({
    title: 'Дневник создан',
    eyebrow: 'Готово',
    body,
    onClose: () => window.location.assign('/cabinet'),
  });

  const codeStatus = body.querySelector('[data-code-status]');
  body.querySelectorAll('[data-copy-new-code]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(patient.code);
        setFormStatus(codeStatus, 'Код скопирован.', 'success');
      } catch {
        setFormStatus(codeStatus, `Не удалось скопировать. Запишите код: ${patient.code}`, 'error');
      }
    });
  });
  body.querySelector('[data-go-cabinet]').addEventListener('click', () => {
    modal.close();
    window.location.assign('/cabinet');
  });
}

function initRegister() {
  const form = qs('[data-register-form]');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-form-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    setFormStatus(status, '');
    const name = form.querySelector('[name="name"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const consent = form.querySelector('[name="consent"]').checked;
    const clientErrors = {};

    if (name.length < 2) clientErrors.name = 'Укажите имя и фамилию — минимум 2 символа.';
    if (!consent) clientErrors.consent = 'Без согласия на обработку данных нельзя создать дневник.';
    if (Object.keys(clientErrors).length) {
      showFormErrors(form, clientErrors);
      return;
    }

    setLoading(submit, true);
    try {
      const data = await api('/api/patients', {
        method: 'POST',
        body: { name, phone, consent },
      });
      setPatientSession({ token: data.token, patient: data.patient });
      showCodeModal(data.patient);
    } catch (error) {
      if (error.fields) {
        showFormErrors(form, error.fields);
      } else {
        setFormStatus(status, error.message, 'error');
      }
    } finally {
      setLoading(submit, false);
    }
  });
}

if (getPatientSession()?.token) {
  window.location.replace(safeNextPath('/cabinet'));
} else {
  initTabs();
  initLogin();
  initRegister();
}
