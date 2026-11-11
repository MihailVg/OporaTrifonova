import { config, isTelegramConfigured } from './config.js';
import { formatDateTimeRu } from './time.js';
import { site } from '../shared/site.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const footer = site.demo
  ? '<i>Опора · дневник боли · учебный демо-проект</i>'
  : '<i>Опора · дневник боли</i>';

export function alarmMessage({ patient, pain, comment, createdAt }) {
  const lines = [
    '🚨 <b>Тревожный сигнал</b>',
    '',
    `<b>Пациент:</b> ${escapeHtml(patient.name)}`,
    `<b>Код:</b> ${escapeHtml(patient.code)}`,
    `<b>Боль:</b> ${Number(pain)}/10`,
    `<b>Время:</b> ${escapeHtml(formatDateTimeRu(createdAt))}`,
  ];
  if (patient.phone) lines.push(`<b>Телефон:</b> ${escapeHtml(patient.phone)}`);
  if (comment) lines.push(`<b>Комментарий:</b> ${escapeHtml(comment)}`);
  lines.push('', footer);
  return lines.join('\n').slice(0, 3900);
}

export function feedbackMessage({ name, contact, message, createdAt }) {
  return [
    '✉️ <b>Сообщение с сайта</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Контакт:</b> ${escapeHtml(contact)}`,
    `<b>Время:</b> ${escapeHtml(formatDateTimeRu(createdAt))}`,
    '',
    escapeHtml(message),
    '',
    footer,
  ].join('\n').slice(0, 3900);
}

export function testMessage() {
  return [
    '✅ <b>Проверка связи</b>',
    '',
    `Уведомления «${site.name}» настроены.`,
    `Время: ${escapeHtml(formatDateTimeRu(new Date().toISOString()))}`,
    '',
    'Тревожные сигналы пациентов будут приходить в этот чат.',
    '',
    footer,
  ].join('\n');
}

async function sendToChat(chatId, text) {
  const url = `${config.telegramApiBase}/bot${config.telegramToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.ok !== true) {
      const reason = payload?.description || `HTTP ${response.status}`;
      console.error(`[telegram] Не удалось отправить в ${chatId}: ${reason}`);
      return { ok: false, error: reason };
    }
    return { ok: true, messageId: payload.result?.message_id ?? null };
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'таймаут Telegram API' : error.message;
    console.error(`[telegram] Ошибка отправки: ${reason}`);
    return { ok: false, error: reason };
  }
}

/**
 * Отправляет сообщение всем получателям из TELEGRAM_CHAT_ID.
 * Никогда не бросает исключение: сайт должен сохранить сигнал, даже если Telegram недоступен.
 */
export async function sendTelegram(text) {
  if (!isTelegramConfigured) {
    return { ok: false, reason: 'not_configured', sent: 0, failed: 0 };
  }

  const results = [];
  for (const chatId of config.telegramChatIds) {
    results.push(await sendToChat(chatId, text));
  }

  const sent = results.filter((result) => result.ok).length;
  const failed = results.length - sent;

  if (sent === 0) {
    return {
      ok: false,
      reason: 'send_failed',
      sent,
      failed,
      error: results[0]?.error ?? 'неизвестная ошибка',
    };
  }

  return { ok: true, sent, failed, partial: failed > 0 };
}

export async function sendTestTelegram() {
  if (!isTelegramConfigured) {
    return { ok: false, reason: 'not_configured' };
  }
  return sendTelegram(testMessage());
}

export function telegramStatusFromResult(result) {
  if (result.ok) return result.failed > 0 ? 'partial' : 'sent';
  return result.reason === 'not_configured' ? 'not_configured' : 'failed';
}
