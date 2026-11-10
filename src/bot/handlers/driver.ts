import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { cut, esc, mapsUrl } from '../../lib/format.js';
import { dayKey, fmtDayShort, fmtTime } from '../../lib/time.js';
import {
  getBooking,
  listTripBookings,
  moveBookingUp,
  type BookingView,
} from '../../services/bookings.js';
import { getTrip, lastTrip, listDriverTrips, type TripView } from '../../services/trips.js';
import { setActiveRole, userStats } from '../../services/users.js';
import {
  acceptBookingAction,
  cancelByDriver,
  cancelTripAction,
  completeTripAction,
  declineBookingAction,
  departAction,
  etaAction,
  noShowAction,
  phoneBookingAction,
  pickUpAction,
  prepaidAction,
  wrongPersonAction,
} from '../actions.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { kb, type Btn } from '../tg.js';
import { bookingForDriver, driverCard, tripCard } from '../ui/cards.js';
import { showMenu } from '../ui/menu.js';
import { num, requireDriver, show, toast } from './shared.js';

export const driver = new Composer<MyContext>();

// ——— Меню водителя ———

export async function becomeDriver(ctx: MyContext): Promise<void> {
  await enter(ctx, 'driverForm');
}

export async function toDriverMenu(ctx: MyContext): Promise<void> {
  if (!(await requireDriver(ctx))) return;
  await setActiveRole(ctx.user!.id, 'driver');
  await showMenu({ ...ctx.user!, activeRole: 'driver' });
}

export async function toPassengerMenu(ctx: MyContext): Promise<void> {
  await setActiveRole(ctx.user!.id, 'passenger');
  await showMenu({ ...ctx.user!, activeRole: 'passenger' });
}

/** «Выложить рейс»: новый или повтор прошлого за два нажатия. */
export async function postTripMenu(ctx: MyContext): Promise<void> {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return show(ctx, t(`drv-cannot-post-${d.status}`));
  const last = await lastTrip(d.userId);
  if (!last) return enter(ctx, 'tripCreate', 'new');
  await show(
    ctx,
    t('trip-new-or-repeat'),
    kb([
      [{ text: t('btn-repeat-last', { route: last.route, time: fmtTime(last.departsAt) }), data: 'd:repeat' }],
      [{ text: t('btn-new-trip'), data: 'd:new' }],
    ]),
  );
}

driver.callbackQuery('d:new', async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'tripCreate', 'new');
});
driver.callbackQuery('d:repeat', async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'tripCreate', 'repeat');
});
driver.callbackQuery('d:form', async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'driverForm');
});
driver.callbackQuery('d:photos', async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'driverPhotos');
});

export async function driverData(ctx: MyContext): Promise<void> {
  const d = await requireDriver(ctx);
  if (!d) return;
  await show(
    ctx,
    driverCard(d),
    kb([
      [d.status === 'photos_requested' && { text: t('btn-send-photos'), data: 'd:photos' }],
      [{ text: t('btn-edit-form'), data: 'd:form' }],
    ]),
  );
}
driver.callbackQuery('d:data', driverData);

// ——— Мои рейсы ———

function tripListLabel(trip: TripView): string {
  const taken = trip.seatsTotal - trip.seatsFree;
  return `${fmtDayShort(dayKey(trip.departsAt))} ${fmtTime(trip.departsAt)} · ${trip.route} · ${taken}/${trip.seatsTotal}`;
}

export async function driverTrips(ctx: MyContext): Promise<void> {
  if (!(await requireDriver(ctx))) return;
  const trips = await listDriverTrips(ctx.user!.id);
  await show(
    ctx,
    trips.length ? t('drv-trips-title') : t('drv-trips-empty'),
    kb([...trips.map((x) => [{ text: tripListLabel(x), data: `d:t:${x.id}` }]), [{ text: t('menu-post-trip'), data: 'd:post' }]]),
  );
}
driver.callbackQuery('d:trips', driverTrips);
driver.callbackQuery('d:post', postTripMenu);

function passengerButton(b: BookingView, n: number): string {
  const mark = { pending: '🆕', pending_admin: '⏳', accepted: '', confirmed: '👍', picked_up: '✅' }[b.status as string] ?? '';
  const name = b.source === 'phone' && !b.passengerName ? t('phone-booking-short') : (b.passengerName ?? '');
  const where = b.pickupPoint ?? b.from?.address ?? '';
  return cut(`${n}. ${mark} ${name} · ${b.seats} · ${where}`.replace(/\s+/g, ' '), 60);
}

