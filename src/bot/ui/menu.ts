import { Keyboard } from 'grammy';
import { isAdminTg } from '../../app.js';
import type { UserRow } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { getDriverRow } from '../../services/drivers.js';
import { send } from '../tg.js';

/** Подписи кнопок главного меню. Нажатие приходит боту обычным текстом. */
export const MENU_KEYS = [
  'menu-find',
  'menu-my-trips',
  'menu-help',
  'menu-become-driver',
  'menu-to-driver',
  'menu-post-trip',
  'menu-driver-trips',
  'menu-requests',
  'menu-driver-data',
  'menu-to-passenger',
  'menu-admin',
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

export function menuKeyOf(text: string | undefined): MenuKey | undefined {
  if (!text) return undefined;
  return MENU_KEYS.find((k) => t(k) === text);
}

export async function mainKeyboard(user: UserRow): Promise<Keyboard> {
  const k = new Keyboard();
  const driver = await getDriverRow(user.id);
  if (user.activeRole === 'driver' && driver) {
    k.text(t('menu-post-trip')).row();
    k.text(t('menu-driver-trips')).text(t('menu-requests')).row();
    k.text(t('menu-driver-data')).text(t('menu-help')).row();
    k.text(t('menu-to-passenger'));
  } else {
    k.text(t('menu-find')).row();
    k.text(t('menu-my-trips')).text(t('menu-help')).row();
    k.text(t(driver ? 'menu-to-driver' : 'menu-become-driver'));
  }
  if (isAdminTg(user.telegramId)) k.row().text(t('menu-admin'));
  return k.resized().persistent();
}

/** Показать главное меню (большие кнопки внизу экрана). */
export async function showMenu(user: UserRow, text?: string): Promise<void> {
  const title = text ?? t(user.activeRole === 'driver' ? 'menu-title-driver' : 'menu-title-passenger');
  await send(user.telegramId, title, await mainKeyboard(user));
}
