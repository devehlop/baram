import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { cut, esc, fmtPhone } from '../../lib/format.js';
import { dayKey, fmtDayShort, fmtTime, now } from '../../lib/time.js';
import { CANCELLABLE, getBooking, listUserBookings } from '../../services/bookings.js';
import { closeRequest, getRequest, listUserOpenRequests } from '../../services/requests.js';
import { deleteAddress, deletePassenger, listAddresses, listPassengers, saveAddress } from '../../services/saved.js';
import { loadSettings } from '../../services/settings.js';
import { getTrip } from '../../services/trips.js';
import { cancelByPassenger, confirmRideAction, submitBooking } from '../actions.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { kb, type Btn } from '../tg.js';
import { bookingForPassenger, requestCard, timeLabel } from '../ui/cards.js';
import { num, show, toast } from './shared.js';

export const passenger = new Composer<MyContext>();

export async function findTrip(ctx: MyContext): Promise<void> {
  await enter(ctx, 'search');
}

// ——— Мои поездки ———

export async function myTrips(ctx: MyContext): Promise<void> {
  const { upcoming, past } = await listUserBookings(ctx.user!.id);
  const requests = await listUserOpenRequests(ctx.user!.id);
  const rows: Btn[][] = [];
  const label = async (x: (typeof upcoming)[number]) => {
    const trip = await getTrip(x.booking.tripId);
    const who = x.booking.isSelf ? '' : ` · ${x.booking.passengerName}`;
    return cut(`${fmtDayShort(dayKey(x.departsAt))} ${fmtTime(x.departsAt)} · ${trip?.route ?? ''}${who}`, 60);
  };
  for (const x of upcoming) rows.push([{ text: `🟢 ${await label(x)}`, data: `p:b:${x.booking.id}` }]);
  for (const r of requests) rows.push([{ text: cut(`🔔 ${t('request-short')}: ${timeLabel(r.day, r.timeKind, r.exactMinutes)}`, 60), data: `p:rq:${r.id}` }]);
  for (const x of past) rows.push([{ text: `▫️ ${await label(x)}`, data: `p:b:${x.booking.id}` }]);
  rows.push([{ text: t('menu-find'), data: 'p:find' }]);
  const empty = upcoming.length + past.length + requests.length === 0;
  await show(ctx, t(empty ? 'my-trips-empty' : 'my-trips-title'), kb(rows));
}
passenger.callbackQuery('p:trips', myTrips);
// «Забронировать место» под карточкой рейса из ссылки в чате.
passenger.callbackQuery(/^p:lb:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'search', { tripId: num(ctx) });
});
passenger.callbackQuery('p:find', async (ctx) => {
  await ctx.answerCallbackQuery();
  await findTrip(ctx);
});

async function bookingScreen(ctx: MyContext, id: number): Promise<void> {
  const b = await getBooking(id);
  if (!b || b.booker?.id !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const trip = (await getTrip(b.tripId))!;
  const s = await loadSettings();
  await show(
    ctx,
    bookingForPassenger(b, trip, s.big_baggage_prepay),
    kb([
      [CANCELLABLE.includes(b.status) && { text: t('btn-cancel-booking'), data: `p:x:${b.id}` }],
      [{ text: t('btn-repeat'), data: `p:rep:${b.id}` }, { text: t('btn-reverse'), data: `p:rev:${b.id}` }],
      [{ text: t('btn-complain'), data: `p:cmp:${b.id}` }],
      [{ text: t('btn-to-my-trips-passenger'), data: 'p:trips' }],
    ]),
  );
}
passenger.callbackQuery(/^p:b:(\d+)$/, (ctx) => bookingScreen(ctx, num(ctx)));

// Отмена: сначала объясняем, свободная она или поздняя.
passenger.callbackQuery(/^p:x:(\d+)$/, async (ctx) => {
  const b = await getBooking(num(ctx));
  if (!b || b.booker?.id !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const trip = (await getTrip(b.tripId))!;
  const s = await loadSettings();
  const hoursLeft = (new Date(trip.departsAt).getTime() - now().getTime()) / 3_600_000;
  const late = (b.status === 'accepted' || b.status === 'confirmed') && hoursLeft < s.late_cancel_hours;
  await show(
    ctx,
    t(late ? 'bk-cancel-confirm-late' : 'bk-cancel-confirm', { hours: s.late_cancel_hours, limit: s.violations_limit }),
    kb([[{ text: t('btn-yes-cancel-booking'), data: `p:x!:${b.id}` }], [{ text: t('btn-keep-booking'), data: `p:b:${b.id}` }]]),
  );
});
passenger.callbackQuery(/^p:x!:(\d+)$/, async (ctx) => {
  const res = await cancelByPassenger(num(ctx), ctx.user!.id);
  if (!res) return toast(ctx, t('action-not-available'), true);
  const warn = res.violations >= res.limit ? `\n\n${t('violations-restricted')}` : res.late ? `\n\n${t('violations-count', { n: res.violations, limit: res.limit })}` : '';
  await show(ctx, t(res.late ? 'bk-cancelled-late' : 'bk-cancelled-free') + warn, kb([[{ text: t('menu-find'), data: 'p:find' }]]));
});

// «Едете сегодня?» → «Да, еду»
passenger.callbackQuery(/^p:yes:(\d+)$/, async (ctx) => {
  const ok = await confirmRideAction(num(ctx), ctx.user!.id);
  await show(ctx, t(ok ? 'bk-confirmed-thanks' : 'action-not-available'));
});

passenger.callbackQuery(/^p:(rep|rev):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'search', { bookingId: num(ctx, 2), reverse: ctx.match[1] === 'rev' });
});

