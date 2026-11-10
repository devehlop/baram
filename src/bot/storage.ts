import type { ConversationData, VersionedState } from '@grammyjs/conversations';
import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { conversationStates } from '../db/schema.js';
import { now } from '../lib/time.js';

type State = VersionedState<ConversationData>;

/** Незаконченные сценарии хранятся в PostgreSQL: перезапуск бота не сбрасывает шаг пользователя. */
export const conversationStorage = {
  async read(key: string): Promise<State | undefined> {
    const [row] = await app.db.select().from(conversationStates).where(eq(conversationStates.key, key));
    return row ? (row.data as State) : undefined;
  },
  async write(key: string, state: State): Promise<void> {
    await app.db
      .insert(conversationStates)
      .values({ key, data: state, updatedAt: now() })
      .onConflictDoUpdate({ target: conversationStates.key, set: { data: state, updatedAt: now() } });
  },
  async delete(key: string): Promise<void> {
    await app.db.delete(conversationStates).where(eq(conversationStates.key, key));
  },
};

/**
 * После обновления кода незаконченные сценарии сбрасываются: плагин проигрывает сценарий заново
 * по записанным шагам, и изменившийся код может с ними не совпасть.
 */
export async function clearConversations(): Promise<void> {
  await app.db.delete(conversationStates);
}
