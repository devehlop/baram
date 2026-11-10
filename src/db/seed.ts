import { pathToFileURL } from 'node:url';
import { app, initApp } from '../app.js';
import { seedSettings } from '../services/settings.js';
import { createDb } from './client.js';
import { directions, localities } from './schema.js';

/**
 * Первое заполнение базы: настройки по умолчанию и направление Буинск ⇄ Казань.
 * Повторный запуск безопасен: существующие данные не меняются.
 * Деревни добавляет админ в боте (Админ → Деревни).
 */
export async function seed(opts: { channelId?: string } = {}): Promise<void> {
  await seedSettings();
  const existing = await app.db.select({ id: directions.id }).from(directions).limit(1);
  if (existing.length > 0) return;
  const [dir] = await app.db
    .insert(directions)
    .values({ cityA: 'Буинск', cityB: 'Казань', travelMinutes: 120, channelId: opts.channelId || null })
    .returning();
  await app.db.insert(localities).values([
    { directionId: dir!.id, name: 'Буинск', kind: 'city', side: 'a' },
    { directionId: dir!.id, name: 'Казань', kind: 'city', side: 'b' },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL не задан');
    process.exit(1);
  }
  const { db, pool } = createDb(url);
  initApp({ db, api: undefined as never, adminIds: [] });
  await seed({ channelId: process.env.CHANNEL_ID });
  await pool.end();
  console.log('База заполнена начальными данными');
}
