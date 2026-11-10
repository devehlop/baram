import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { app } from '../app.js';
import {
  bookings,
  localities,
  trips,
  users,
  type Baggage,
  type BookingRow,
  type BookingSource,
  type BookingStatus,
  type CancelledBy,
  type ChildSeat,
  type LocalityRow,
  type PassengerType,
  type UserRow,
} from '../db/schema.js';
import { now } from '../lib/time.js';
import { loadSettings } from './settings.js';
import { countViolations, getUser, getUserByPhone, needsAdminApproval } from './users.js';

export interface PlaceInput {
  localityId: number;
  address: string;
  lat?: number | null;
  lon?: number | null;
}

export interface Place {
  localityId: number;
  city: string;
  village: boolean;
  address: string;
  lat: number | null;
  lon: number | null;
}

export interface BookingView {
  id: number;
  tripId: number;
  status: BookingStatus;
  source: BookingSource;
  requestId: number | null;
  seats: number;
  price: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote: string | null;
  comment: string | null;
  pickupPoint: string | null;
  pickupOrder: number;
  prepayRequired: boolean;
  prepayReceived: boolean;
  lateCancel: boolean;
  cancelledBy: CancelledBy | null;
  passengerName: string | null;
  passengerPhone: string | null;
  passengerType: PassengerType;
  passengerUserId: number | null;
  /** Заказчик — тот, кто оформил бронь в боте. Для брони «по телефону» его нет. */
  booker: { id: number; name: string; phone: string; telegramId: number } | null;
  /** Пассажир и заказчик — один человек. */
  isSelf: boolean;
  from: Place | null;
  to: Place | null;
  createdAt: string;
}

export const ACTIVE_BOOKING: BookingStatus[] = ['pending_admin', 'pending', 'accepted', 'confirmed', 'picked_up'];
/** Брони, которые можно отменить (поездка ещё не началась). */
export const CANCELLABLE: BookingStatus[] = ['pending_admin', 'pending', 'accepted', 'confirmed'];

const fromLoc = alias(localities, 'from_loc');
const toLoc = alias(localities, 'to_loc');

type Joined = { b: BookingRow; u: UserRow | null; fl: LocalityRow | null; tl: LocalityRow | null };

function baseSelect() {
  return app.db
    .select({ b: bookings, u: users, fl: fromLoc, tl: toLoc })
    .from(bookings)
    .leftJoin(users, eq(users.id, bookings.bookedBy))
    .leftJoin(fromLoc, eq(fromLoc.id, bookings.fromLocalityId))
    .leftJoin(toLoc, eq(toLoc.id, bookings.toLocalityId));
}

function place(loc: LocalityRow | null, address: string | null, lat: number | null, lon: number | null): Place | null {
  if (!loc || address === null) return null;
  return { localityId: loc.id, city: loc.name, village: loc.kind === 'village', address, lat, lon };
}

function toView({ b, u, fl, tl }: Joined): BookingView {
  return {
    id: b.id,
    tripId: b.tripId,
    status: b.status,
    source: b.source,
    requestId: b.requestId,
    seats: b.seats,
    price: b.price,
    childSeat: b.childSeat,
    baggage: b.baggage,
    baggageNote: b.baggageNote,
    comment: b.comment,
    pickupPoint: b.pickupPoint,
    pickupOrder: b.pickupOrder,
    prepayRequired: b.prepayRequired,
    prepayReceived: b.prepayReceivedAt !== null,
    lateCancel: b.lateCancel,
    cancelledBy: b.cancelledBy,
    passengerName: b.passengerName,
    passengerPhone: b.passengerPhone,
    passengerType: b.passengerType,
    passengerUserId: b.passengerUserId,
    booker: u ? { id: u.id, name: u.name, phone: u.phone, telegramId: u.telegramId } : null,
    isSelf: u !== null && (b.passengerUserId === u.id || b.passengerPhone === u.phone),
    from: place(fl, b.fromAddress, b.fromLat, b.fromLon),
    to: place(tl, b.toAddress, b.toLat, b.toLon),
    createdAt: b.createdAt.toISOString(),
  };
}

export async function getBooking(id: number): Promise<BookingView | undefined> {
  const rows = await baseSelect().where(eq(bookings.id, id));
  return rows[0] ? toView(rows[0]) : undefined;
}

export async function getBookings(ids: number[]): Promise<BookingView[]> {
  if (ids.length === 0) return [];
  const rows = await baseSelect().where(inArray(bookings.id, ids));
  return rows.map(toView);
}

/** Пассажиры рейса по порядку объезда. */
export async function listTripBookings(tripId: number, statuses: BookingStatus[] = ACTIVE_BOOKING) {
  const rows = await baseSelect()
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, statuses)))
    .orderBy(asc(bookings.pickupOrder), asc(bookings.id));
  return rows.map(toView);
}

