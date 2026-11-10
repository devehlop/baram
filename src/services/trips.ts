import { and, asc, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { app } from '../app.js';
import {
  bookings,
  directions,
  drivers,
  trips,
  users,
  type DirectionRow,
  type DriverRow,
  type PickupMode,
  type Side,
  type TripRow,
  type TripStatus,
  type Trunk,
  type UserRow,
} from '../db/schema.js';
import { addDays, dayEnd, dayKey, dayStart, now, todayKey } from '../lib/time.js';
import { cityOf, otherSide, routeLabel } from './directions.js';
import { activePrivileges } from './drivers.js';
import { loadSettings } from './settings.js';

export interface TripInput {
  driverId: number;
  directionId: number;
  fromSide: Side;
  departsAt: Date;
  pickupMode: PickupMode;
  pickupPoints: string[];
  villages: boolean;
  villagesNote: string | null;
  seats: number;
  trunk: Trunk;
  price: number;
}

/** Рейс вместе с водителем — в виде, пригодном для карточек и для хранения в сценарии (без Date). */
export interface TripView {
  id: number;
  driverId: number;
  directionId: number;
  fromSide: Side;
  route: string;
  fromCity: string;
  toCity: string;
  travelMinutes: number;
  departsAt: string;
  pickupMode: PickupMode;
  pickupPoints: string[];
  villages: boolean;
  villagesNote: string | null;
  seatsTotal: number;
  seatsFree: number;
  trunk: Trunk;
  price: number;
  status: TripStatus;
  driver: {
    name: string;
    fullName: string;
    phone: string;
    telegramId: number;
    car: string;
    carYear: number;
    carColor: string;
    plate: string;
    childSeat: boolean;
    payPhone: string;
    payBank: string;
    photo: string | null;
    badge: boolean;
    priority: boolean;
  };
}

export type TripProblem = 'not_approved' | 'past' | 'horizon' | 'limit' | 'duplicate' | 'overlap' | 'price' | 'seats';

export const ACTIVE_TRIP: TripStatus[] = ['published', 'departed'];

type Joined = { t: TripRow; dir: DirectionRow; d: DriverRow; u: UserRow };

function baseSelect() {
  return app.db
    .select({ t: trips, dir: directions, d: drivers, u: users })
    .from(trips)
    .innerJoin(directions, eq(directions.id, trips.directionId))
    .innerJoin(drivers, eq(drivers.userId, trips.driverId))
    .innerJoin(users, eq(users.id, trips.driverId));
}

export async function toTripViews(rows: Joined[]): Promise<TripView[]> {
  const privs = await activePrivileges([...new Set(rows.map((r) => r.u.id))]);
  return rows.map(({ t, dir, d, u }) => ({
    id: t.id,
    driverId: t.driverId,
    directionId: t.directionId,
    fromSide: t.fromSide,
    route: routeLabel(dir, t.fromSide),
    fromCity: cityOf(dir, t.fromSide),
    toCity: cityOf(dir, otherSide(t.fromSide)),
    travelMinutes: dir.travelMinutes,
    departsAt: t.departsAt.toISOString(),
    pickupMode: t.pickupMode,
    pickupPoints: t.pickupPoints,
    villages: t.villages,
    villagesNote: t.villagesNote,
    seatsTotal: t.seatsTotal,
    seatsFree: t.seatsFree,
    trunk: t.trunk,
    price: t.price,
    status: t.status,
    driver: {
      name: u.name,
      fullName: d.fullName,
      phone: u.phone,
      telegramId: u.telegramId,
      car: d.car,
      carYear: d.carYear,
      carColor: d.carColor,
      plate: d.plate,
      childSeat: d.childSeat,
      payPhone: d.payPhone,
      payBank: d.payBank,
      photo: d.carPhotos[0] ?? null,
      badge: privs.get(u.id)?.has('verified_badge') ?? false,
      priority: privs.get(u.id)?.has('priority') ?? false,
    },
  }));
}

export async function getTrip(id: number): Promise<TripView | undefined> {
  const rows = await baseSelect().where(eq(trips.id, id));
  return (await toTripViews(rows))[0];
}

/** Запрос для поиска: опубликованные будущие рейсы проверенных водителей в окне времени. */
export async function findPublishedTrips(q: {
  directionId: number;
  fromSide: Side;
  from: Date;
  to: Date;
  seats: number;
}): Promise<TripView[]> {
  const after = q.from > now() ? q.from : now();
  const rows = await baseSelect()
    .where(
      and(
        eq(trips.directionId, q.directionId),
        eq(trips.fromSide, q.fromSide),
        eq(trips.status, 'published'),
        gte(trips.departsAt, after),
        lt(trips.departsAt, q.to),
        gte(trips.seatsFree, q.seats),
        eq(drivers.status, 'approved'),
        ne(users.restriction, 'blocked'),
      ),
    )
    .orderBy(asc(trips.departsAt));
  return toTripViews(rows);
}

/** Проверка нового рейса: лимиты и защита от спама. null — всё в порядке. */
export async function validateTrip(input: TripInput): Promise<TripProblem | null> {
  const s = await loadSettings();
  const [driver] = await app.db
    .select({ d: drivers, u: users })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.userId, input.driverId));
  if (!driver || driver.d.status !== 'approved' || driver.u.restriction === 'blocked') return 'not_approved';
  if (input.price < s.price_min || input.price > s.price_max) return 'price';
  if (input.seats < 1 || input.seats > driver.d.seats) return 'seats';
  if (input.departsAt <= now()) return 'past';

  const day = dayKey(input.departsAt);
  if (day > addDays(todayKey(), s.trip_horizon_days)) return 'horizon';

  const [dir] = await app.db.select().from(directions).where(eq(directions.id, input.directionId));
  const travelMs = (dir?.travelMinutes ?? 120) * 60_000;
  const span = Math.max(2 * travelMs, s.trip_duplicate_minutes * 60_000);
  const nearby = await app.db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.driverId, input.driverId),
        inArray(trips.status, ACTIVE_TRIP),
        gte(trips.departsAt, new Date(Math.min(dayStart(day).getTime(), input.departsAt.getTime() - span))),
        lt(trips.departsAt, new Date(Math.max(dayEnd(day).getTime(), input.departsAt.getTime() + span))),
      ),
    );

  const sameRoute = (t: TripRow) => t.directionId === input.directionId && t.fromSide === input.fromSide;
  const gap = (t: TripRow) => Math.abs(t.departsAt.getTime() - input.departsAt.getTime());

  if (nearby.some((t) => sameRoute(t) && gap(t) <= s.trip_duplicate_minutes * 60_000)) return 'duplicate';
  const sameDaySameRoute = nearby.filter((t) => sameRoute(t) && dayKey(t.departsAt) === day);
  if (sameDaySameRoute.length >= s.trips_per_side_per_day) return 'limit';
  // Одна машина — один рейс: на встречный рейс нужно время в пути, на повтор в ту же сторону — туда и обратно.
  if (nearby.some((t) => gap(t) < (sameRoute(t) ? 2 * travelMs : travelMs))) return 'overlap';
  return null;
}

