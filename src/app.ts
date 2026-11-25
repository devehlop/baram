import type { Api } from 'grammy';
import type { Db } from './db/client.js';
import type { MaxClient } from './max/client.js';

/**
 * Общие зависимости приложения: база, Telegram API, MAX, список админов.
 * Заполняется один раз при запуске (и в тестах — тестовыми заменами).
 */
export interface App {
  db: Db;
  api: Api;
  adminIds: number[];
  /** Имя бота без @ — для ссылки в постах канала. */
  botUsername?: string;
  /** Адрес Mini App, если она включена: кнопки «Открыть в приложении». */
  miniappUrl?: string;
  /** Клиент MAX, если бот подключён и там (MAX_BOT_TOKEN). */
  max?: MaxClient;
  /** Имя бота в MAX — для ссылок max.ru/<имя>?start=… */
  maxBotUsername?: string;
}

export const app = {} as App;

export function initApp(deps: App): void {
  Object.assign(app, deps);
}

export function isAdminTg(telegramId: number | undefined): boolean {
  return telegramId !== undefined && app.adminIds.includes(telegramId);
}