export interface UserBooking {
  booking: BookingView;
  departsAt: string;
}

/** «Мои поездки»: предстоящие и последние прошлые. */
export async function listUserBookings(userId: number): Promise<{ upcoming: UserBooking[]; past: UserBooking[] }> {
  const select = () =>
    app.db
      .select({ b: bookings, u: users, fl: fromLoc, tl: toLoc, departsAt: trips.departsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .leftJoin(users, eq(users.id, bookings.bookedBy))
      .leftJoin(fromLoc, eq(fromLoc.id, bookings.fromLocalityId))
      .leftJoin(toLoc, eq(toLoc.id, bookings.toLocalityId));
  const up = await select()
    .where(and(eq(bookings.bookedBy, userId), inArray(bookings.status, ACTIVE_BOOKING)))
    .orderBy(asc(trips.departsAt))
    .limit(10);
  const past = await select()
    .where(and(eq(bookings.bookedBy, userId), inArray(bookings.status, ['completed', 'cancelled', 'no_show', 'declined'])))
    .orderBy(desc(trips.departsAt))
    .limit(5);
  const map = (rows: (Joined & { departsAt: Date })[]) =>
    rows.map((r) => ({ booking: toView(r), departsAt: r.departsAt.toISOString() }));
  return { upcoming: map(up), past: map(past) };
}

export interface NewBooking {
  tripId: number;
  bookedBy: number;
  passenger: { name: string; phone: string; type: PassengerType };
  from: PlaceInput;
  to: PlaceInput;
  pickupPoint?: string | null;
  seats: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote?: string | null;
  comment?: string | null;
  /** Бронь из заявки, которую взял водитель: сразу принята. */
  fromRequestId?: number;
  preAccepted?: boolean;
}

export type BookingFailure = 'no_seats' | 'own_trip' | 'duplicate' | 'blocked';

/** Забрать места у рейса. Вернёт false, если мест уже нет или рейс недоступен. */
async function holdSeats(tx: Pick<typeof app.db, 'update'>, tripId: number, seats: number): Promise<boolean> {
  const res = await tx
    .update(trips)
    .set({ seatsFree: sql`${trips.seatsFree} - ${seats}` })
    .where(and(eq(trips.id, tripId), eq(trips.status, 'published'), gte(trips.seatsFree, seats), gt(trips.departsAt, now())))
    .returning({ id: trips.id });
  return res.length > 0;
}

async function releaseSeats(tx: Pick<typeof app.db, 'update'>, tripId: number, seats: number): Promise<void> {
  await tx
    .update(trips)
    .set({ seatsFree: sql`least(${trips.seatsTotal}, ${trips.seatsFree} + ${seats})` })
    .where(eq(trips.id, tripId));
}

async function nextOrder(tx: Pick<typeof app.db, 'select'>, tripId: number): Promise<number> {
  const [row] = await tx
    .select({ m: sql<number>`coalesce(max(${bookings.pickupOrder}), 0)::int` })
    .from(bookings)
    .where(eq(bookings.tripId, tripId));
  return (row?.m ?? 0) + 1;
}

export async function createBooking(
  input: NewBooking,
): Promise<{ ok: true; booking: BookingView; needsAdmin: boolean } | { ok: false; reason: BookingFailure }> {
  const booker = await getUser(input.bookedBy);
  if (!booker || booker.restriction === 'blocked') return { ok: false, reason: 'blocked' };
  const [trip] = await app.db.select().from(trips).where(eq(trips.id, input.tripId));
  if (!trip) return { ok: false, reason: 'no_seats' };
  if (trip.driverId === input.bookedBy) return { ok: false, reason: 'own_trip' };

  const [dup] = await app.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tripId, input.tripId),
        eq(bookings.bookedBy, input.bookedBy),
        eq(bookings.passengerPhone, input.passenger.phone),
        inArray(bookings.status, ACTIVE_BOOKING),
      ),
    );
  if (dup) return { ok: false, reason: 'duplicate' };

  const needsAdmin = !input.preAccepted && (await needsAdminApproval(booker));
  const passengerUser =
    input.passenger.phone === booker.phone ? booker : await getUserByPhone(input.passenger.phone);
  const status: BookingStatus = input.preAccepted ? 'accepted' : needsAdmin ? 'pending_admin' : 'pending';

  const id = await app.db.transaction(async (tx) => {
    if (!(await holdSeats(tx, input.tripId, input.seats))) return null;
    const [row] = await tx
      .insert(bookings)
      .values({
        tripId: input.tripId,
        bookedBy: input.bookedBy,
        passengerUserId: passengerUser?.id ?? null,
        passengerName: input.passenger.name,
        passengerPhone: input.passenger.phone,
        passengerType: input.passenger.type,
        source: input.fromRequestId ? 'request' : 'bot',
        requestId: input.fromRequestId ?? null,
        fromLocalityId: input.from.localityId,
        fromAddress: input.from.address,
        fromLat: input.from.lat ?? null,
        fromLon: input.from.lon ?? null,
        toLocalityId: input.to.localityId,
        toAddress: input.to.address,
        toLat: input.to.lat ?? null,
        toLon: input.to.lon ?? null,
        pickupPoint: input.pickupPoint ?? null,
        seats: input.seats,
        childSeat: input.childSeat,
        baggage: input.baggage,
        baggageNote: input.baggageNote ?? null,
        comment: input.comment ?? null,
        price: trip.price * input.seats,
        prepayRequired: input.baggage === 'many',
        status,
        acceptedAt: input.preAccepted ? now() : null,
        createdAt: now(),
        pickupOrder: await nextOrder(tx, input.tripId),
      })
      .returning({ id: bookings.id });
    return row!.id;
  });
  if (id === null) return { ok: false, reason: 'no_seats' };
  return { ok: true, booking: (await getBooking(id))!, needsAdmin };
}

