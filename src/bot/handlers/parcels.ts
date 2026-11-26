import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { cut, esc, mapsUrl } from '../../lib/format.js';
import { fmtTime } from '../../lib/time.js';
import { canCarry, getParcel, tripsForParcel, type ParcelPlace, type ParcelView } from '../../services/parcels.js';
import { getTrip } from '../../services/trips.js';
import {
  cancelParcelAction,
  deliverParcelAction,
  pickUpParcelAction,
  releaseParcelAction,
  returnParcelAction,
  takeParcelAction,
  takeParcelLabel,
} from '../actions.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { kb, type Btn } from '../tg.js';
import { parcelCard, parcelForSender } from '../ui/cards.js';
import { num, requireDriver, show, toast } from './shared.js';

export const parcels = new Composer<MyContext>();

export async function sendParcel(ctx: MyContext): Promise<void> {
  await enter(ctx, 'parcel');
}
parcels.callbackQuery('p:pcnew', async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendParcel(ctx);
});

/** Подпись посылки в списках: «📦 ср, 11 ноября, вечером · Маленькая». */
export function parcelButton(p: ParcelView, prefix: string): string {
  return cut(`📦 ${prefix}${t(`parcel-size-short-${p.size}`)} · ${p.from.address ?? p.from.city}`, 60);
}

// ——— Отправитель ———

