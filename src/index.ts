import { existsSync } from 'node:fs';
import { startApi } from './api/server.js';
import { app, initApp } from './app.js';
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
import { MaxClient } from './max/client.js';
import { MaxReceiver } from './max/receiver.js';

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
  const max = config.max ? new MaxClient({ token: config.max.token, apiRoot: config.max.apiRoot }) : undefined;
  initApp({ db, api: bot.api, adminIds: config.adminIds, botUsername: bot.botInfo.username, miniappUrl: config.miniappUrl, max });
  const commands = [
    { command: 'start', description: t('cmd-start') },
    { command: 'find', description: t('cmd-find') },
    { command: 'board', description: t('cmd-board') },
    { command: 'trips', description: t('cmd-trips') },
    { command: 'help', description: t('cmd-help') },
    { command: 'privacy', description: t('cmd-privacy') },
  ];
  await bot.api.setMyCommands(commands);
  if (config.adminIds.length === 0) log.warn('ADMIN_IDS пуст: проверять водителей некому. Узнать свой ID — команда /id.');

  // Mini App: тот же процесс отдаёт интерфейс и API. Включается адресом MINIAPP_URL.
  // Тот же сервер принимает вебхук MAX (MAX_WEBHOOK_URL).
  const maxReceiver = max ? new MaxReceiver(bot, max) : undefined;
  const webhookUrl = config.max?.webhookUrl;
  let stopApi: (() => void) | undefined;
  if (config.miniappUrl || config.miniappDevTelegramId || webhookUrl) {
    const staticDir = existsSync('miniapp/dist/index.html') ? 'miniapp/dist' : undefined;
    if (!staticDir && config.miniappUrl) log.warn('Mini App не собран: выполните npm run miniapp:build');
    stopApi = startApi({
      botToken: config.botToken,
      port: config.port,
      staticDir,
      devTelegramId: config.miniappDevTelegramId,
      maxWebhook: maxReceiver && webhookUrl ? { secret: maxReceiver.secret, push: (u) => maxReceiver.push(u) } : undefined,
    });
  }
  if (max && maxReceiver) void connectMax(max, maxReceiver, webhookUrl);
  if (config.miniappUrl) {
    // Кнопка слева от поля ввода в чате с ботом открывает Mini App.
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: t('miniapp-button'), web_app: { url: config.miniappUrl } } });
  } else {
    await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
  }

  const stopJobs = startJobs();
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Останавливаемся');
    stopJobs();
    stopApi?.();
    maxReceiver?.stop();
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

/**
 * Бот в MAX. Сбой MAX не должен останавливать бота в Telegram, поэтому подключение идёт
 * в фоне и при ошибке повторяется раз в минуту.
 */
async function connectMax(
  max: MaxClient,
  receiver: MaxReceiver,
  webhookUrl: string | undefined,
): Promise<void> {
  // Список команд в MAX через API не записывается (PATCH /me отвечает method.not.found).
  // Команды при этом работают, если их написать.
  for (;;) {
    try {
      const me = await max.call<{ username?: string | null; user_id: string }>('GET', '/me');
      initApp({ ...app, maxBotUsername: me.username ?? undefined });
      log.info({ bot: me.username }, 'MAX: бот подключён');
      if (webhookUrl) await receiver.subscribe(webhookUrl);
      else void receiver.poll();
      return;
    } catch (err) {
      log.error({ err }, 'MAX: не удалось подключиться, повтор через минуту');
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

main().catch((err) => {
  log.fatal({ err }, 'Бот не запустился');
  process.exit(1);
});
