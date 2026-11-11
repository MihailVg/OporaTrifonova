import { config, isTelegramConfigured } from './config.js';
import { closeDb, getDbKind, initDb } from './db.js';
import { createApp } from './app.js';

const dbKind = await initDb();
const app = createApp();

if (!config.databaseUrl && config.isProduction) {
  console.warn(
    '[db] DATABASE_URL не задан: используется локальный PGlite. На бесплатном хостинге данные могут не сохраниться после перезапуска.',
  );
}

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log(`  Опора · онлайн-поликлиника`);
  console.log(`  Локально:  http://localhost:${config.port}`);
  console.log(`  Хранилище: ${dbKind}`);
  console.log(`  Telegram:  ${isTelegramConfigured ? 'уведомления настроены' : 'не настроен (сигналы сохраняются в кабинете)'}`);
  console.log(`  Демо-режим: ${config.site.demo ? 'да' : 'нет'}`);
  console.log('');
});

server.on('error', (error) => {
  console.error('[server] Не удалось запустить сервер:', error.message);
  process.exitCode = 1;
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n[server] ${signal}: завершаем работу…`);
  const timer = setTimeout(() => {
    console.error('[server] Принудительное завершение по таймауту.');
    process.exit(1);
  }, 10_000);
  timer.unref();

  server.close(async () => {
    try {
      await closeDb();
    } catch (error) {
      console.error('[server] Ошибка при закрытии базы:', error.message);
    }
    clearTimeout(timer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  console.error('[server] Необработанное обещание:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[server] Необработанное исключение:', error);
  process.exitCode = 1;
});
