import type { Side, TimeKind } from '../db/schema.js';
import { addDays, dayEnd, dayStart, fromDayMinutes, now } from '../lib/time.js';
import { loadSettings } from './settings.js';
import { findPublishedTrips, type TripView } from './trips.js';

export interface SearchQuery {
  directionId: number;
  fromSide: Side;
  day: string;
  timeKind: TimeKind;
  exactMinutes?: number | null;
  seats: number;
  /** Нужно кресло водителя — такие рейсы показываем первыми. */
  needChildSeat?: boolean;
  /** Не показывать свои же рейсы. */
  excludeDriverId?: number;
}

export interface SearchResult {
  exact: TripView[];
  near: TripView[];
}

const PART_OF_DAY: Record<Exclude<TimeKind, 'exact'>, [number, number]> = {
  morning: [0, 12 * 60],
  day: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

/** Окно времени, в котором пассажир хочет выехать. */
export function timeWindow(
  day: string,
  kind: TimeKind,
  exactMinutes: number | null | undefined,
  exactSpread: number,
): { from: Date; to: Date; center: Date } {
  if (kind === 'exact') {
    const m = exactMinutes ?? 12 * 60;
    return {
      from: fromDayMinutes(day, m - exactSpread),
      to: fromDayMinutes(day, m + exactSpread + 1),
      center: fromDayMinutes(day, m),
    };
  }
  const [a, b] = PART_OF_DAY[kind];
  return { from: fromDayMinutes(day, a), to: fromDayMinutes(day, b), center: fromDayMinutes(day, (a + b) / 2) };
}

const MAX_EXACT = 6;
const MAX_NEAR = 6;

/**
 * Поиск рейсов. Сначала точные совпадения по дню и времени. Если их нет —
 * «ближайшие»: тот же день ± search_flex_hours и соседние дни. Пустого «ничего не найдено» не бывает,
 * пока на направлении есть хоть один подходящий рейс рядом.
 */
export async function searchTrips(q: SearchQuery): Promise<SearchResult> {
  const s = await loadSettings();
  const w = timeWindow(q.day, q.timeKind, q.exactMinutes, s.search_exact_minutes);
  const own = (t: TripView) => t.driverId !== q.excludeDriverId;
  const rank = (t: TripView) =>
    (t.driver.priority ? 0 : 2) + (q.needChildSeat && !t.driver.childSeat ? 1 : 0);
  const byTime = (a: TripView, b: TripView) => a.departsAt.localeCompare(b.departsAt);

  const base = { directionId: q.directionId, fromSide: q.fromSide, seats: q.seats };
  const exact = (await findPublishedTrips({ ...base, from: w.from, to: w.to }))
    .filter(own)
    .sort((a, b) => rank(a) - rank(b) || byTime(a, b))
    .slice(0, MAX_EXACT);

  const flex = s.search_flex_hours * 3_600_000;
  const wideFrom = new Date(Math.min(w.from.getTime() - flex, dayStart(addDays(q.day, -1)).getTime()));
  const wideTo = new Date(Math.max(w.to.getTime() + flex, dayEnd(addDays(q.day, 1)).getTime()));
  const seen = new Set(exact.map((t) => t.id));
  const distance = (t: TripView) => Math.abs(new Date(t.departsAt).getTime() - w.center.getTime());
  const near = (await findPublishedTrips({ ...base, from: wideFrom, to: wideTo }))
    .filter((t) => own(t) && !seen.has(t.id))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, MAX_NEAR)
    .sort(byTime);

  return { exact, near };
}

/** День уже прошёл или время окна истекло? */
export function windowExpired(day: string, kind: TimeKind, exactMinutes: number | null | undefined): boolean {
  return timeWindow(day, kind, exactMinutes, 0).to <= now();
}