/** Смена статуса с проверкой текущего: защищает от двойных нажатий и устаревших кнопок. */
async function transition(
  id: number,
  from: BookingStatus[],
  set: Partial<typeof bookings.$inferInsert>,
  extra?: ReturnType<typeof eq>,
): Promise<BookingRow | undefined> {
  const [row] = await app.db
    .update(bookings)
    .set(set)
    .where(and(eq(bookings.id, id), inArray(bookings.status, from), extra))
    .returning();
  return row;
}

export async function acceptBooking(id: number): Promise<boolean> {
  return !!(await transition(id, ['pending'], { status: 'accepted', acceptedAt: now() }));
}

export async function adminApproveBooking(id: number): Promise<boolean> {
  return !!(await transition(id, ['pending_admin'], { status: 'pending' }));
}

/** Отказ водителя или админа. Места возвращаются в рейс. */
export async function declineBooking(id: number): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ status: 'declined', cancelledAt: now() })
      .where(and(eq(bookings.id, id), inArray(bookings.status, ['pending', 'pending_admin'])))
      .returning();
    if (!row) return false;
    await releaseSeats(tx, row.tripId, row.seats);
    return true;
  });
}

export interface CancelResult {
  late: boolean;
  /** Сколько поздних отмен и неявок у заказчика за период — после этой отмены. */
  violations: number;
  limit: number;
}

/**
 * Отмена брони. Для пассажира: больше чем за late_cancel_hours до выезда — свободно,
 * позже и после подтверждения водителем — «поздняя отмена», она остаётся в истории.
 */
export async function cancelBooking(id: number, by: CancelledBy): Promise<CancelResult | null> {
  const s = await loadSettings();
  const row = await app.db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ b: bookings, departsAt: trips.departsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(eq(bookings.id, id));
    if (!cur || !CANCELLABLE.includes(cur.b.status)) return null;
    const hoursLeft = (cur.departsAt.getTime() - now().getTime()) / 3_600_000;
    const wasAccepted = cur.b.status === 'accepted' || cur.b.status === 'confirmed';
    const late = by === 'passenger' && wasAccepted && hoursLeft < s.late_cancel_hours;
    const [upd] = await tx
      .update(bookings)
      .set({ status: 'cancelled', cancelledBy: by, lateCancel: late, cancelledAt: now() })
      .where(and(eq(bookings.id, id), inArray(bookings.status, CANCELLABLE)))
      .returning();
    if (!upd) return null;
    await releaseSeats(tx, upd.tripId, upd.seats);
    return upd;
  });
  if (!row) return null;
  const violations = row.bookedBy ? await countViolations(row.bookedBy) : 0;
  return { late: row.lateCancel, violations, limit: s.violations_limit };
}

export async function confirmBooking(id: number): Promise<boolean> {
  return !!(await transition(id, ['accepted'], { status: 'confirmed', confirmedAt: now() }));
}

export async function pickUpBooking(id: number): Promise<boolean> {
  return !!(await transition(id, ['accepted', 'confirmed'], { status: 'picked_up', pickedUpAt: now() }));
}

export async function noShowBooking(id: number): Promise<CancelResult | null> {
  const row = await transition(id, ['accepted', 'confirmed'], { status: 'no_show', completedAt: now() });
  if (!row) return null;
  const s = await loadSettings();
  return { late: false, violations: row.bookedBy ? await countViolations(row.bookedBy) : 0, limit: s.violations_limit };
}

export async function markPrepaid(id: number): Promise<boolean> {
  const [row] = await app.db
    .update(bookings)
    .set({ prepayReceivedAt: now() })
    .where(and(eq(bookings.id, id), eq(bookings.prepayRequired, true), isNull(bookings.prepayReceivedAt)))
    .returning({ id: bookings.id });
  return !!row;
}

