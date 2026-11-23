import { t } from '../i18n.js';
import { now } from '../lib/time.js';
import { getTrip, type TripView } from '../services/trips.js';
import { kb, send } from './tg.js';
import { tripCard } from './ui/cards.js';

/** Рейс ещё можно забронировать: выложен, не уехал, есть места. */
export function bookable(trip: TripView, seats = 1): boolean {
  return trip.status === 'published' && trip.seatsFree >= seats && new Date(trip.departsAt) > now();
}

/**
 * Человек открыл ссылку на рейс (из объявления водителя в чате или из поста канала):
 * карточка рейса и «Еду с ним». Рейс ушёл или мест нет — предлагаем поискать другие.
 */
export async function sendTripLanding(chatId: number, tripId: number, viewerId: number): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || !bookable(trip)) {
    await send(chatId, t('landing-trip-unavailable'), kb([[{ text: t('menu-find'), data: 'p:find' }]]));
    return;
  }
  if (trip.driverId === viewerId) {
    await send(chatId, `${t('landing-own-trip')}\n\n${tripCard(trip)}`);
    return;
  }
  await send(
    chatId,
    `${t('landing-trip-title')}\n\n${tripCard(trip)}`,
    kb([
      [{ text: t('btn-book-this-trip'), data: `p:bt:${trip.id}` }],
      [{ text: t('btn-other-trips'), data: 'p:find' }],
    ]),
  );
}
