import { app } from '../app.js';
import { isMaxId } from '../max/ids.js';

/** Человек пишет боту из MAX, а не из Telegram. */
export const onMax = (chatId: number | undefined): boolean => isMaxId(chatId);

/** Mini App включена (MINIAPP_URL) и открывается у этого человека: в MAX её пока нет. */
export function appOn(chatId: number): boolean {
  return !!app.miniappUrl && !onMax(chatId);
}