/** «+ Занято по телефону»: места уходят из поиска одним нажатием, данные — потом по желанию. */
export async function createPhoneBooking(tripId: number, driverId: number, seats: number): Promise<number | null> {
  return app.db.transaction(async (tx) => {
    const [trip] = await tx.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.driverId, driverId)));
    if (!trip) return null;
    if (!(await holdSeats(tx, tripId, seats))) return null;
    const [row] = await tx
      .insert(bookings)
      .values({
        tripId,
        seats,
        source: 'phone',
        status: 'accepted',
        acceptedAt: now(),
        price: trip.price * seats,
        pickupOrder: await nextOrder(tx, tripId),
      })
      .returning({ id: bookings.id });
    return row!.id;
  });
}

export async function setPhoneBookingData(id: number, name: string, phone: string): Promise<boolean> {
  const user = await getUserByPhone(phone);
  const [row] = await app.db
    .update(bookings)
    .set({ passengerName: name, passengerPhone: phone, passengerUserId: user?.id ?? null })
    .where(and(eq(bookings.id, id), eq(bookings.source, 'phone')))
    .returning({ id: bookings.id });
  return !!row;
}

/** Порядок объезда водитель правит сам: поднимает пассажира на одну позицию выше. */
export async function moveBookingUp(id: number): Promise<void> {
  const [cur] = await app.db.select().from(bookings).where(eq(bookings.id, id));
  if (!cur) return;
  const list = await app.db
    .select({ id: bookings.id, pickupOrder: bookings.pickupOrder })
    .from(bookings)
    .where(and(eq(bookings.tripId, cur.tripId), inArray(bookings.status, ACTIVE_BOOKING)))
    .orderBy(asc(bookings.pickupOrder), asc(bookings.id));
  const i = list.findIndex((b) => b.id === id);
  if (i <= 0) return;
  const ordered = list.map((b) => b.id);
  [ordered[i - 1], ordered[i]] = [ordered[i]!, ordered[i - 1]!];
  await app.db.transaction(async (tx) => {
    for (const [n, bid] of ordered.entries()) {
      await tx.update(bookings).set({ pickupOrder: n + 1 }).where(eq(bookings.id, bid));
    }
  });
}

// ——— Выборки для фоновых задач ———

/** Кому пора задать вопрос «Едете сегодня?» */
export async function dueConfirmAsks(): Promise<number[]> {
  const s = await loadSettings();
  const until = new Date(now().getTime() + s.confirm_ask_hours * 3_600_000);
  const rows = await app.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.status, 'accepted'),
        isNull(bookings.askSentAt),
        inArray(bookings.source, ['bot', 'request']),
        eq(trips.status, 'published'),
        lte(trips.departsAt, until),
        gt(trips.departsAt, now()),
      ),
    );
  return rows.map((r) => r.id);
}

export async function markAskSent(id: number): Promise<void> {
  await app.db.update(bookings).set({ askSentAt: now() }).where(eq(bookings.id, id));
}

/** Пассажир не ответил на «Едете?» — пора сообщить водителю. */
export async function dueNoAnswer(): Promise<number[]> {
  const s = await loadSettings();
  const before = new Date(now().getTime() - s.confirm_wait_minutes * 60_000);
  const rows = await app.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.status, 'accepted'),
        lte(bookings.askSentAt, before),
        isNull(bookings.noAnswerNotifiedAt),
        eq(trips.status, 'published'),
      ),
    );
  return rows.map((r) => r.id);
}

export async function markNoAnswerNotified(id: number): Promise<void> {
  await app.db.update(bookings).set({ noAnswerNotifiedAt: now() }).where(eq(bookings.id, id));
}

/** Предоплаты за багаж нет, а до выезда осталось мало — водитель вправе отменить бронь. */
export async function duePrepayWarnings(): Promise<number[]> {
  const s = await loadSettings();
  const until = new Date(now().getTime() + s.prepay_deadline_hours * 3_600_000);
  const rows = await app.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inArray(bookings.status, ['accepted', 'confirmed']),
        eq(bookings.prepayRequired, true),
        isNull(bookings.prepayReceivedAt),
        isNull(bookings.prepayWarnedAt),
        eq(trips.status, 'published'),
        lte(trips.departsAt, until),
        gt(trips.departsAt, now()),
      ),
    );
  return rows.map((r) => r.id);
}

export async function markPrepayWarned(id: number): Promise<void> {
  await app.db.update(bookings).set({ prepayWarnedAt: now() }).where(eq(bookings.id, id));
}

/** Брони, ждущие решения админа. */
export async function listPendingAdminBookings(): Promise<BookingView[]> {
  const rows = await baseSelect().where(eq(bookings.status, 'pending_admin')).orderBy(asc(bookings.id)).limit(20);
  return rows.map(toView);
}
