import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';

fs.mkdirSync(OUT, { recursive: true });

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`${path}: ${payload?.error?.message || response.status}`);
  }
  return payload.data;
}

const doctor = await json('/api/doctor/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'opora-demo-2026' }),
});
const seed = await json('/api/doctor/demo-seed', {
  method: 'POST',
  headers: { Authorization: `Bearer ${doctor.token}` },
});
const patientLogin = await json('/api/patients/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: seed.code }),
});
const patientSession = { token: patientLogin.token, patient: patientLogin.patient };
const doctorSession = { token: doctor.token };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const errors = [];

async function newPage(width, height, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (error) => errors.push(`PAGE: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText;
    if (failure && !failure.includes('ERR_ABORTED')) {
      errors.push(`REQUEST: ${request.url()} ${failure}`);
    }
  });
  return page;
}

async function setPatient(page) {
  await page.evaluate((session) => {
    localStorage.setItem('opora.patient.v1', JSON.stringify(session));
  }, patientSession);
}

async function setDoctor(page) {
  await page.evaluate((session) => {
    sessionStorage.setItem('opora.doctor.v1', JSON.stringify(session));
  }, doctorSession);
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`saved ${name}.png`);
}

// Desktop pages
{
  const page = await newPage(1440, 1000);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await shot(page, 'home-desktop');
  await shot(page, 'home-hero-desktop', false);
  for (const [selector, name] of [
    ['#about', 'home-about-desktop'],
    ['#diary', 'home-diary-desktop'],
    ['#alarm', 'home-alarm-desktop'],
    ['#doctor', 'home-doctor-desktop'],
    ['#feedback', 'home-feedback-desktop'],
  ]) {
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), selector);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await shot(page, name, false);
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.goto(`${BASE}/info`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot(page, 'info-desktop');

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(page, 'login-desktop');

  await setPatient(page);
  await page.goto(`${BASE}/cabinet`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('[data-today-card]')?.getAttribute('aria-busy') === 'false',
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 900));
  await shot(page, 'cabinet-desktop');
  await shot(page, 'cabinet-top-desktop', false);

  await page.goto(`${BASE}/survey`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => (document.querySelector('[data-survey-date]')?.textContent || '').length > 3,
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot(page, 'survey-desktop');
  await shot(page, 'survey-top-desktop', false);

  await setDoctor(page);
  await page.goto(`${BASE}/doctor`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('[data-dashboard-loading]')?.hidden === true,
    { timeout: 20000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  await shot(page, 'doctor-desktop');
  await shot(page, 'doctor-top-desktop', false);

  await page.evaluate(() => document.querySelector('.patient-row td')?.click());
  await page.waitForSelector('dialog[open] .patient-head', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot(page, 'doctor-patient-dialog', false);
  await page.click('dialog[open] [data-close-dialog]');

  await page.click('[data-doctor-tab="patients"]');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(page, 'doctor-patients-desktop');

  await page.click('[data-doctor-tab="settings"]');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(page, 'doctor-settings-desktop');
  await page.close();
}

// Mobile pages
{
  const page = await newPage(390, 844, true);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await shot(page, 'home-mobile');
  await shot(page, 'home-hero-mobile', false);

  await setPatient(page);
  await page.goto(`${BASE}/cabinet`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('[data-today-card]')?.getAttribute('aria-busy') === 'false',
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  await shot(page, 'cabinet-mobile');

  await page.goto(`${BASE}/survey`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => (document.querySelector('[data-survey-date]')?.textContent || '').length > 3,
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  await shot(page, 'survey-mobile');

  await setDoctor(page);
  await page.goto(`${BASE}/doctor`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('[data-dashboard-loading]')?.hidden === true,
    { timeout: 20000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shot(page, 'doctor-mobile');
  await page.close();
}

// Alarm modal
{
  const page = await newPage(1440, 1000);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await setPatient(page);
  await page.goto(`${BASE}/cabinet`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('[data-today-card]')?.getAttribute('aria-busy') === 'false',
    { timeout: 15000 },
  );
  await page.click('[data-open-alarm]');
  await new Promise((resolve) => setTimeout(resolve, 450));
  await shot(page, 'alarm-modal-desktop', false);
  await page.close();
}

await browser.close();
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].join('\n')}` : 'NO PAGE ERRORS');



