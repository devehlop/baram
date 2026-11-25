import { app } from '../app.js';
import { visitors } from '../db/schema.js';
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
