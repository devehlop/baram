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

/** Окно «Поделиться» Telegram: человек выбирает чат, текст и ссылка уже вставлены. */
export function shareUrl(trip: TripView, link: string): string {
  const text = [...shareLines(trip), t('share-book-by-link')].join('\n');
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
