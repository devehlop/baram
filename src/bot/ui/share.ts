import { t } from '../../i18n.js';
import { money } from '../../lib/format.js';
import { fmtDateTime } from '../../lib/time.js';
import type { TripView } from '../../services/trips.js';

/**
 * Объявление о рейсе от лица водителя — для чатов попутчиков. Обычный текст без разметки:
 * его копируют, пересылают или передают в окно «Поделиться» Telegram.
 * Последняя строка — ссылка, по которой пассажир сразу попадает на этот рейс в боте.
 */
export function shareLines(trip: TripView): string[] {
  const points = trip.pickupPoints.join(', ');
  return [
    `🚗 ${fmtDateTime(trip.departsAt)} — ${trip.route}`,
    `${trip.driver.car}, ${t('share-seats', { n: trip.seatsFree })} · ${t('trip-price', { price: money(trip.price) })}`,
    `📍 ${trip.pickupMode === 'door' || !points ? t('share-pickup-door') : t(`share-pickup-${trip.pickupMode}`, { points })}`,
    trip.villages ? `🏡 ${t('share-villages')}` : '',
    trip.driver.childSeat ? `👶 ${t('trip-child-seat-yes')}` : '',
  ].filter(Boolean);
}

export function shareText(trip: TripView, link: string): string {
  return [...shareLines(trip), `${t('share-book')} ${link}`].join('\n');
}

/** Ссылку «Поделиться» Telegram длиннее ~2000 символов не открывает, а кириллица в ней — по 6 знаков на букву. */
const MAX_SHARE_URL = 1900;

/**
 * Окно «Поделиться» Telegram: человек выбирает чат, текст и ссылка уже вставлены.
 * Слишком длинный текст (много точек сбора) сокращается с конца, маршрут, время, места и цена остаются;
 * если и так не влезает — точки сбора заменяются общим «из точек».
 */
export function shareUrl(trip: TripView, link: string): string {
  const build = (lines: string[]) =>
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent([...lines, t('share-book-by-link')].join('\n'))}`;
  const lines = shareLines(trip);
  let url = build(lines);
  while (url.length > MAX_SHARE_URL && lines.length > 3) {
    lines.pop();
    url = build(lines);
  }
  if (url.length > MAX_SHARE_URL) url = build([...lines.slice(0, 2), `📍 ${t('share-pickup-points-short')}`]);
  return url;
}