async function senderScreen(ctx: MyContext, id: number): Promise<void> {
  const p = await getParcel(id);
  if (!p || p.sender.id !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  const trip = p.tripId ? await getTrip(p.tripId) : undefined;
  const canCancel = p.status === 'open' || p.status === 'taken';
  await show(
    ctx,
    parcelForSender(p, trip),
    kb([
      [canCancel && { text: t('btn-cancel-parcel'), data: `p:pcx:${p.id}`, style: 'danger' }],
      [{ text: t('btn-to-my-trips-passenger'), data: 'p:trips' }],
    ]),
  );
}
parcels.callbackQuery(/^p:pc:(\d+)$/, (ctx) => senderScreen(ctx, num(ctx)));

parcels.callbackQuery(/^p:pcx:(\d+)$/, async (ctx) => {
  const p = await getParcel(num(ctx));
  if (!p || p.sender.id !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  await show(
    ctx,
    t(p.status === 'taken' ? 'parcel-cancel-confirm-taken' : 'parcel-cancel-confirm'),
    kb([[{ text: t('btn-yes-cancel-parcel'), data: `p:pcx!:${p.id}` }], [{ text: t('btn-keep-parcel'), data: `p:pc:${p.id}` }]]),
  );
});
parcels.callbackQuery(/^p:pcx!:(\d+)$/, async (ctx) => {
  const ok = await cancelParcelAction(num(ctx), ctx.user!.id);
  await show(ctx, t(ok ? 'parcel-cancelled-done' : 'action-not-available'), kb([[{ text: t('btn-to-my-trips-passenger'), data: 'p:trips' }]]));
});

// ——— Водитель: взять посылку ———

parcels.callbackQuery(/^pc:take:(\d+)$/, async (ctx) => {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return toast(ctx, t(`drv-cannot-post-${d.status}`), true);
  const p = await getParcel(num(ctx));
  if (!p || p.status !== 'open') return toast(ctx, t('parcel-gone'), true);
  if (!canCarry(p, d)) return toast(ctx, t('parcel-only-verified'), true);
  const trips = await tripsForParcel(d.userId, p);
  if (trips.length === 0) {
    return show(
      ctx,
      `${t('parcel-need-trip')}\n\n${parcelCard(p)}`,
      kb([[{ text: t('menu-post-trip'), data: 'd:post' }], [{ text: t('btn-refresh'), data: `pc:take:${p.id}` }]]),
    );
  }
  await show(
    ctx,
    `${t('parcel-choose-trip', { take: esc(takeParcelLabel(p)) })}\n\n${parcelCard(p)}`,
    kb([
      ...trips.map((x) => [{ text: t('parcel-into-trip', { time: fmtTime(x.departsAt) }), data: `pc:t:${p.id}:${x.id}` }]),
      [{ text: t('btn-cancel'), data: 'r:list' }],
    ]),
  );
});

parcels.callbackQuery(/^pc:t:(\d+):(\d+)$/, async (ctx) => {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return toast(ctx, t(`drv-cannot-post-${d.status}`), true);
  const res = await takeParcelAction(num(ctx, 1), d.userId, num(ctx, 2));
  if (!res.ok) {
    const key = { gone: 'parcel-gone', not_verified: 'parcel-only-verified', wrong_trip: 'parcel-take-failed' }[res.reason];
    return toast(ctx, t(key), true);
  }
  await show(
    ctx,
    `${t('parcel-taken-driver')}\n\n${parcelCard(res.parcel, { contacts: true })}`,
    kb([[{ text: t('btn-open-parcel'), data: `d:pc:${res.parcel.id}` }], [{ text: t('btn-to-trip'), data: `d:t:${num(ctx, 2)}` }]]),
  );
});

// ——— Водитель: посылка в рейсе ———

function navButton(place: ParcelPlace): Btn | false {
  return !!place.address && { text: t('btn-navigator'), url: mapsUrl({ ...place, address: place.address }) };
}

async function driverScreen(ctx: MyContext, id: number): Promise<void> {
  const p = await getParcel(id);
  if (!p || p.driverId !== ctx.user!.id || !p.tripId) return toast(ctx, t('not-found'), true);
  const rows: (Btn | false)[][] = [];
  if (p.status === 'taken') {
    rows.push([navButton(p.from)], [{ text: t('btn-parcel-picked-up'), data: `d:pcp:${p.id}` }]);
    rows.push([{ text: t('btn-parcel-release'), data: `d:pcr:${p.id}` }]);
  }
  if (p.status === 'picked_up') {
    rows.push([navButton(p.to)], [{ text: t('btn-parcel-delivered'), data: `d:pcd:${p.id}` }]);
    // Рейс отменён, а посылка у водителя: отвезти не выйдет — можно отметить, что вернул.
    const trip = await getTrip(p.tripId);
    if (trip?.status === 'cancelled') rows.push([{ text: t('btn-parcel-returned'), data: `d:pcb:${p.id}` }]);
  }
  rows.push([{ text: t('btn-to-trip'), data: `d:t:${p.tripId}` }]);
  await show(ctx, parcelCard(p, { contacts: true, status: true }), kb(rows));
}
parcels.callbackQuery(/^d:pc:(\d+)$/, (ctx) => driverScreen(ctx, num(ctx)));

function parcelAction(pattern: RegExp, run: (id: number, driverId: number) => Promise<boolean>, okText: string, after: 'card' | 'trip') {
  parcels.callbackQuery(pattern, async (ctx) => {
    const id = num(ctx);
    const before = await getParcel(id);
    const ok = await run(id, ctx.user!.id);
    await toast(ctx, t(ok ? okText : 'action-not-available'));
    if (!ok || !before?.tripId) return;
    if (after === 'card') return driverScreen(ctx, id);
    await show(ctx, t(okText), kb([[{ text: t('btn-to-trip'), data: `d:t:${before.tripId}` }]]));
  });
}
parcelAction(/^d:pcp:(\d+)$/, pickUpParcelAction, 'drv-parcel-picked-toast', 'card');
parcelAction(/^d:pcd:(\d+)$/, deliverParcelAction, 'drv-parcel-delivered-toast', 'card');
parcelAction(/^d:pcr!:(\d+)$/, releaseParcelAction, 'drv-parcel-released-toast', 'trip');
parcelAction(/^d:pcb:(\d+)$/, returnParcelAction, 'drv-parcel-returned-toast', 'card');

parcels.callbackQuery(/^d:pcr:(\d+)$/, async (ctx) => {
  const p = await getParcel(num(ctx));
  if (!p || p.driverId !== ctx.user!.id) return toast(ctx, t('not-found'), true);
  await show(
    ctx,
    t('drv-parcel-release-confirm'),
    kb([[{ text: t('btn-yes-release-parcel'), data: `d:pcr!:${p.id}` }], [{ text: t('btn-back'), data: `d:pc:${p.id}` }]]),
  );
});
