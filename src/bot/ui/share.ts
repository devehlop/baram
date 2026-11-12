import { app } from '../../app.js';
import { t } from '../../i18n.js';
import { fmtPhone, money } from '../../lib/format.js';
import { addDays, dayKey, fmtDayKey, fmtTime, todayKey } from '../../lib/time.js';
import type { TripView } from '../../services/trips.js';
import type { Btn } from '../tg.js';

/** Ссылка на рейс в боте: пассажир нажимает её в чате и сразу попадает к карточке рейса. */
export function tripLink(tripId: number): string | null {
  return app.botUsername ? `https://t.me/${app.botUsername}?start=t_${tripId}` : null;
}

/** Номер рейса из параметра /start («t_123»). */
export function parseTripPayload(payload: string | undefined): number | null {
  const m = /^t_(\d{1,9})$/.exec((payload ?? '').trim());
  return m ? Number(m[1]) : null;
}

function whenLine(trip: TripView): string {
  const day = dayKey(trip.departsAt);
  const date = fmtDayKey(day);
  const label = day === todayKey() ? t('day-today') : day === addDays(todayKey(), 1) ? t('day-tomorrow') : null;
  // «Завтра, 13 ноября» вместо «Завтра, пт, 13 ноября».
  const when = label ? `${label}, ${date.split(', ')[1] ?? date}` : date;
  return `🕔 ${when} · ${fmtTime(trip.departsAt)}`;
}

function pickupText(trip: TripView): string {
  const points = trip.pickupPoints.join(', ');
  if (trip.pickupMode === 'door') return t('share-pickup-door');
  return t(trip.pickupMode === 'points' ? 'share-pickup-points' : 'share-pickup-mixed', { points });
}

/**
 * Объявление для чата в привычном для чатов виде: коротко, с эмодзи, с номером или без.
 * Строки идут по важности: если ссылка для Telegram получится слишком длинной,
 * лишнее отбрасывается с конца, а главное (маршрут, время, места, цена) остаётся.
 */
export function shareLines(trip: TripView, withPhone: boolean): string[] {
  const d = trip.driver;
  return [
    t('share-title', { route: trip.route }),
    whenLine(trip),
    `📍 ${pickupText(trip)}`,
    `💺 ${t('share-seats-price', { seats: t('seats-count', { n: trip.seatsFree }), price: money(trip.price) })}`,
    withPhone && `📞 ${fmtPhone(d.phone)}`,
    `🧳 ${t(`trunk-${trip.trunk}`)}`,
    trip.villages && `🏡 ${t('share-villages')}`,
    d.childSeat && `👶 ${t('trip-child-seat-yes')}`,
    t('share-cta'),
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Кнопка «Поделиться» у Telegram держит ссылку не длиннее ~2000 символов, а кириллица в ней — по 6 на букву. */
const MAX_URL = 1900;
/** Сколько строк с начала нельзя отбрасывать: маршрут, время, самовывоз, места и цена. */
const KEEP = 4;

export function shareUrl(trip: TripView, withPhone: boolean): string | null {
  const link = tripLink(trip.id);
  if (!link) return null;
  const lines = shareLines(trip, withPhone);
  const build = () =>
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(lines.join('\n'))}`;
  let url = build();
  // Сначала убираем необязательное с конца.
  while (url.length > MAX_URL && lines.length > KEEP + (withPhone ? 1 : 0)) {
    lines.splice(lines.length - 1, 1);
    url = build();
  }
  return url.length <= MAX_URL ? url : null;
}

/** Две кнопки «Поделиться в чате»: с телефоном и без. Для рейса, который уже нельзя забронировать, их нет. */
export function shareRows(trip: TripView): Btn[][] {
  if (trip.status !== 'published' || trip.seatsFree <= 0) return [];
  const rows: Btn[][] = [];
  const withPhone = shareUrl(trip, true);
  const without = shareUrl(trip, false);
  if (withPhone) rows.push([{ text: t('btn-share-phone'), url: withPhone }]);
  if (without) rows.push([{ text: t('btn-share-nophone'), url: without }]);
  return rows;
}
