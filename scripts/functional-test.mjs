import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const NAME = `Тест UI ${Date.now().toString().slice(-5)}`;
const errors = [];

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  console.log(`ok — ${message}`);
}

async function typeInto(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value, { delay: 8 });
}

async function setRange(page, name, value) {
  await page.$eval(
    `[name="${name}"]`,
    (element, next) => {
      element.value = String(next);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on('pageerror', (error) => errors.push(`PAGE: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('kaspersky')) {
    errors.push(`CONSOLE: ${message.text()}`);
  }
});

try {
  await page.goto(`${BASE}/login?mode=register`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#register-name');
  await typeInto(page, '#register-name', NAME);
  await typeInto(page, '#register-phone', '+7 900 111-22-33');
  await page.$eval('#panel-register [name="consent"]', (input) => {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#panel-register button[type="submit"]');

  await page.waitForSelector('dialog[open] .profile-data code', { timeout: 15000 });
  const code = await page.$eval('dialog[open] .profile-data code', (node) => node.textContent.trim());
  assert(/^OP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), `пациент зарегистрирован, код ${code}`);
  await page.click('dialog[open] [data-go-cabinet]');
  await page.waitForFunction(
    () => document.querySelector('[data-today-card]')?.getAttribute('aria-busy') === 'false',
    { timeout: 15000 },
  );
  await page.waitForFunction((name) => document.body.textContent.includes(name), { timeout: 15000 }, NAME);
  assert(true, 'личный кабинет открылся после регистрации');

  await page.goto(`${BASE}/survey`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => (document.querySelector('[data-survey-date]')?.textContent || '').length > 3,
    { timeout: 15000 },
  );
  await setRange(page, 'painAvg', 6);
  await setRange(page, 'painMax', 8);
  await page.evaluate(() => {
    document.querySelector('[name="locations"][value="chest_wall"]')?.closest('label')?.click();
    document.querySelector('[name="characters"][value="burning"]')?.closest('label')?.click();
  });
  await page.click('[data-next]');
  await page.waitForFunction(() => document.querySelector('[data-step="2"]')?.hidden === false);
  await page.$eval('[name="sleepHours"]', (input) => {
    input.value = '6.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-next]');
  await page.waitForFunction(() => document.querySelector('[data-step="3"]')?.hidden === false);
  await page.evaluate(() => {
    document.querySelector('[name="adherence"][value="full"]')?.closest('label')?.click();
  });
  await page.click('[data-submit]');
  await page.waitForSelector('[data-survey-success]:not([hidden])', { timeout: 15000 });
  assert(true, 'дневник сохранён через интерфейс');

  await page.click('[data-survey-success] [data-open-alarm]');
  await page.waitForSelector('dialog[open] .alarm-form', { timeout: 10000 });
  await setRange(page, 'pain', 9);
  await page.click('dialog[open] .alarm-form button[type="submit"]');
  await page.waitForSelector('dialog[open] .alarm-success', { timeout: 15000 });
  assert(true, 'тревожный сигнал отправлен');
  await page.click('dialog[open] .alarm-success [data-close]');

  const doctor = await browser.newPage();
  await doctor.setViewport({ width: 1440, height: 1000 });
  doctor.on('pageerror', (error) => errors.push(`DOCTOR PAGE: ${error.message}`));
  doctor.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('kaspersky')) {
      errors.push(`DOCTOR CONSOLE: ${message.text()}`);
    }
  });

  await doctor.goto(`${BASE}/doctor`, { waitUntil: 'networkidle2' });
  await doctor.waitForSelector('#doctor-password');
  await typeInto(doctor, '#doctor-password', 'opora-demo-2026');
  await doctor.click('[data-doctor-login-form] button[type="submit"]');
  await doctor.waitForFunction(
    () => document.querySelector('[data-dashboard-loading]')?.hidden === true,
    { timeout: 20000 },
  );
  await doctor.waitForFunction((name) => document.body.textContent.includes(name), { timeout: 15000 }, NAME);
  assert(true, 'врач вошёл и видит нового пациента');

  await doctor.click('.doctor-tab[data-doctor-tab="alerts"]');
  await doctor.waitForFunction(
    (name) => document.querySelector('[data-alerts-list]')?.textContent.includes(name),
    { timeout: 15000 },
    NAME,
  );
  await doctor.evaluate((name) => {
    const item = [...document.querySelectorAll('.alert-item')].find((alert) =>
      alert.textContent.includes(name),
    );
    item?.querySelector('[data-handle-alert]')?.click();
  }, NAME);
  await doctor.waitForFunction(
    (name) => {
      const item = [...document.querySelectorAll('.alert-item')].find((alert) =>
        alert.textContent.includes(name),
      );
      return item?.textContent.includes('Обработан');
    },
    { timeout: 15000 },
    NAME,
  );
  assert(true, 'сигнал отмечен обработанным');

  await doctor.click('.doctor-tab[data-doctor-tab="patients"]');
  await doctor.evaluate((name) => {
    const row = [...document.querySelectorAll('.patient-row')].find((item) =>
      item.textContent.includes(name),
    );
    row?.querySelector('td')?.click();
  }, NAME);
  await doctor.waitForSelector('dialog[open] .patient-head', { timeout: 15000 });
  const dialogName = await doctor.$eval('dialog[open] .patient-head h2', (node) => node.textContent);
  assert(dialogName.includes(NAME), 'карта пациента открывается');

  await doctor.click('dialog[open] [data-delete-patient]');
  await doctor.waitForSelector('dialog.modal[open] [data-confirm]', { timeout: 10000 });
  await doctor.click('dialog.modal[open] [data-confirm]');
  await doctor.waitForFunction(
    (name) =>
      ![...document.querySelectorAll('.patient-row')].some((row) =>
        row.textContent.includes(name),
      ),
    { timeout: 20000 },
    NAME,
  );
  assert(true, 'пациент удалён вместе с записями');

  await doctor.click('.doctor-tab[data-doctor-tab="settings"]');
  await doctor.click('[data-test-telegram]');
  await doctor.waitForFunction(
    () => [...document.querySelectorAll('.toast')].some((toast) => toast.textContent.includes('Telegram не настроен')),
    { timeout: 15000 },
  );
  assert(true, 'тест Telegram корректно сообщает об отсутствии настроек');

  await doctor.click('[data-demo-seed]');
  await doctor.waitForSelector('dialog.modal[open] [data-confirm]', { timeout: 10000 });
  await doctor.click('dialog.modal[open] [data-confirm]');
  await doctor.waitForSelector('[data-demo-code]:not([hidden])', { timeout: 20000 });
  const demoCode = await doctor.$eval('[data-demo-code]', (node) => node.textContent);
  assert(demoCode.includes('OP-DEMO-2026'), 'демо-данные загружаются из кабинета врача');

  await doctor.click('.doctor-tab[data-doctor-tab="patients"]');
  await doctor.waitForFunction(
    () =>
      [...document.querySelectorAll('.patient-row')].some((row) =>
        row.textContent.includes('Мария Демидова'),
      ),
    { timeout: 15000 },
  );
  const rowText = await doctor.evaluate(() => {
    const row = [...document.querySelectorAll('.patient-row')].find((item) =>
      item.textContent.includes('Мария Демидова'),
    );
    return row?.textContent || '';
  });
  assert(!rowText.includes('—'), 'у демо-пациентки видна последняя запись и динамика');
} catch (error) {
  console.error(error.stack || error.message);
  errors.push(`FAILED: ${error.message}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error('\nERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nALL FUNCTIONAL CHECKS PASSED');
}
