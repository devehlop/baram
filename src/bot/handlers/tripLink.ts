import { t } from '../../i18n.js';
import { now } from '../../lib/time.js';
import { getTrip } from '../../services/trips.js';
import type { UserRow } from '../../db/schema.js';
import { kb, send } from '../tg.js';
import { tripCard } from '../ui/cards.js';

/**
 * Человек пришёл по ссылке на рейс, но ещё не зарегистрирован. Запоминаем рейс,
 * пока он проходит регистрацию, и показываем его сразу после. Хранится в памяти:
 * потеря при перезапуске бота безвредна — человек просто увидит обычное меню.
 */
const pending = new Map<number, number>();

export function rememberTripLink(telegramId: number, tripId: number): void {
  pending.set(telegramId, tripId);
}

export function takeTripLink(telegramId: number): number | undefined {
  const id = pending.get(telegramId);
  pending.delete(telegramId);
  return id;
}

/** Карточка рейса по ссылке из чата: рейс, кнопка «Забронировать место» или объяснение, почему нельзя. */
export async function sendTripLink(chatId: number, user: Pick<UserRow, 'id'>, tripId: number): Promise<void> {
  const trip = await getTrip(tripId);
  const gone = !trip || trip.status !== 'published' || new Date(trip.departsAt) <= now();
  const search = [{ text: t('btn-other-trips'), data: 'p:find' }];
  if (gone) {
    await send(chatId, t('link-trip-gone'), kb([search]));
    return;
  }
  if (trip.driverId === user.id) {
    await send(chatId, `${tripCard(trip, { own: true })}\n\n${t('link-own-trip')}`, kb([[{ text: t('btn-open-trip'), data: `d:t:${trip.id}` }]]));
    return;
  }
  if (trip.seatsFree <= 0) {
    await send(chatId, `${tripCard(trip)}\n\n${t('link-trip-full')}`, kb([search]));
    return;
  }
  await send(chatId, tripCard(trip), kb([[{ text: t('btn-book-trip'), data: `p:lb:${trip.id}` }], search]));
}
