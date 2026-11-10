import type { Api } from 'grammy';
import type { Db } from './db/client.js';

/**
 * Общие зависимости приложения: база, Telegram API, список админов.
 * Заполняется один раз при запуске (и в тестах — тестовыми заменами).
 */
export interface App {
  db: Db;
  api: Api;
  adminIds: number[];
  /** Имя бота без @ — для ссылки в постах канала. */
  botUsername?: string;
}

export const app = {} as App;

export function initApp(deps: App): void {
  Object.assign(app, deps);
}

export function isAdminTg(telegramId: number | undefined): boolean {
  return telegramId !== undefined && app.adminIds.includes(telegramId);
}
