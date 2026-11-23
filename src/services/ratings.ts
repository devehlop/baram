import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { app } from '../app.js';
import { bookings, ratings, trips, users, type RatingTarget } from '../db/schema.js';
import { now } from '../lib/time.js';
import { loadSettings } from './settings.js';
import { userStats } from './users.js';

/** Средняя оценка человека в одной роли. */
export interface RatingSummary {
  avg: number;
  count: number;
}

export type RateResult =
  | { ok: true; toUserId: number; before: RatingSummary; after: RatingSummary }
  | { ok: false; reason: 'not_found' | 'not_allowed' | 'already' };

/**
 * Оценить поездку. target = 'driver' — пассажир (заказчик брони) оценивает водителя;
 * target = 'passenger' — водитель оценивает заказчика. Только завершённые брони, одна оценка на сторону.
 */
export async function rateBooking(input: { bookingId: number; target: RatingTarget; fromUserId: number; stars: number }): Promise<RateResult> {
  const stars = Math.round(input.stars);
  if (stars < 1 || stars > 5) return { ok: false, reason: 'not_allowed' };
  const [row] = await app.db
    .select({ b: bookings, driverId: trips.driverId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(bookings.id, input.bookingId));
  if (!row) return { ok: false, reason: 'not_found' };
  const { b, driverId } = row;
  if (b.status !== 'completed' || b.source === 'phone' || b.bookedBy === null) return { ok: false, reason: 'not_allowed' };
  const [from, to] = input.target === 'driver' ? [b.bookedBy, driverId] : [driverId, b.bookedBy];
  if (from !== input.fromUserId || from === to) return { ok: false, reason: 'not_allowed' };

  const before = await ratingOf(to, input.target);
  const inserted = await app.db
    .insert(ratings)
    .values({ bookingId: b.id, target: input.target, fromUserId: from, toUserId: to, stars, createdAt: now() })
    .onConflictDoNothing()
    .returning({ id: ratings.id });
  if (inserted.length === 0) return { ok: false, reason: 'already' };
  return { ok: true, toUserId: to, before, after: await ratingOf(to, input.target) };
}

/** Комментарий к своей оценке: «что было не так». */
export async function setRatingComment(bookingId: number, target: RatingTarget, fromUserId: number, comment: string): Promise<boolean> {
  const res = await app.db
    .update(ratings)
    .set({ comment: comment.trim() })
    .where(and(eq(ratings.bookingId, bookingId), eq(ratings.target, target), eq(ratings.fromUserId, fromUserId)))
    .returning({ id: ratings.id });
  return res.length > 0;
}

export async function getRating(bookingId: number, target: RatingTarget) {
  const [row] = await app.db
    .select()
    .from(ratings)
    .where(and(eq(ratings.bookingId, bookingId), eq(ratings.target, target)));
  return row;
}

/** Какие из этих броней уже оценены с этой стороны. */
export async function ratedBookings(bookingIds: number[], target: RatingTarget): Promise<Set<number>> {
  if (bookingIds.length === 0) return new Set();
  const rows = await app.db
    .select({ id: ratings.bookingId })
    .from(ratings)
    .where(and(inArray(ratings.bookingId, bookingIds), eq(ratings.target, target)));
  return new Set(rows.map((r) => r.id));
}

export async function ratingsOf(userIds: number[], target: RatingTarget): Promise<Map<number, RatingSummary>> {
  const out = new Map<number, RatingSummary>();
  if (userIds.length === 0) return out;
  const rows = await app.db
    .select({
      userId: ratings.toUserId,
      avg: sql<number>`avg(${ratings.stars})::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(ratings)
    .where(and(inArray(ratings.toUserId, userIds), eq(ratings.target, target)))
    .groupBy(ratings.toUserId);
  for (const r of rows) out.set(r.userId, { avg: Number(r.avg), count: Number(r.count) });
  return out;
}

export async function ratingOf(userId: number, target: RatingTarget): Promise<RatingSummary> {
  return (await ratingsOf([userId], target)).get(userId) ?? { avg: 0, count: 0 };
}

/** Последние плохие оценки (1–3 ★) — для админа. */
export async function lowRatings(userId: number, target: RatingTarget, limit = 3) {
  return app.db
    .select({ stars: ratings.stars, comment: ratings.comment, createdAt: ratings.createdAt, fromName: users.name })
    .from(ratings)
    .innerJoin(users, eq(users.id, ratings.fromUserId))
    .where(and(eq(ratings.toUserId, userId), eq(ratings.target, target), lte(ratings.stars, 3)))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .limit(limit);
}

/** Отметки пассажира для водителя: поездки, неявки и оценка от водителей (если оценок хватает). */
export async function passengerMarks(userId: number) {
  const [st, r, s] = await Promise.all([userStats(userId), ratingOf(userId, 'passenger'), loadSettings()]);
  return { ...st, rating: r.count >= Math.max(1, s.rating_min_count) ? r : null };
}