export async function createTrip(input: TripInput): Promise<{ trip?: TripView; problem?: TripProblem }> {
  const problem = await validateTrip(input);
  if (problem) return { problem };
  const [row] = await app.db
    .insert(trips)
    .values({
      driverId: input.driverId,
      directionId: input.directionId,
      fromSide: input.fromSide,
      departsAt: input.departsAt,
      pickupMode: input.pickupMode,
      pickupPoints: input.pickupPoints,
      villages: input.villages,
      villagesNote: input.villagesNote,
      seatsTotal: input.seats,
      seatsFree: input.seats,
      trunk: input.trunk,
      price: input.price,
      createdAt: now(),
    })
    .returning();
  return { trip: await getTrip(row!.id) };
}

export async function lastTrip(driverId: number): Promise<TripView | undefined> {
  const rows = await baseSelect()
    .where(and(eq(trips.driverId, driverId), ne(trips.status, 'cancelled')))
    .orderBy(desc(trips.createdAt), desc(trips.id))
    .limit(1);
  return (await toTripViews(rows))[0];
}

/** «Мои рейсы»: всё, что ещё не завершено и не отменено. */
export async function listDriverTrips(driverId: number): Promise<TripView[]> {
  const rows = await baseSelect()
    .where(and(eq(trips.driverId, driverId), inArray(trips.status, ACTIVE_TRIP)))
    .orderBy(asc(trips.departsAt))
    .limit(20);
  return toTripViews(rows);
}

/** Рейсы водителя на указанный день и сторону — чтобы взять заявку в один из них. */
export async function driverTripsOn(driverId: number, directionId: number, fromSide: Side, day: string, seats: number) {
  const rows = await baseSelect()
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.directionId, directionId),
        eq(trips.fromSide, fromSide),
        eq(trips.status, 'published'),
        gte(trips.departsAt, dayStart(day) > now() ? dayStart(day) : now()),
        lt(trips.departsAt, dayEnd(day)),
        gte(trips.seatsFree, seats),
      ),
    )
    .orderBy(asc(trips.departsAt));
  return toTripViews(rows);
}

