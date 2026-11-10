import { and, asc, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { app } from '../app.js';
import {
  directions,
  localities,
  requests,
  users,
  type Baggage,
  type ChildSeat,
  type DirectionRow,
  type LocalityRow,
  type PassengerType,
  type RequestRow,
  type RequestStatus,
  type Side,
  type TimeKind,
  type UserRow,
} from '../db/schema.js';
import { dayKey, now } from '../lib/time.js';
import { createBooking, type BookingFailure, type BookingView, type Place, type PlaceInput } from './bookings.js';
import { routeLabel } from './directions.js';
import { activeDriversOfDirection, driverDirectionIds, type DriverView } from './drivers.js';
import { timeWindow } from './search.js';
import { loadSettings } from './settings.js';
import { driverTripsOn, type TripView } from './trips.js';

export interface RequestView {
  id: number;
  status: RequestStatus;
  directionId: number;
  fromSide: Side;
  route: string;
  day: string;
  timeKind: TimeKind;
  exactMinutes: number | null;
  passengerName: string;
  passengerPhone: string;
  passengerType: PassengerType;
  from: Place;
  to: Place;
  seats: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote: string | null;
  comment: string | null;
  user: { id: number; name: string; phone: string; telegramId: number };
  takenBy: number | null;
  escalated: boolean;
  createdAt: string;
}

export interface NewRequest {
  userId: number;
  directionId: number;
  fromSide: Side;
  day: string;
  timeKind: TimeKind;
  exactMinutes?: number | null;
  passenger: { name: string; phone: string; type: PassengerType };
  from: PlaceInput;
  to: PlaceInput;
  seats: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote?: string | null;
  comment?: string | null;
}

const fromLoc = alias(localities, 'r_from_loc');
const toLoc = alias(localities, 'r_to_loc');

function select() {
  return app.db
    .select({ r: requests, u: users, dir: directions, fl: fromLoc, tl: toLoc })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.userId))
    .innerJoin(directions, eq(directions.id, requests.directionId))
    .innerJoin(fromLoc, eq(fromLoc.id, requests.fromLocalityId))
    .innerJoin(toLoc, eq(toLoc.id, requests.toLocalityId));
}