async function tripScreen(ctx: MyContext, tripId: number): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || trip.driverId !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const list = await listTripBookings(tripId);
  const active = trip.status === 'published' || trip.status === 'departed';
  const rows: (Btn | false)[][] = list.map((b, i) => [{ text: passengerButton(b, i + 1), data: `d:b:${b.id}` }]);
  if (trip.status === 'published') {
    rows.push([{ text: t('btn-departed'), data: `d:go:${trip.id}` }]);
    if (trip.seatsFree > 0) rows.push([{ text: t('btn-phone-booking'), data: `d:ph:${trip.id}` }]);
    rows.push([{ text: t('btn-cancel-trip'), data: `d:tc:${trip.id}` }]);
  }
  if (trip.status === 'departed') rows.push([{ text: t('btn-arrived'), data: `d:done:${trip.id}` }]);
  rows.push([{ text: t('btn-to-my-trips'), data: 'd:trips' }]);
  const header = list.length ? t('drv-trip-passengers') : active ? t('drv-trip-no-passengers') : '';
  await show(ctx, [tripCard(trip, { own: true }), header].filter(Boolean).join('\n\n'), kb(rows));
}
driver.callbackQuery(/^d:t:(\d+)$/, (ctx) => tripScreen(ctx, num(ctx)));

driver.callbackQuery(/^d:go:(\d+)$/, async (ctx) => {
  const ok = await departAction(num(ctx), ctx.user!.id);
  await toast(ctx, t(ok ? 'drv-departed-toast' : 'not-found'));
  if (ok) await tripScreen(ctx, num(ctx));
});

driver.callbackQuery(/^d:done:(\d+)$/, async (ctx) => {
  const ok = await completeTripAction(num(ctx), ctx.user!.id);
  if (!ok) return toast(ctx, t('not-found'), true);
  await show(ctx, t('drv-trip-completed'), kb([[{ text: t('btn-to-my-trips'), data: 'd:trips' }]]));
});

driver.callbackQuery(/^d:tc:(\d+)$/, async (ctx) => {
  await show(
    ctx,
    t('drv-cancel-trip-confirm'),
    kb([
      [{ text: t('btn-yes-cancel-trip'), data: `d:tc!:${num(ctx)}` }],
      [{ text: t('btn-back'), data: `d:t:${num(ctx)}` }],
    ]),
  );
});
driver.callbackQuery(/^d:tc!:(\d+)$/, async (ctx) => {
  const ok = await cancelTripAction(num(ctx), { driverId: ctx.user!.id });
  await show(ctx, t(ok ? 'drv-trip-cancelled' : 'not-found'), kb([[{ text: t('btn-to-my-trips'), data: 'd:trips' }]]));
});

