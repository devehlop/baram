import { app } from '../app.js';
import { log } from '../logger.js';

/**
 * Картинки из Telegram для Mini App: фото машины из анкеты водителя и фото профиля.
 * В базе лежат только file_id. Сами файлы скачиваются через Bot API и держатся в памяти:
 * ссылка на файл содержит токен бота, поэтому наружу отдаём байты, а не ссылку.
 */

export interface Image {
  bytes: Uint8Array;
  type: string;
}

/** Сколько байт картинок держать в памяти. Фото машины — 100–300 КБ, аватарка — 10–20 КБ. */
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
/** Файл не скачался — не пробуем снова каждую секунду. */
const FAIL_TTL_MS = 5 * 60_000;
/** Фото профиля человек может сменить, поэтому file_id аватарки перепроверяем раз в несколько часов. */
const AVATAR_TTL_MS = 6 * 60 * 60_000;
const MAX_AVATARS = 5000;
/** Аватарка в Mini App — кружок 40–48 px; берём размер с запасом под плотные экраны. */
const AVATAR_MIN_SIDE = 160;

const files = new Map<string, { img: Image | null; at: number }>();
let cachedBytes = 0;
const pending = new Map<string, Promise<Image | null>>();
const avatars = new Map<number, { fileId: string | null; at: number }>();

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

/** file_id текущего фото профиля. null — фото нет или человек скрыл его настройками приватности. */
async function avatarFileId(telegramId: number): Promise<string | null> {
  const hit = avatars.get(telegramId);
  if (hit && Date.now() - hit.at < AVATAR_TTL_MS) return hit.fileId;
  let fileId: string | null = null;
  try {
    const res = await app.api.getUserProfilePhotos(telegramId, { limit: 1 });
    const sizes = res.photos[0] ?? [];
    fileId = (sizes.find((s) => Math.min(s.width, s.height) >= AVATAR_MIN_SIDE) ?? sizes[sizes.length - 1])?.file_id ?? null;
  } catch (err) {
    log.warn({ err }, 'Не удалось получить фото профиля');
  }
  avatars.delete(telegramId);
  avatars.set(telegramId, { fileId, at: Date.now() });
  if (avatars.size > MAX_AVATARS) avatars.delete(avatars.keys().next().value!);
  return fileId;
}

/** Фото профиля Telegram. */
export async function getAvatar(telegramId: number): Promise<Image | null> {
  const fileId = await avatarFileId(telegramId);
  return fileId ? getImage(fileId) : null;
}

/** Для тестов: забыть всё скачанное. */
export function clearImageCache(): void {
  files.clear();
  pending.clear();
  avatars.clear();
  cachedBytes = 0;
}
