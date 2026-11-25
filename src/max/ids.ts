import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { maxUsers } from '../db/schema.js';

/**
 * Весь бот считает людей по числовому id, как в Telegram: users.telegram_id, ключи сценариев,
 * ADMIN_IDS. Людям из MAX выдаются id из своего диапазона — от 2^52 и выше. Id в Telegram
 * не длиннее 52 бит, поэтому с ними номера из MAX не пересекаются, а до предела точных целых
 * чисел в JavaScript (2^53) остаётся место на 4,5 квадриллиона человек.
 */
export const MAX_ID_BASE = 2 ** 52;

/** Это человек (чат) из MAX, а не из Telegram. */
export function isMaxId(id: unknown): boolean {
  const n = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= MAX_ID_BASE;
}

const localByMax = new Map<string, number>();
const maxByLocal = new Map<number, string>();

function remember(maxUserId: string, local: number): number {
  if (localByMax.size > 20_000) {
    localByMax.clear();
    maxByLocal.clear();
  }
  localByMax.set(maxUserId, local);
  maxByLocal.set(local, maxUserId);
  return local;
}

/** Id внутри бота для пользователя MAX. При первом касании запись создаётся. */
export async function localIdOf(maxUserId: string): Promise<number> {
  const hit = localByMax.get(maxUserId);
  if (hit) return hit;
  const [created] = await app.db.insert(maxUsers).values({ maxUserId }).onConflictDoNothing().returning({ id: maxUsers.id });
  const row = created ?? (await app.db.select({ id: maxUsers.id }).from(maxUsers).where(eq(maxUsers.maxUserId, maxUserId)))[0];
  if (!row) throw new Error(`MAX: не удалось завести id для ${maxUserId}`);
  return remember(maxUserId, MAX_ID_BASE + row.id);
}

/** Id пользователя в MAX по id внутри бота. null — такого человека нет. */
export async function maxUserIdOf(localId: number): Promise<string | null> {
  const hit = maxByLocal.get(localId);
  if (hit) return hit;
  const [row] = await app.db
    .select({ maxUserId: maxUsers.maxUserId })
    .from(maxUsers)
    .where(eq(maxUsers.id, localId - MAX_ID_BASE));
  if (!row) return null;
  remember(row.maxUserId, localId);
  return row.maxUserId;
}

/** Для тестов: забыть закэшированные соответствия (база в каждом тесте новая). */
export function clearMaxIds(): void {
  localByMax.clear();
  maxByLocal.clear();
}