// «+ Занято по телефону»: одно нажатие, места уходят из поиска.
driver.callbackQuery(/^d:ph:(\d+)$/, async (ctx) => {
  const trip = await getTrip(num(ctx));
  if (!trip || trip.driverId !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const options = [1, 2, 3].filter((n) => n <= trip.seatsFree);
  await show(
    ctx,
    t('drv-phone-booking-ask'),
    kb([options.map((n) => ({ text: String(n), data: `d:ph:${trip.id}:${n}` })), [{ text: t('btn-back'), data: `d:t:${trip.id}` }]]),
  );
});
driver.callbackQuery(/^d:ph:(\d+):(\d)$/, async (ctx) => {
  const id = await phoneBookingAction(num(ctx, 1), ctx.user!.id, num(ctx, 2));
  await toast(ctx, t(id === null ? 'drv-phone-booking-failed' : 'drv-phone-booking-done'));
  await tripScreen(ctx, num(ctx, 1));
});

// ——— Карточка пассажира ———

async function bookingScreen(ctx: MyContext, bookingId: number): Promise<void> {
  const b = await getBooking(bookingId);
  const trip = b && (await getTrip(b.tripId));
  if (!b || !trip || trip.driverId !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const marks = b.booker ? await userStats(b.booker.id) : undefined;
  const rows: (Btn | false | null)[][] = [];
  const waiting = b.status === 'accepted' || b.status === 'confirmed';
  if (b.status === 'pending') {
    rows.push([{ text: t('btn-accept'), data: `d:acc:${b.id}` }], [{ text: t('btn-decline'), data: `d:dec:${b.id}` }]);
  }
  if (b.source === 'phone' && waiting) {
    rows.push([{ text: t('btn-add-passenger-data'), data: `d:pd:${b.id}` }]);
  }
  if (waiting && b.from) rows.push([{ text: t('btn-navigator'), url: mapsUrl(b.from) }]);
  if (b.status === 'picked_up' && b.to) rows.push([{ text: t('btn-navigator'), url: mapsUrl(b.to) }]);
  if (waiting && b.source !== 'phone') {
    rows.push([5, 10, 15, 30].map((m) => ({ text: t('btn-eta', { n: m }), data: `d:eta:${b.id}:${m}` })));
    rows.push([{ text: t('btn-picked-up'), data: `d:pick:${b.id}` }]);
    rows.push([{ text: t('btn-no-show'), data: `d:ns:${b.id}` }, { text: t('btn-wrong-person'), data: `d:wrong:${b.id}` }]);
    if (b.prepayRequired && !b.prepayReceived) rows.push([{ text: t('btn-prepay-received'), data: `d:pre:${b.id}` }]);
  }
  if (waiting) {
    rows.push([{ text: t('btn-move-up'), data: `d:up:${b.id}` }]);
    if (trip.status === 'published') rows.push([{ text: t(b.source === 'phone' ? 'btn-free-seats' : 'btn-cancel-booking'), data: `d:bx:${b.id}` }]);
  }
  if (b.source !== 'phone') rows.push([{ text: t('btn-complain'), data: `p:cmp:${b.id}` }]);
  rows.push([{ text: t('btn-to-trip'), data: `d:t:${trip.id}` }]);
  await show(ctx, bookingForDriver(b, marks), kb(rows));
}
driver.callbackQuery(/^d:b:(\d+)$/, (ctx) => bookingScreen(ctx, num(ctx)));

/** Действие над бронью: выполнить, показать подсказку, обновить карточку. */
function bookingAction(
  pattern: RegExp,
  run: (ctx: MyContext, bookingId: number) => Promise<boolean>,
  okText: string,
  after: 'card' | 'trip' = 'card',
) {
  driver.callbackQuery(pattern, async (ctx) => {
    const id = num(ctx);
    const before = await getBooking(id);
    const ok = await run(ctx, id);
    await toast(ctx, t(ok ? okText : 'action-not-available'));
    if (!ok || !before) return;
    if (after === 'trip') await tripScreen(ctx, before.tripId);
    else await bookingScreen(ctx, id);
  });
}

bookingAction(/^d:acc:(\d+)$/, (ctx, id) => acceptBookingAction(id, ctx.user!.id), 'drv-accepted-toast');
bookingAction(/^d:dec:(\d+)$/, (ctx, id) => declineBookingAction(id, ctx.user!.id), 'drv-declined-toast', 'trip');
bookingAction(/^d:pick:(\d+)$/, (ctx, id) => pickUpAction(id, ctx.user!.id), 'drv-picked-up-toast', 'trip');
bookingAction(/^d:pre:(\d+)$/, (ctx, id) => prepaidAction(id, ctx.user!.id), 'drv-prepaid-toast');
bookingAction(/^d:wrong:(\d+)$/, (ctx, id) => wrongPersonAction(id, ctx.user!.id), 'drv-wrong-person-toast');
bookingAction(/^d:ns!:(\d+)$/, (ctx, id) => noShowAction(id, ctx.user!.id), 'drv-no-show-toast', 'trip');
bookingAction(/^d:bx!:(\d+)$/, (ctx, id) => cancelByDriver(id, ctx.user!.id), 'drv-booking-cancelled-toast', 'trip');
bookingAction(
  /^d:up:(\d+)$/,
  async (ctx, id) => {
    const b = await getBooking(id);
    const trip = b && (await getTrip(b.tripId));
    if (!trip || trip.driverId !== ctx.user!.id) return false;
    await moveBookingUp(id);
    return true;
  },
  'drv-moved-up-toast',
  'trip',
);

driver.callbackQuery(/^d:eta:(\d+):(\d+)$/, async (ctx) => {
  const ok = await etaAction(num(ctx, 1), ctx.user!.id, num(ctx, 2));
  await toast(ctx, t(ok ? 'drv-eta-toast' : 'action-not-available'));
});

function confirmStep(pattern: RegExp, question: string, yes: string, yesData: (id: number) => string) {
  driver.callbackQuery(pattern, async (ctx) => {
    const id = num(ctx);
    const b = await getBooking(id);
    await show(
      ctx,
      t(question, { name: esc(b?.passengerName ?? t('passenger-unknown')) }),
      kb([[{ text: t(yes), data: yesData(id) }], [{ text: t('btn-back'), data: `d:b:${id}` }]]),
    );
  });
}
confirmStep(/^d:ns:(\d+)$/, 'drv-no-show-confirm', 'btn-yes-no-show', (id) => `d:ns!:${id}`);
confirmStep(/^d:bx:(\d+)$/, 'drv-cancel-booking-confirm', 'btn-yes-cancel-booking', (id) => `d:bx!:${id}`);

driver.callbackQuery(/^d:pd:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'phoneData', id: num(ctx) });
});
