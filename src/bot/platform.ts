import { app } from '../app.js';
import { isMaxId } from '../max/ids.js';

/** Человек пишет боту из MAX, а не из Telegram. */
export const onMax = (chatId: number | undefined): boolean => isMaxId(chatId);

/**
 * Mini App включена (MINIAPP_URL) и открывается у этого человека. В MAX — только когда адрес
 * вписан в настройках бота на business.max.ru и включён MAX_MINIAPP: иначе кнопка открыла бы пустоту.
 */
export function appOn(chatId: number): boolean {
  if (!app.miniappUrl) return false;
  return onMax(chatId) ? !!app.maxMiniapp : true;
}

/** Ключ текста про приложение: в MAX вход в него не там, где в Telegram. */
export const appKey = <K extends string>(chatId: number, key: K): K | `${K}-max` => (onMax(chatId) ? `${key}-max` : key);