passenger.callbackQuery(/^p:cmp:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = num(ctx);
  await enter(ctx, 'prompt', { kind: 'complaint', id: id > 0 ? id : undefined });
});

// ——— Заявки пассажира ———

passenger.callbackQuery(/^p:rq:(\d+)$/, async (ctx) => {
  const r = await getRequest(num(ctx));
  if (!r || r.user.id !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  await show(
    ctx,
    `<b>${t('request-title')}</b>\n\n${requestCard(r)}`,
    kb([
      [r.status === 'open' && { text: t('btn-cancel-request'), data: `p:rqx:${r.id}` }],
      [{ text: t('btn-to-my-trips-passenger'), data: 'p:trips' }],
    ]),
  );
});

passenger.callbackQuery(/^p:rqx:(\d+)$/, async (ctx) => {
  const ok = await closeRequest(num(ctx), 'cancelled', ctx.user!.id);
  await show(ctx, t(ok ? 'request-cancelled' : 'action-not-available'));
});

// Появился рейс под заявку → «Еду с ним»: бронь из данных заявки, без повторной анкеты.
passenger.callbackQuery(/^p:rqb:(\d+):(\d+)$/, async (ctx) => {
  const r = await getRequest(num(ctx, 1));
  if (!r || r.user.id !== ctx.user!.id || r.status !== 'open') return toast(ctx, t('action-not-available'), true);
  const res = await submitBooking({
    tripId: num(ctx, 2),
    bookedBy: r.user.id,
    passenger: { name: r.passengerName, phone: r.passengerPhone, type: r.passengerType },
    from: r.from,
    to: r.to,
    seats: r.seats,
    childSeat: r.childSeat,
    baggage: r.baggage,
    baggageNote: r.baggageNote,
    comment: r.comment,
  });
  if (!res.ok) return toast(ctx, t(`bk-fail-${res.reason}`), true);
  await closeRequest(r.id, 'taken');
  const trip = (await getTrip(res.booking.tripId))!;
  const s = await loadSettings();
  await show(
    ctx,
    `${t(res.needsAdmin ? 'bk-sent-needs-admin' : 'bk-sent')}\n\n${bookingForPassenger(res.booking, trip, s.big_baggage_prepay)}`,
    kb([[{ text: t('menu-my-trips'), data: 'p:trips' }]]),
  );
});

// ——— Сохранённые адреса и люди ———

const ADDRESS_LABELS = ['addr-label-home', 'addr-label-dorm', 'addr-label-work', 'addr-label-other'];

passenger.callbackQuery(/^p:sa:(\d+):([ft])$/, async (ctx) => {
  const [id, which] = [num(ctx, 1), ctx.match[2]];
  await show(
    ctx,
    t('save-address-ask-label'),
    kb([ADDRESS_LABELS.map((k, i) => ({ text: t(k), data: `p:sal:${id}:${which}:${i}` }))]),
  );
});

passenger.callbackQuery(/^p:sal:(\d+):([ft]):(\d)$/, async (ctx) => {
  const b = await getBooking(num(ctx, 1));
  const place = ctx.match[2] === 'f' ? b?.from : b?.to;
  const label = ADDRESS_LABELS[num(ctx, 3)];
  if (!b || b.booker?.id !== ctx.user!.id || !place || !label) return toast(ctx, t('not-found'), true);
  await saveAddress({ userId: ctx.user!.id, label: t(label), localityId: place.localityId, address: place.address, lat: place.lat, lon: place.lon });
  await show(ctx, t('save-address-done', { label: t(label), address: `${esc(place.city)}, ${esc(place.address)}` }));
});

async function savedScreen(ctx: MyContext): Promise<void> {
  const addresses = await listAddresses(ctx.user!.id);
  const people = await listPassengers(ctx.user!.id);
  const text = [
    `<b>${t('saved-addresses-title')}</b>`,
    ...(addresses.length ? addresses.map((a) => `• ${esc(a.label)} — ${esc(a.city)}, ${esc(a.address)}`) : [t('saved-empty')]),
    '',
    `<b>${t('saved-people-title')}</b>`,
    ...(people.length ? people.map((p) => `• ${esc(p.name)}, ${fmtPhone(p.phone)}`) : [t('saved-empty')]),
  ].join('\n');
  await show(
    ctx,
    text,
    kb([
      ...addresses.map((a) => [{ text: cut(`✖ ${a.label} — ${a.address}`, 50), data: `p:del:a:${a.id}` }]),
      ...people.map((p) => [{ text: cut(`✖ ${p.name}`, 50), data: `p:del:p:${p.id}` }]),
    ]),
  );
}
passenger.callbackQuery('p:saved', savedScreen);
passenger.callbackQuery(/^p:del:([ap]):(\d+)$/, async (ctx) => {
  if (ctx.match[1] === 'a') await deleteAddress(ctx.user!.id, num(ctx, 2));
  else await deletePassenger(ctx.user!.id, num(ctx, 2));
  await savedScreen(ctx);
});

// ——— Помощь ———

export async function help(ctx: MyContext): Promise<void> {
  const s = await loadSettings();
  const phone = s.dispatcher_phone.trim();
  await show(
    ctx,
    [t('help-text', { hours: s.late_cancel_hours }), phone ? t('help-dispatcher', { phone: esc(phone) }) : ''].filter(Boolean).join('\n\n'),
    kb([
      [{ text: t('btn-complain'), data: 'p:cmp:0' }],
      [{ text: t('btn-saved'), data: 'p:saved' }],
    ]),
  );
}
