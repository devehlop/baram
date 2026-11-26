import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { onMax } from '../platform.js';
import type { MyContext } from '../context.js';
import { listRoutes } from '../../services/board.js';
import { parseStartLink, startPayloadOf } from '../../services/links.js';
import { enter } from '../enter.js';
import { sendTripLanding } from '../landing.js';
import { answerCb, send } from '../tg.js';
import { menuKeyOf, showMenu, type MenuKey } from '../ui/menu.js';
import { admin, adminMenu } from './admin.js';
import { board, boardScreen } from './board.js';
import { becomeDriver, driver, driverData, driverTrips, postTripMenu, toDriverMenu, toPassengerMenu } from './driver.js';
import { parcels, sendParcel } from './parcels.js';
import { findTrip, help, myTrips, passenger } from './passenger.js';
import { requests, requestsList } from './requests.js';

export const handlers = new Composer<MyContext>();

handlers.command('id', async (ctx) => {
  await send(ctx.chat.id, t(onMax(ctx.chat.id) ? 'your-id-max' : 'your-id', { id: String(ctx.from?.id ?? '') }));
});

handlers.command('privacy', async (ctx) => {
  await send(ctx.chat.id, t('privacy-policy'));
});

handlers.command('admin', adminMenu);

// Всё остальное доступно только после регистрации. Исключение — кнопки админа:
// админ задаётся по Telegram ID и может работать с уведомлениями, даже не пройдя анкету пассажира.
handlers.use(async (ctx, next) => {
  if (ctx.user) return next();
  if (ctx.isAdmin && ctx.callbackQuery?.data?.startsWith('a:')) return next();
  if (ctx.callbackQuery) await answerCb(ctx.callbackQuery.id);
  // Метка из ссылки «?start=…» едет через всю регистрацию: источник и рейс, ради которого человек пришёл.
  await enter(ctx, 'registration', startPayloadOf(ctx.message?.text));
});

handlers.command('start', async (ctx) => {
  const payload = startPayloadOf(ctx.message?.text);
  // Из Mini App: «Взять заявку» и «Оставить заявку» ведут в чат сразу на доску (b_r_0_2026-11-10) или в заявку (b_req_…).
  const toBoard = /^b_(t|r|req)_(\d+)_(\d{4}-\d{2}-\d{2})?$/.exec(payload ?? '');
  if (toBoard) {
    const [, tab, ri, day] = toBoard;
    const route = (await listRoutes())[Number(ri)];
    if (tab === 'req' && route && day) {
      return enter(ctx, 'search', { directionId: route.directionId, fromSide: route.fromSide, day, request: true });
    }
    return boardScreen(ctx, tab === 'r' ? 'r' : 't', Number(ri), day);
  }
  await showMenu(ctx.user!);
  const link = parseStartLink(payload);
  if (link?.kind === 'trip') await sendTripLanding(ctx.chat.id, link.tripId, ctx.user!.id);
});
handlers.command(['menu', 'cancel'], async (ctx) => {
  await showMenu(ctx.user!);
});
handlers.command('help', help);
handlers.command('find', findTrip);
handlers.command('board', (ctx) => boardScreen(ctx));
handlers.command('trips', myTrips);
handlers.command('parcel', sendParcel);

/** Большие кнопки главного меню приходят обычным текстом. */
const MENU: Record<MenuKey, (ctx: MyContext) => Promise<void>> = {
  'menu-find': findTrip,
  'menu-send-parcel': sendParcel,
  'menu-board': (ctx) => boardScreen(ctx),
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

handlers.use(driver, passenger, parcels, requests, board, admin);

handlers.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

handlers.on('callback_query', async (ctx) => {
  await answerCb(ctx.callbackQuery.id, t(onMax(ctx.chat?.id) ? 'stale-button-max' : 'stale-button'));
});

handlers.on('message', async (ctx) => {
  await showMenu(ctx.user!, t(onMax(ctx.chat.id) ? 'fallback-max' : 'fallback'));
});
