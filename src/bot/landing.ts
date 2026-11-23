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
 * карточка рейса и «Еду с ним». Рейс ушёл или мест нет — объясняем и предлагаем поискать другие.
 */
export async function sendTripLanding(chatId: number, tripId: number, viewerId: number): Promise<void> {
  const trip = await getTrip(tripId);
  const others = [{ text: t('btn-other-trips'), data: 'p:find' }];
  if (!trip || trip.status !== 'published' || new Date(trip.departsAt) <= now()) {
    await send(chatId, t('landing-trip-unavailable'), kb([others]));
    return;
  }
  if (trip.driverId === viewerId) {
    await send(chatId, `${t('landing-own-trip')}\n\n${tripCard(trip)}`, kb([[{ text: t('btn-open-trip'), data: `d:t:${trip.id}` }]]));
    return;
  }
  if (!bookable(trip)) {
    // Рейс ещё в силе, но мест нет: карточку показываем, чтобы человек понял, о чём речь.
    await send(chatId, `${tripCard(trip)}\n\n${t('landing-trip-full')}`, kb([others]));
    return;
  }
  await send(
    chatId,
    `${t('landing-trip-title')}\n\n${tripCard(trip)}`,
    kb([
      [{ text: t('btn-book-this-trip'), data: `p:bt:${trip.id}` }],
      others,
    ]),
  );
}
