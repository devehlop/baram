import type { Side } from '../db/schema.js';
import { addDays, dayEnd, dayStart, todayKey } from '../lib/time.js';
import { listDirections, routeLabel } from './directions.js';
import { loadSettings } from './settings.js';
import { findPublishedTrips, type TripView } from './trips.js';

/** Открытые рейсы на день по направлению и стороне: короткий поиск показывает их сразу после выбора дня. */

export interface BoardRoute {
  directionId: number;
  fromSide: Side;
  label: string;
}

/** Все маршруты: каждое направление в обе стороны («Буинск → Казань», «Казань → Буинск»). */
export async function listRoutes(): Promise<BoardRoute[]> {
  const out: BoardRoute[] = [];
  for (const d of await listDirections()) {
    for (const side of ['a', 'b'] as const) out.push({ directionId: d.id, fromSide: side, label: routeLabel(d, side) });
  }
  return out;
}

/** Рейсы, на которые ещё можно сесть: выложены, не уехали, есть хотя бы одно место. Сначала — с приоритетом. */
export async function openTrips(q: { directionId: number; fromSide: Side; day: string; seats?: number; excludeDriverId?: number }): Promise<TripView[]> {
  const list = await findPublishedTrips({
    directionId: q.directionId,
    fromSide: q.fromSide,
    from: dayStart(q.day),
    to: dayEnd(q.day),
    seats: q.seats ?? 1,
  });
  return list.filter((t) => t.driverId !== q.excludeDriverId);
}

/** Ближайший после day день, на который есть рейсы (в пределах горизонта), и их число. */
export async function nextDayWithTrips(q: { directionId: number; fromSide: Side; day: string; excludeDriverId?: number }): Promise<{ day: string; count: number } | null> {
  const s = await loadSettings();
  const last = addDays(todayKey(), s.trip_horizon_days);
  for (let d = addDays(q.day, 1); d <= last; d = addDays(d, 1)) {
    const list = await openTrips({ ...q, day: d });
    if (list.length) return { day: d, count: list.length };
  }
  return null;
}
