import { and, asc, desc, eq, gt, inArray, lte, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { app } from '../app.js';
import {
  directions,
  localities,
  parcels,
  trips,
  users,
  type DirectionRow,
  type LocalityRow,
  type ParcelRow,
  type ParcelSize,
  type ParcelStatus,
  type ParcelTimeKind,
  type Side,
  type UserRow,
} from '../db/schema.js';
import { dayEnd, dayStart, now } from '../lib/time.js';
import { routeLabel } from './directions.js';
import { driverDirectionIds, getDriver, type DriverView } from './drivers.js';
import { timeWindow } from './search.js';
import { loadSettings } from './settings.js';
import { driverTripsOn, type TripView } from './trips.js';

/** Где забрать или куда отвезти. address = null: посылку привезут водителю / получатель заберёт сам. */
export interface ParcelPlace {
  localityId: number;
  city: string;
  village: boolean;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export interface ParcelPlaceInput {
  localityId: number;
  address: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface ParcelView {
  id: number;
  status: ParcelStatus;
  directionId: number;
  fromSide: Side;
  route: string;
  day: string;
  timeKind: ParcelTimeKind;
  exactMinutes: number | null;
  size: ParcelSize;
  contents: string;
  /** Деньги, карты, ключи, документы или лекарства — только для проверенных водителей. */
  valuable: boolean;
  from: ParcelPlace;
  to: ParcelPlace;
  recipientName: string;
  recipientPhone: string;
  /** Цена, которую предложил отправитель; null — «договоримся». */
  price: number | null;
  sender: { id: number; name: string; phone: string; telegramId: number };
  driverId: number | null;
  tripId: number | null;
  createdAt: string;
}

export interface NewParcel {
  senderId: number;
  directionId: number;
  fromSide: Side;
  day: string;
  timeKind: ParcelTimeKind;
  exactMinutes?: number | null;
  size: ParcelSize;
  contents: string;
  valuable: boolean;
  from: ParcelPlaceInput;
  to: ParcelPlaceInput;
  recipient: { name: string; phone: string };
  price: number | null;
}

/** Посылка ещё в пути: её видно в «Моих поездках», и новая сверх лимита не создаётся. */
export const ACTIVE_PARCEL: ParcelStatus[] = ['open', 'taken', 'picked_up'];

/** Окно, когда удобно отправить. «Любое время» — весь день. */
export function parcelWindow(day: string, kind: ParcelTimeKind, exactMinutes: number | null | undefined, exactSpread: number) {
  if (kind === 'any') return { from: dayStart(day), to: dayEnd(day) };
  const w = timeWindow(day, kind, exactMinutes, exactSpread);
  return { from: w.from, to: w.to };
}

export function parcelWindowExpired(day: string, kind: ParcelTimeKind, exactMinutes: number | null | undefined): boolean {
  return parcelWindow(day, kind, exactMinutes, 0).to <= now();
}

const fromLoc = alias(localities, 'p_from_loc');
const toLoc = alias(localities, 'p_to_loc');

function select() {
  return app.db
    .select({ p: parcels, u: users, dir: directions, fl: fromLoc, tl: toLoc })
    .from(parcels)
    .innerJoin(users, eq(users.id, parcels.senderId))
    .innerJoin(directions, eq(directions.id, parcels.directionId))
    .innerJoin(fromLoc, eq(fromLoc.id, parcels.fromLocalityId))
    .innerJoin(toLoc, eq(toLoc.id, parcels.toLocalityId));
}

function toView(x: { p: ParcelRow; u: UserRow; dir: DirectionRow; fl: LocalityRow; tl: LocalityRow }): ParcelView {
  const { p, u, dir, fl, tl } = x;
  const place = (l: LocalityRow, address: string | null, lat: number | null, lon: number | null): ParcelPlace => ({
    localityId: l.id,
    city: l.name,
    village: l.kind === 'village',
    address,
    lat,
    lon,
  });
  return {
    id: p.id,
    status: p.status,
    directionId: p.directionId,
    fromSide: p.fromSide,
    route: routeLabel(dir, p.fromSide),
    day: p.day,
    timeKind: p.timeKind,
    exactMinutes: p.exactMinutes,
    size: p.size,
    contents: p.contents,
    valuable: p.valuable,
    from: place(fl, p.fromAddress, p.fromLat, p.fromLon),
    to: place(tl, p.toAddress, p.toLat, p.toLon),
    recipientName: p.recipientName,
    recipientPhone: p.recipientPhone,
    price: p.price,
    sender: { id: u.id, name: u.name, phone: u.phone, telegramId: u.telegramId },
    driverId: p.driverId,
    tripId: p.tripId,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function getParcel(id: number): Promise<ParcelView | undefined> {
  const rows = await select().where(eq(parcels.id, id));
  return rows[0] ? toView(rows[0]) : undefined;
}

export type ParcelFailure = 'limit' | 'past';

export async function createParcel(input: NewParcel): Promise<{ ok: true; parcel: ParcelView } | { ok: false; reason: ParcelFailure }> {
  const s = await loadSettings();
  const w = parcelWindow(input.day, input.timeKind, input.exactMinutes, s.search_flex_hours * 60);
  if (w.to <= now()) return { ok: false, reason: 'past' };
  const active = await app.db
    .select({ id: parcels.id })
    .from(parcels)
    .where(and(eq(parcels.senderId, input.senderId), inArray(parcels.status, ['open', 'taken'])));
  if (active.length >= s.parcel_open_limit) return { ok: false, reason: 'limit' };
  const [row] = await app.db
    .insert(parcels)
    .values({
      senderId: input.senderId,
      directionId: input.directionId,
      fromSide: input.fromSide,
      day: input.day,
      timeKind: input.timeKind,
      exactMinutes: input.exactMinutes ?? null,
      windowFrom: w.from,
      windowTo: w.to,
      size: input.size,
      contents: input.contents,
      valuable: input.valuable,
      fromLocalityId: input.from.localityId,
      fromAddress: input.from.address,
      fromLat: input.from.lat ?? null,
      fromLon: input.from.lon ?? null,
      toLocalityId: input.to.localityId,
      toAddress: input.to.address,
      toLat: input.to.lat ?? null,
      toLon: input.to.lon ?? null,
      recipientName: input.recipient.name,
      recipientPhone: input.recipient.phone,
      price: input.price,
      createdAt: now(),
    })
    .returning({ id: parcels.id });
  return { ok: true, parcel: (await getParcel(row!.id))! };
}

/** Может ли водитель взять посылку: ценное — только со значком «Проверен». */
export function canCarry(p: Pick<ParcelView, 'valuable'>, driver: Pick<DriverView, 'badge'>): boolean {
  return !p.valuable || driver.badge;
}

/** Открытые посылки по направлениям водителя — в «Заявках», ближайшие сверху. Ценные — только проверенным. */
export async function listOpenParcelsForDriver(driver: Pick<DriverView, 'userId' | 'badge'>): Promise<ParcelView[]> {
  const dirIds = await driverDirectionIds(driver.userId);
  if (dirIds.length === 0) return [];
  const rows = await select()
    .where(
      and(
        eq(parcels.status, 'open'),
        inArray(parcels.directionId, dirIds),
        gt(parcels.windowTo, now()),
        ne(parcels.senderId, driver.userId),
        driver.badge ? undefined : eq(parcels.valuable, false),
      ),
    )
    .orderBy(asc(parcels.windowFrom))
    .limit(10);
  return rows.map(toView);
}

/** Посылки отправителя, которые ещё в пути. */
export async function listUserParcels(userId: number): Promise<ParcelView[]> {
  const rows = await select()
    .where(and(eq(parcels.senderId, userId), inArray(parcels.status, ACTIVE_PARCEL)))
    .orderBy(asc(parcels.windowFrom));
  return rows.map(toView);
}

/** Посылки в рейсе водителя. */
export async function listTripParcels(tripId: number): Promise<ParcelView[]> {
  const rows = await select()
    .where(and(eq(parcels.tripId, tripId), inArray(parcels.status, ['taken', 'picked_up', 'delivered'])))
    .orderBy(asc(parcels.takenAt), desc(parcels.id));
  return rows.map(toView);
}

/** Рейсы водителя, в которые можно взять посылку: тот же маршрут и день, рейс ещё не уехал. */
export async function tripsForParcel(driverId: number, p: ParcelView): Promise<TripView[]> {
  return driverTripsOn(driverId, p.directionId, p.fromSide, p.day, 0);
}

export type TakeParcelFailure = 'gone' | 'wrong_trip' | 'not_verified';

/** Водитель берёт посылку в свой рейс. Если двое нажали «Беру» одновременно, выиграет один. */
export async function takeParcel(
  parcelId: number,
  driverId: number,
  tripId: number,
): Promise<{ ok: true; parcel: ParcelView } | { ok: false; reason: TakeParcelFailure }> {
  const p = await getParcel(parcelId);
  if (!p || p.status !== 'open' || p.sender.id === driverId) return { ok: false, reason: 'gone' };
  const driver = await getDriver(driverId);
  if (!driver || !canCarry(p, driver)) return { ok: false, reason: 'not_verified' };
  if (!(await tripsForParcel(driverId, p)).some((x) => x.id === tripId)) return { ok: false, reason: 'wrong_trip' };
  const [row] = await app.db
    .update(parcels)
    .set({ status: 'taken', driverId, tripId, takenAt: now() })
    .where(and(eq(parcels.id, parcelId), eq(parcels.status, 'open')))
    .returning({ id: parcels.id });
  if (!row) return { ok: false, reason: 'gone' };
  return { ok: true, parcel: (await getParcel(parcelId))! };
}

async function move(id: number, driverId: number, from: ParcelStatus, set: Partial<ParcelRow>): Promise<boolean> {
  const rows = await app.db
    .update(parcels)
    .set(set)
    .where(and(eq(parcels.id, id), eq(parcels.driverId, driverId), eq(parcels.status, from)))
    .returning({ id: parcels.id });
  return rows.length > 0;
}

/** «Забрал посылку». */
export function pickUpParcel(id: number, driverId: number): Promise<boolean> {
  return move(id, driverId, 'taken', { status: 'picked_up', pickedUpAt: now() });
}

/** «Передал получателю». */
export function deliverParcel(id: number, driverId: number): Promise<boolean> {
  return move(id, driverId, 'picked_up', { status: 'delivered', deliveredAt: now(), closedAt: now() });
}

/** Водитель отказался, пока посылка ещё не у него: она снова видна другим водителям. */
export function releaseParcel(id: number, driverId: number): Promise<boolean> {
  return move(id, driverId, 'taken', { status: 'open', driverId: null, tripId: null, takenAt: null });
}

/**
 * Отмена отправителем: пока посылку не забрали. driverId — водитель, который успел её взять
 * (берётся из самой записи в момент отмены, а не из чтения до неё: «Беру» мог прийти в ту же секунду).
 */
export async function cancelParcel(id: number, senderId: number): Promise<{ parcel: ParcelView; driverId: number | null } | null> {
  const [row] = await app.db
    .update(parcels)
    .set({ status: 'cancelled', closedAt: now() })
    .where(and(eq(parcels.id, id), eq(parcels.senderId, senderId), inArray(parcels.status, ['open', 'taken'])))
    .returning({ driverId: parcels.driverId });
  if (!row) return null;
  return { parcel: (await getParcel(id))!, driverId: row.driverId };
}

/**
 * Рейс отменён или закрыт: посылки, которые водитель так и не забрал, снова открыты.
 * Если их время уже прошло — сразу закрываются как просроченные, чтобы не обещать «снова видна водителям».
 */
export async function releaseTripParcels(tripId: number): Promise<{ released: ParcelView[]; expired: ParcelView[] }> {
  const rows = await select().where(and(eq(parcels.tripId, tripId), eq(parcels.status, 'taken')));
  const late = rows.filter((x) => x.p.windowTo <= now());
  const back = rows.filter((x) => x.p.windowTo > now());
  if (back.length) {
    await app.db
      .update(parcels)
      .set({ status: 'open', driverId: null, tripId: null, takenAt: null })
      .where(inArray(parcels.id, back.map((x) => x.p.id)));
  }
  if (late.length) {
    await app.db
      .update(parcels)
      .set({ status: 'expired', closedAt: now() })
      .where(inArray(parcels.id, late.map((x) => x.p.id)));
  }
  return { released: back.map(toView), expired: late.map(toView) };
}

/**
 * Посылки, которые водитель уже забрал, а рейс отменён: «Доехали» по такому рейсу не будет,
 * поэтому водитель видит их в «Моих рейсах» и закрывает сам — «Передал» или «Вернул отправителю».
 */
export async function listHeldParcels(driverId: number): Promise<ParcelView[]> {
  const rows = await select()
    .innerJoin(trips, eq(trips.id, parcels.tripId))
    .where(and(eq(parcels.driverId, driverId), eq(parcels.status, 'picked_up'), eq(trips.status, 'cancelled')))
    .orderBy(asc(parcels.pickedUpAt));
  return rows.map(toView);
}

/** «Вернул отправителю»: посылка у водителя, но отвезти её не получится. */
export function returnParcel(id: number, driverId: number): Promise<boolean> {
  return move(id, driverId, 'picked_up', { status: 'returned', closedAt: now() });
}

/** «Доехали»: посылки, которые уже у водителя, считаются переданными. */
export async function deliverTripParcels(tripId: number): Promise<ParcelView[]> {
  const rows = await select().where(and(eq(parcels.tripId, tripId), eq(parcels.status, 'picked_up')));
  if (rows.length === 0) return [];
  await app.db
    .update(parcels)
    .set({ status: 'delivered', deliveredAt: now(), closedAt: now() })
    .where(inArray(parcels.id, rows.map((x) => x.p.id)));
  return rows.map(toView);
}

/** Посылки, которые никто не взял, а время прошло. */
export async function expireParcels(): Promise<ParcelView[]> {
  const rows = await select().where(and(eq(parcels.status, 'open'), lte(parcels.windowTo, now())));
  if (rows.length === 0) return [];
  await app.db
    .update(parcels)
    .set({ status: 'expired', closedAt: now() })
    .where(inArray(parcels.id, rows.map((x) => x.p.id)));
  return rows.map(toView);
}
