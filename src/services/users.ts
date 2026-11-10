import { and, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { app } from '../app.js';
import { bookings, users, type Restriction, type Role, type UserRow } from '../db/schema.js';
import { now } from '../lib/time.js';
import { loadSettings } from './settings.js';

export async function getUserByTg(telegramId: number): Promise<UserRow | undefined> {
  const [row] = await app.db.select().from(users).where(eq(users.telegramId, telegramId));
  return row;
}

export async function getUser(id: number): Promise<UserRow | undefined> {
  const [row] = await app.db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function getUserByPhone(phone: string): Promise<UserRow | undefined> {
  const [row] = await app.db.select().from(users).where(eq(users.phone, phone));
  return row;
}

export async function createUser(input: {
  telegramId: number;
  username?: string | null;
  name: string;
  phone: string;
  role: Role;
}): Promise<UserRow> {
  const [row] = await app.db
    .insert(users)
    .values({
      telegramId: input.telegramId,
      username: input.username ?? null,
      name: input.name,
      phone: input.phone,
      activeRole: input.role,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { name: input.name, phone: input.phone, username: input.username ?? null },
    })
    .returning();
  return row!;
}

export async function setActiveRole(userId: number, role: Role): Promise<void> {
  await app.db.update(users).set({ activeRole: role }).where(eq(users.id, userId));
}

export async function setRestriction(userId: number, restriction: Restriction, reason?: string | null): Promise<void> {
  await app.db
    .update(users)
    .set({ restriction, restrictionReason: restriction === 'none' ? null : (reason ?? null) })
    .where(eq(users.id, userId));
}

/** Поиск для админа: по Telegram ID, по цифрам телефона или по имени. */
export async function findUsers(query: string): Promise<UserRow[]> {
  const q = query.trim();
  const digits = q.replace(/\D/g, '');
  const conds = [ilike(users.name, `%${q}%`)];
  if (digits.length >= 4) {
    conds.push(ilike(users.phone, `%${digits.slice(-10)}%`));
    if (digits.length <= 15) conds.push(eq(users.telegramId, Number(digits)));
  }
  if (q.startsWith('@') && q.length > 1) conds.push(ilike(users.username, q.slice(1)));
  return app.db
    .select()
    .from(users)
    .where(or(...conds))
    .limit(8);
}

/** Поздние отмены и неявки заказчика за период (по умолчанию 30 дней). */
export async function countViolations(userId: number): Promise<number> {
  const s = await loadSettings();
  const since = new Date(now().getTime() - s.violations_period_days * 86_400_000);
  const [row] = await app.db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.bookedBy, userId),
        or(
          and(eq(bookings.status, 'no_show'), gte(bookings.completedAt, since)),
          and(
            eq(bookings.status, 'cancelled'),
            eq(bookings.cancelledBy, 'passenger'),
            eq(bookings.lateCancel, true),
            gte(bookings.cancelledAt, since),
          ),
        ),
      ),
    );
  return row?.n ?? 0;
}

/** Бронь этого человека должна пройти через админа? */
export async function needsAdminApproval(user: Pick<UserRow, 'id' | 'restriction'>): Promise<boolean> {
  if (user.restriction === 'admin_approval') return true;
  const s = await loadSettings();
  return (await countViolations(user.id)) >= s.violations_limit;
}

export async function userStats(userId: number): Promise<{ completed: number; noShows: number; lateCancels: number }> {
  const [row] = await app.db
    .select({
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
      noShows: sql<number>`count(*) filter (where ${bookings.status} = 'no_show')::int`,
      lateCancels: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled' and ${bookings.cancelledBy} = 'passenger' and ${bookings.lateCancel})::int`,
    })
    .from(bookings)
    .where(eq(bookings.bookedBy, userId));
  return { completed: row?.completed ?? 0, noShows: row?.noShows ?? 0, lateCancels: row?.lateCancels ?? 0 };
}
