import { isTelegramConfigured } from './config.js';
import { sendTestTelegram } from './notify.js';

if (!isTelegramConfigured) {
  console.error('');
  console.error('  Telegram не настроен.');
  console.error('  Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env и повторите.');
  console.error('');
  process.exitCode = 1;
} else {
  const result = await sendTestTelegram();
  if (result.ok) {
    console.log('Тестовое сообщение отправлено. Проверьте Telegram.');
  } else {
    console.error(`Не удалось отправить сообщение: ${result.reason || result.error || 'неизвестная ошибка'}`);
    process.exitCode = 1;
  }
}
