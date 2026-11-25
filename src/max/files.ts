import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { maxFiles } from '../db/schema.js';
import { log } from '../logger.js';
import { getImage, type Image } from '../services/photos.js';

/**
 * Фото между платформами. В базе фото — строка: file_id Telegram или «max:<токен>» для фото из MAX.
 *
 * - Фото из MAX: ссылка на файл у MAX временная. Её запоминаем при получении, а когда фото
 *   сохраняют в анкету, байты скачиваются в таблицу max_files (см. keepMaxPhotos).
 * - Фото из Telegram для человека в MAX скачивается через Bot API и загружается в MAX.
 */

export const MAX_REF = 'max:';

export function isMaxRef(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(MAX_REF);
}

const urls = new Map<string, string>();

/** Фото пришло в MAX: запомнить, откуда его скачать. */
export function rememberMaxImage(token: string, url: string | undefined): void {
  if (!url) return;
  if (urls.size > 5000) urls.delete(urls.keys().next().value!);
  urls.set(token, url);
}

/** Байты фото из MAX: из базы или, пока ссылка жива, из MAX (и сразу в базу). */
export async function loadMaxImage(token: string): Promise<Image | null> {
  const [row] = await app.db.select().from(maxFiles).where(eq(maxFiles.token, token));
  if (row) return { bytes: row.bytes, type: row.type };
  const url = urls.get(token);
  if (!url) return null;
  try {
    const res = await (app.max?.fetch ?? fetch)(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const header = res.headers.get('content-type') ?? '';
    const type = header.startsWith('image/') ? header : 'image/jpeg';
    await app.db.insert(maxFiles).values({ token, bytes, type }).onConflictDoNothing();
    return { bytes, type };
  } catch (err) {
    log.warn({ err }, 'MAX: не удалось скачать фото');
    return null;
  }
}

/** Сохранить у себя фото из MAX, пока ссылки на них живы. Вызывается, когда фото записываются в анкету. */
export async function keepMaxPhotos(ids: string[]): Promise<void> {
  await Promise.all(ids.filter(isMaxRef).map((id) => getImage(id)));
}

const uploaded = new Map<string, string>();

/** Токен картинки в MAX для любого фото из базы. null — фото не нашлось. */
export async function maxImageToken(ref: string): Promise<string | null> {
  if (isMaxRef(ref)) return ref.slice(MAX_REF.length);
  const hit = uploaded.get(ref);
  if (hit) return hit;
  const img = await getImage(ref);
  if (!img || !app.max) return null;
  const token = await app.max.uploadImage(img.bytes, img.type);
  if (uploaded.size > 5000) uploaded.delete(uploaded.keys().next().value!);
  uploaded.set(ref, token);
  return token;
}

/** Для тестов. */
export function clearMaxFiles(): void {
  urls.clear();
  uploaded.clear();
}
