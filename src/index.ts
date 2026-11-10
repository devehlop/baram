import { initApp } from './app.js';
import { createBot } from './bot/bot.js';
import { clearConversations } from './bot/storage.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { t } from './i18n.js';
import { startJobs } from './jobs/runner.js';
import { setZone } from './lib/time.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setZone(config.tz);

  await runMigrations(config.databaseUrl);
  const { db, pool } = createDb(config.databaseUrl);
  const bot = createBot(config.botToken, config.apiRoot ? { apiRoot: config.apiRoot } : undefined);
  initApp({ db, api: bot.api, adminIds: config.adminIds });
  await seed({ channelId: config.channelId });
  await clearConversations();

  await bot.init();
  initApp({ db, api: bot.api, adminIds: config.adminIds, botUsername: bot.botInfo.username });
  await bot.api.setMyCommands([
    { command: 'start', description: t('cmd-start') },
    { command: 'help', description: t('cmd-help') },
  ]);
  if (config.adminIds.length === 0) log.warn('ADMIN_IDS пуст: проверять водителей некому. Узнать свой ID — команда /id.');

  const stopJobs = startJobs();
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Останавливаемся');
    stopJobs();
    await bot.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  log.info({ bot: bot.botInfo.username, tz: config.tz, admins: config.adminIds.length }, 'Бот запущен');
  // Long polling: не нужен домен и сертификат, для одного направления хватает с запасом.
  await bot.start({ allowed_updates: ['message', 'callback_query'] });
}

main().catch((err) => {
  log.fatal({ err }, 'Бот не запустился');
  process.exit(1);
});