function toView(x: { r: RequestRow; u: UserRow; dir: DirectionRow; fl: LocalityRow; tl: LocalityRow }): RequestView {
  const { r, u, dir, fl, tl } = x;
  const place = (l: LocalityRow, address: string, lat: number | null, lon: number | null): Place => ({
    localityId: l.id,
    city: l.name,
    village: l.kind === 'village',
    address,
    lat,
    lon,
  });
  return {
    id: r.id,
    status: r.status,
    directionId: r.directionId,
    fromSide: r.fromSide,
    route: routeLabel(dir, r.fromSide),
    day: r.day,
    timeKind: r.timeKind,
    exactMinutes: r.exactMinutes,
    passengerName: r.passengerName,
    passengerPhone: r.passengerPhone,
    passengerType: r.passengerType,
    from: place(fl, r.fromAddress, r.fromLat, r.fromLon),
    to: place(tl, r.toAddress, r.toLat, r.toLon),
    seats: r.seats,
    childSeat: r.childSeat,
    baggage: r.baggage,
    baggageNote: r.baggageNote,
    comment: r.comment,
    user: { id: u.id, name: u.name, phone: u.phone, telegramId: u.telegramId },
    takenBy: r.takenBy,
    escalated: r.escalatedAt !== null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getRequest(id: number): Promise<RequestView | undefined> {
  const rows = await select().where(eq(requests.id, id));
  return rows[0] ? toView(rows[0]) : undefined;
}

export async function createRequest(input: NewRequest): Promise<RequestView> {
  const s = await loadSettings();
  const w = timeWindow(input.day, input.timeKind, input.exactMinutes, s.search_flex_hours * 60);
  const [row] = await app.db
    .insert(requests)
    .values({
      userId: input.userId,
      directionId: input.directionId,
      fromSide: input.fromSide,
      day: input.day,
      timeKind: input.timeKind,
      exactMinutes: input.exactMinutes ?? null,
      windowFrom: w.from,
      windowTo: w.to,
      passengerName: input.passenger.name,
      passengerPhone: input.passenger.phone,
      passengerType: input.passenger.type,
      fromLocalityId: input.from.localityId,
      fromAddress: input.from.address,
      fromLat: input.from.lat ?? null,
      fromLon: input.from.lon ?? null,
      toLocalityId: input.to.localityId,
      toAddress: input.to.address,
      toLat: input.to.lat ?? null,
      toLon: input.to.lon ?? null,
      seats: input.seats,
      childSeat: input.childSeat,
      baggage: input.baggage,
      baggageNote: input.baggageNote ?? null,
      comment: input.comment ?? null,
    })
    .returning({ id: requests.id });
  return (await getRequest(row!.id))!;
}

/** «Заявки» водителя: открытые заявки по его направлениям, ближайшие сверху. */
export async function listOpenRequestsForDriver(driverId: number): Promise<RequestView[]> {
  const dirIds = await driverDirectionIds(driverId);
  if (dirIds.length === 0) return [];
  const rows = await select()
    .where(
      and(
        eq(requests.status, 'open'),
        inArray(requests.directionId, dirIds),
        gt(requests.windowTo, now()),
        ne(requests.userId, driverId),
      ),
    )
    .orderBy(asc(requests.windowFrom))
    .limit(10);
  return rows.map(toView);
}

export async function listUserOpenRequests(userId: number): Promise<RequestView[]> {
  const rows = await select()
    .where(and(eq(requests.userId, userId), eq(requests.status, 'open')))
    .orderBy(asc(requests.windowFrom));
  return rows.map(toView);
}

/** Заявки, переданные админу и до сих пор без водителя. */
export async function listEscalatedRequests(): Promise<RequestView[]> {
  const rows = await select()
    .where(and(eq(requests.status, 'open'), gt(requests.windowTo, now())))
    .orderBy(asc(requests.windowFrom))
    .limit(20);
  return rows.map(toView).filter((r) => r.escalated);
}

/** Рейсы водителя, в которые он может взять заявку: тот же день и сторона, хватает мест. */
export async function tripsForRequest(driverId: number, r: RequestView): Promise<TripView[]> {
  return driverTripsOn(driverId, r.directionId, r.fromSide, r.day, r.seats);
}

export type TakeFailure = BookingFailure | 'gone' | 'wrong_trip';

/** Водитель берёт заявку в свой рейс: заявка превращается в принятую бронь. */
export async function takeRequest(
  requestId: number,
  driverId: number,
  tripId: number,
): Promise<{ ok: true; booking: BookingView } | { ok: false; reason: TakeFailure }> {
  const r = await getRequest(requestId);
  if (!r || r.status !== 'open') return { ok: false, reason: 'gone' };
  const suitable = await tripsForRequest(driverId, r);
  if (!suitable.some((t) => t.id === tripId)) return { ok: false, reason: 'wrong_trip' };

  // Сначала занимаем заявку: если двое водителей нажали «Беру» одновременно, выиграет один.
  const [locked] = await app.db
    .update(requests)
    .set({ status: 'taken', takenBy: driverId, closedAt: now() })
    .where(and(eq(requests.id, requestId), eq(requests.status, 'open')))
    .returning({ id: requests.id });
  if (!locked) return { ok: false, reason: 'gone' };

  const res = await createBooking({
    tripId,
    bookedBy: r.user.id,
    passenger: { name: r.passengerName, phone: r.passengerPhone, type: r.passengerType },
    from: r.from,
    to: r.to,
    seats: r.seats,
    childSeat: r.childSeat,
    baggage: r.baggage,
    baggageNote: r.baggageNote,
    comment: r.comment,
    fromRequestId: r.id,
    preAccepted: true,
  });
  if (!res.ok) {
    await app.db
      .update(requests)
      .set({ status: 'open', takenBy: null, closedAt: null })
      .where(eq(requests.id, requestId));
    return res;
  }
  await app.db.update(requests).set({ bookingId: res.booking.id }).where(eq(requests.id, requestId));
  return { ok: true, booking: res.booking };
}

export async function closeRequest(id: number, status: 'closed' | 'cancelled' | 'taken', userId?: number): Promise<boolean> {
  const [row] = await app.db
    .update(requests)
    .set({ status, closedAt: now() })
    .where(and(eq(requests.id, id), eq(requests.status, 'open'), userId ? eq(requests.userId, userId) : undefined))
    .returning({ id: requests.id });
  return !!row;
}

/** Заявки, которые никто не взял за request_escalate_minutes. */
export async function dueEscalations(): Promise<RequestView[]> {
  const s = await loadSettings();
  const before = new Date(now().getTime() - s.request_escalate_minutes * 60_000);
  const rows = await select().where(
    and(eq(requests.status, 'open'), isNull(requests.escalatedAt), lte(requests.createdAt, before), gt(requests.windowTo, now())),
  );
  return rows.map(toView);
}

export async function markEscalated(id: number): Promise<void> {
  await app.db.update(requests).set({ escalatedAt: now() }).where(eq(requests.id, id));
}

/** Заявки, время которых прошло. Закрываются, пассажиру сообщаем. */
export async function expireRequests(): Promise<RequestView[]> {
  const rows = await select().where(and(eq(requests.status, 'open'), lte(requests.windowTo, now())));
  if (rows.length === 0) return [];
  await app.db
    .update(requests)
    .set({ status: 'expired', closedAt: now() })
    .where(inArray(requests.id, rows.map((x) => x.r.id)));
  return rows.map(toView);
}

/** Открытые заявки, которым подходит новый рейс: тот же маршрут и день. */
export async function requestsMatchingTrip(trip: TripView): Promise<RequestView[]> {
  const rows = await select().where(
    and(
      eq(requests.status, 'open'),
      eq(requests.directionId, trip.directionId),
      eq(requests.fromSide, trip.fromSide),
      eq(requests.day, dayKey(trip.departsAt)),
      lte(requests.seats, trip.seatsFree),
      ne(requests.userId, trip.driverId),
    ),
  );
  return rows.map(toView);
}

/** Кому админ может предложить заявку: сначала водители с рейсом на этот день, затем остальные. */
export async function candidateDrivers(r: RequestView): Promise<{ driver: DriverView; trips: TripView[] }[]> {
  const drivers = (await activeDriversOfDirection(r.directionId)).filter((d) => d.userId !== r.user.id);
  const out: { driver: DriverView; trips: TripView[] }[] = [];
  for (const driver of drivers) {
    out.push({ driver, trips: await tripsForRequest(driver.userId, r) });
  }
  return out.sort((a, b) => b.trips.length - a.trips.length).slice(0, 8);
}
