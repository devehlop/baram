import { app } from '../app.js';
import { log } from '../logger.js';

/**
 * Картинки из Telegram для Mini App: фото машины из анкеты водителя.
 * В базе лежат только file_id. Сами файлы скачиваются через Bot API и держатся в памяти:
 * ссылка на файл содержит токен бота, поэтому наружу отдаём байты, а не ссылку.
 */

export interface Image {
  bytes: Uint8Array;
  type: string;
}

/** Сколько байт картинок держать в памяти. Фото машины — 100–300 КБ. */
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
/** Файл не скачался — не пробуем снова каждую секунду. */
const FAIL_TTL_MS = 5 * 60_000;

const files = new Map<string, { img: Image | null; at: number }>();
let cachedBytes = 0;
const pending = new Map<string, Promise<Image | null>>();

function remember(fileId: string, img: Image | null): void {
  const old = files.get(fileId);
  if (old?.img) cachedBytes -= old.img.bytes.length;
  files.delete(fileId);
  files.set(fileId, { img, at: Date.now() });
  if (img) cachedBytes += img.bytes.length;
  // Самые давние — первые в Map: их и выкидываем.
  for (const [key, v] of files) {
    if (cachedBytes <= MAX_CACHE_BYTES) break;
    if (v.img) cachedBytes -= v.img.bytes.length;
    files.delete(key);
  }
}

async function download(fileId: string): Promise<Image | null> {
  try {
    const f = await app.api.getFile(fileId);
    if (!f.file_path) return null;
    const root = app.api.options?.apiRoot ?? 'https://api.telegram.org';
    const doFetch = app.api.options?.fetch ?? fetch;
    const res = await doFetch(`${root}/file/bot${app.api.token}/${f.file_path}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const header = res.headers.get('content-type') ?? '';
    // Telegram отдаёт фото как application/octet-stream; фото из Telegram всегда JPEG.
    const type = header.startsWith('image/') ? header : 'image/jpeg';
    return { bytes, type };
  } catch (err) {
    log.warn({ err }, 'Не удалось скачать файл из Telegram');
    return null;
  }
}

/** Файл по file_id. null — файла нет или Telegram его не отдал. */
export async function getImage(fileId: string): Promise<Image | null> {
  const hit = files.get(fileId);
  if (hit && (hit.img || Date.now() - hit.at < FAIL_TTL_MS)) {
    // Свежее использование — в конец очереди на вылет.
    files.delete(fileId);
    files.set(fileId, hit);
    return hit.img;
  }
  const running = pending.get(fileId);
  if (running) return running;
  const p = download(fileId).then((img) => {
    remember(fileId, img);
    pending.delete(fileId);
    return img;
  });
  pending.set(fileId, p);
  return p;
}

/** Для тестов: забыть всё скачанное. */
export function clearImageCache(): void {
  files.clear();
  pending.clear();
  cachedBytes = 0;
}