export async function setTripDeparted(tripId: number, driverId: number): Promise<boolean> {
  const res = await app.db
    .update(trips)
    .set({ status: 'departed', departedAt: now() })
    .where(and(eq(trips.id, tripId), eq(trips.driverId, driverId), eq(trips.status, 'published')))
    .returning({ id: trips.id });
  if (res.length === 0) return false;
  // Кого водитель не успел принять до выезда — тем отказ, чтобы бронь не висела.
  await app.db
    .update(bookings)
    .set({ status: 'declined', cancelledAt: now() })
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, ['pending', 'pending_admin'])));
  return true;
}

/** «Доехали»: рейс и все оставшиеся брони закрываются. Возвращает id завершённых броней. */
export async function completeTrip(tripId: number, driverId: number | null): Promise<number[] | null> {
  const cond = [eq(trips.id, tripId), inArray(trips.status, ACTIVE_TRIP)];
  if (driverId !== null) cond.push(eq(trips.driverId, driverId));
  const res = await app.db
    .update(trips)
    .set({ status: 'completed', completedAt: now() })
    .where(and(...cond))
    .returning({ id: trips.id });
  if (res.length === 0) return null;
  await app.db
    .update(bookings)
    .set({ status: 'declined', cancelledAt: now() })
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, ['pending', 'pending_admin'])));
  const done = await app.db
    .update(bookings)
    .set({ status: 'completed', completedAt: now() })
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, ['accepted', 'confirmed', 'picked_up'])))
    .returning({ id: bookings.id });
  return done.map((b) => b.id);
}

/** Отмена рейса: все действующие брони отменяются «водителем». Возвращает их id для уведомлений. */
export async function cancelTrip(
  tripId: number,
  by: { driverId: number } | 'admin',
): Promise<{ bookingIds: number[]; late: boolean } | null> {
  const cond = [eq(trips.id, tripId), eq(trips.status, 'published')];
  if (by !== 'admin') cond.push(eq(trips.driverId, by.driverId));
  const res = await app.db
    .update(trips)
    .set({ status: 'cancelled', cancelledAt: now() })
    .where(and(...cond))
    .returning();
  const trip = res[0];
  if (!trip) return null;
  const affected = await app.db
    .update(bookings)
    .set({ status: 'cancelled', cancelledBy: by === 'admin' ? 'admin' : 'driver', cancelledAt: now() })
    .where(
      and(eq(bookings.tripId, tripId), inArray(bookings.status, ['pending_admin', 'pending', 'accepted', 'confirmed'])),
    )
    .returning({ id: bookings.id, source: bookings.source });
  const s = await loadSettings();
  const hoursLeft = (trip.departsAt.getTime() - now().getTime()) / 3_600_000;
  const withPeople = affected.filter((b) => b.source !== 'phone');
  return {
    bookingIds: withPeople.map((b) => b.id),
    late: withPeople.length > 0 && hoursLeft < s.driver_late_cancel_hours,
  };
}

/** Рейсы, по которым водитель так и не нажал «Доехали». */
export async function staleTripIds(): Promise<number[]> {
  const s = await loadSettings();
  const rows = await app.db
    .select({ id: trips.id, departsAt: trips.departsAt, travel: directions.travelMinutes })
    .from(trips)
    .innerJoin(directions, eq(directions.id, trips.directionId))
    .where(and(inArray(trips.status, ACTIVE_TRIP), lt(trips.departsAt, now())));
  const limit = now().getTime();
  return rows
    .filter((r) => r.departsAt.getTime() + (r.travel + s.trip_autoclose_hours * 60) * 60_000 < limit)
    .map((r) => r.id);
}

/** Рейсы направления на день — для сводного поста в канале. */
export async function tripsOfDay(directionId: number, day: string): Promise<TripView[]> {
  const rows = await baseSelect()
    .where(
      and(
        eq(trips.directionId, directionId),
        inArray(trips.status, ACTIVE_TRIP),
        gte(trips.departsAt, dayStart(day)),
        lt(trips.departsAt, dayEnd(day)),
        eq(drivers.status, 'approved'),
      ),
    )
    .orderBy(asc(trips.fromSide), asc(trips.departsAt));
  return toTripViews(rows);
}
