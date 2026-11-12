import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { answerCb, send } from '../tg.js';
import { menuKeyOf, showMenu, type MenuKey } from '../ui/menu.js';
import { admin, adminMenu } from './admin.js';
import { becomeDriver, driver, driverData, driverTrips, postTripMenu, toDriverMenu, toPassengerMenu } from './driver.js';
import { findTrip, help, myTrips, passenger } from './passenger.js';
import { requests, requestsList } from './requests.js';
import { parseTripPayload } from '../ui/share.js';
import { rememberTripLink, sendTripLink } from './tripLink.js';

export const handlers = new Composer<MyContext>();

handlers.command('id', async (ctx) => {
  await send(ctx.chat.id, t('your-id', { id: String(ctx.from?.id ?? '') }));
});

handlers.command('admin', adminMenu);

// Всё остальное доступно только после регистрации. Исключение — кнопки админа:
// админ задаётся по Telegram ID и может работать с уведомлениями, даже не пройдя анкету пассажира.
handlers.use(async (ctx, next) => {
  if (ctx.user) return next();
  if (ctx.isAdmin && ctx.callbackQuery?.data?.startsWith('a:')) return next();
  // Пришёл по ссылке на рейс из чата, но ещё не зарегистрирован: запомним рейс, покажем после регистрации.
  const linked = parseTripPayload(/^\/start(?:@\w+)?\s+(\S+)/.exec(ctx.message?.text ?? '')?.[1]);
  if (linked && ctx.from) rememberTripLink(ctx.from.id, linked);
  if (ctx.callbackQuery) await answerCb(ctx.callbackQuery.id);
  await enter(ctx, 'registration');
});

handlers.command(['start', 'menu', 'cancel'], async (ctx) => {
  const tripId = ctx.message?.text?.startsWith('/start') ? parseTripPayload(ctx.match) : null;
  if (tripId) return sendTripLink(ctx.chat.id, ctx.user!, tripId);
  await showMenu(ctx.user!);
});
handlers.command('help', help);

/** Большие кнопки главного меню приходят обычным текстом. */
const MENU: Record<MenuKey, (ctx: MyContext) => Promise<void>> = {
  'menu-find': findTrip,
  'menu-my-trips': myTrips,
  'menu-help': help,
  'menu-become-driver': becomeDriver,
  'menu-to-driver': toDriverMenu,
  'menu-post-trip': postTripMenu,
  'menu-driver-trips': driverTrips,
  'menu-requests': requestsList,
  'menu-driver-data': driverData,
  'menu-to-passenger': toPassengerMenu,
  'menu-admin': adminMenu,
};

handlers.on('message:text', async (ctx, next) => {
  const key = menuKeyOf(ctx.message.text);
  if (!key) return next();
  await MENU[key](ctx);
});

handlers.use(driver, passenger, requests, admin);

handlers.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

handlers.on('callback_query', async (ctx) => {
  await answerCb(ctx.callbackQuery.id, t('stale-button'));
});

handlers.on('message', async (ctx) => {
  await showMenu(ctx.user!, t('fallback'));
});
