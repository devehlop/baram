import { eq, gte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { app } from '../app.js';
import { bookings, drivers, requests, trips, users, visitors } from '../db/schema.js';
import { now } from '../lib/time.js';
import { sourceOf, startPayloadOf } from './links.js';

/**
 * Отметить, что человек пишет боту. Первая отметка — это и есть «нажал Старт»:
 * она пишется до регистрации, поэтому видны и те, кто ушёл, не заполнив анкету.
 */
export async function noteVisit(telegramId: number, text?: string): Promise<void> {
  const payload = startPayloadOf(text);
  const source = payload ? await sourceOf(payload) : null;
  const at = now();
  await app.db
    .insert(visitors)
    .values({ telegramId, source, firstSeenAt: at, lastSeenAt: at })
    .onConflictDoUpdate({ target: visitors.telegramId, set: { lastSeenAt: at } });
}

/** Сколько человек впервые написали боту по каждой метке источника. since — с этой даты. */
export async function startsBySource(since?: Date): Promise<Map<string | null, number>> {
  const rows = await app.db
    .select({ source: visitors.source, n: sql<number>`count(*)::int` })
    .from(visitors)
    .where(since ? gte(visitors.firstSeenAt, since) : undefined)
    .groupBy(visitors.source);
  return new Map(rows.map((r) => [r.source, r.n]));
}

/** Путь новых людей: впервые пришли за период → что из этого вышло. */
export interface Funnel {
  /** Нажали «Старт» (первое сообщение боту). */
  started: number;
  /** Из них прошли регистрацию. */
  registered: number;
  /** Из них оформили хотя бы одну бронь. */
  booked: number;
  /** Из них хотя бы раз доехали. */
  rode: number;
  /** Из них подали анкету водителя. */
  drivers: number;
}

/** Что происходило за период. */
export interface Activity {
  /** Писали боту за период (для «всё время» — все, кто когда-либо писал). */
  active: number;
  /** Зарегистрированы всего, на сегодня. */
  usersTotal: number;
  /** Водители в работе и ждущие проверки — на сегодня. */
  driversApproved: number;
  driversPending: number;
  /** Анкет водителей подано за период. */
  driverForms: number;
  tripsPosted: number;
  tripsCompleted: number;
  tripsCancelled: number;
  /** Брони через бота и заявки (без «занято по телефону»). */
  bookings: number;
  bookingsCompleted: number;
  /** Пассажиров довезли: сумма мест в завершённых бронях, включая брони по телефону. */
  seatsCompleted: number;
  /** Сумма завершённых поездок, ₽. */
  revenue: number;
  bookingsCancelled: number;
  noShows: number;
  requests: number;
  requestsTaken: number;
}

/** Событие случилось за период: дата не пустая и не раньше since. */
const within = (col: AnyPgColumn, since?: Date): SQL => (since ? sql`${col} >= ${since.toISOString()}::timestamptz` : sql`${col} is not null`);

export async function funnel(since?: Date): Promise<Funnel> {
  const hasBooking = (extra: SQL) =>
    sql`exists (select 1 from ${bookings} where ${bookings.bookedBy} = ${users.id} and ${bookings.source} <> 'phone' and ${extra})`;
  const [row] = await app.db
    .select({
      started: sql<number>`count(*)::int`,
      registered: sql<number>`count(${users.id})::int`,
      booked: sql<number>`count(${users.id}) filter (where ${hasBooking(sql`true`)})::int`,
      rode: sql<number>`count(${users.id}) filter (where ${hasBooking(sql`${bookings.status} = 'completed'`)})::int`,
      drivers: sql<number>`count(${drivers.userId})::int`,
    })
    .from(visitors)
    .leftJoin(users, eq(users.telegramId, visitors.telegramId))
    .leftJoin(drivers, eq(drivers.userId, users.id))
    .where(since ? gte(visitors.firstSeenAt, since) : undefined);
  return row ?? { started: 0, registered: 0, booked: 0, rode: 0, drivers: 0 };
}

export async function activity(since?: Date): Promise<Activity> {
  const [[v], [u], [d], [tr], [b], [r]] = await Promise.all([
    app.db
      .select({ active: sql<number>`count(*)::int` })
      .from(visitors)
      .where(since ? gte(visitors.lastSeenAt, since) : undefined),
    app.db.select({ usersTotal: sql<number>`count(*)::int` }).from(users),
    app.db
      .select({
        driversApproved: sql<number>`count(*) filter (where ${drivers.status} = 'approved')::int`,
        driversPending: sql<number>`count(*) filter (where ${drivers.status} in ('pending', 'photos_requested'))::int`,
        driverForms: sql<number>`count(*) filter (where ${within(drivers.createdAt, since)})::int`,
      })
      .from(drivers),
    app.db
      .select({
        tripsPosted: sql<number>`count(*) filter (where ${within(trips.createdAt, since)})::int`,
        tripsCompleted: sql<number>`count(*) filter (where ${trips.status} = 'completed' and ${within(trips.completedAt, since)})::int`,
        tripsCancelled: sql<number>`count(*) filter (where ${trips.status} = 'cancelled' and ${within(trips.cancelledAt, since)})::int`,
      })
      .from(trips),
    app.db
      .select({
        bookings: sql<number>`count(*) filter (where ${bookings.source} <> 'phone' and ${within(bookings.createdAt, since)})::int`,
        bookingsCompleted: sql<number>`count(*) filter (where ${bookings.source} <> 'phone' and ${bookings.status} = 'completed' and ${within(bookings.completedAt, since)})::int`,
        seatsCompleted: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'completed' and ${within(bookings.completedAt, since)}), 0)::int`,
        revenue: sql<number>`coalesce(sum(${bookings.price}) filter (where ${bookings.status} = 'completed' and ${within(bookings.completedAt, since)}), 0)::int`,
        bookingsCancelled: sql<number>`count(*) filter (where ${bookings.source} <> 'phone' and ${bookings.status} = 'cancelled' and ${within(bookings.cancelledAt, since)})::int`,
        noShows: sql<number>`count(*) filter (where ${bookings.status} = 'no_show' and ${within(bookings.completedAt, since)})::int`,
      })
      .from(bookings),
    app.db
      .select({
        requests: sql<number>`count(*)::int`,
        requestsTaken: sql<number>`count(*) filter (where ${requests.status} = 'taken')::int`,
      })
      .from(requests)
      .where(since ? gte(requests.createdAt, since) : undefined),
  ]);
  return { ...v!, ...u!, ...d!, ...tr!, ...b!, ...r! };
}
