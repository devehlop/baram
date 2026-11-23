import { app } from '../app.js';
import { getTrip } from './trips.js';

/**
 * Ссылки t.me/<бот>?start=<метка>. Telegram пропускает в метке до 64 символов: латиницу, цифры, _ и -.
 *
 * - `s_<код>` — метка источника: пост друга, объявление с QR, паблик, реклама (`s_aigul`, `s_qr_avtovokzal`).
 * - `t_<id>` — рейс, которым поделился водитель (объявление в чате попутчиков).
 * - `c_<id>` — рейс из сводного поста канала.
 */
export type StartLink =
  | { kind: 'source'; code: string }
  | { kind: 'trip'; tripId: number; via: 'share' | 'channel' };

/** Источник для пользователей, пришедших по кнопке под постом канала. */
export const CHANNEL_SOURCE = 'channel';
/** Префикс источника «рейс водителя»: drv_<id водителя>. */
export const DRIVER_SOURCE_PREFIX = 'drv_';

const SOURCE_RE = /^s_([a-z0-9][a-z0-9_-]{0,39})$/i;
const TRIP_RE = /^([tc])_(\d{1,9})$/;

export function parseStartLink(payload: string | null | undefined): StartLink | null {
  const p = payload?.trim();
  if (!p) return null;
  const src = SOURCE_RE.exec(p);
  if (src) return { kind: 'source', code: src[1]!.toLowerCase() };
  const trip = TRIP_RE.exec(p);
  if (trip) return { kind: 'trip', tripId: Number(trip[2]), via: trip[1] === 't' ? 'share' : 'channel' };
  return null;
}

/** Метка из текста «/start <метка>»; для обычного /start и любого другого текста — null. */
export function startPayloadOf(text: string | undefined): string | null {
  const m = /^\/start(?:@\w+)?\s+(\S{1,64})\s*$/.exec(text ?? '');
  return m ? m[1]! : null;
}

/** Ссылка на бота с меткой. Без имени бота (не запущен) — null. */
export function botLink(payload?: string): string | null {
  if (!app.botUsername) return null;
  return `https://t.me/${app.botUsername}${payload ? `?start=${payload}` : ''}`;
}

export const tripShareLink = (tripId: number) => botLink(`t_${tripId}`);
export const tripChannelLink = (tripId: number) => botLink(`c_${tripId}`);

/**
 * Во что превращается метка при регистрации:
 * код друга — как есть, рейс водителя — drv_<id водителя> (видно, кто из водителей приводит людей),
 * рейс из канала — channel.
 */
export async function sourceOf(payload: string | null | undefined): Promise<string | null> {
  const link = parseStartLink(payload);
  if (!link) return null;
  if (link.kind === 'source') return link.code;
  if (link.via === 'channel') return CHANNEL_SOURCE;
  const trip = await getTrip(link.tripId);
  return trip ? `${DRIVER_SOURCE_PREFIX}${trip.driverId}` : null;
}
