import type { Baggage, ChildSeat, Side, TimeKind } from '../db/schema.js';
import { addDays, dayEnd, dayStart, todayKey } from '../lib/time.js';
import { listDirections, routeLabel } from './directions.js';
import { listOpenRequestsOn, type RequestView } from './requests.js';
import { loadSettings } from './settings.js';
import { findPublishedTrips, type TripView } from './trips.js';

/**
 * Доска: открытые рейсы водителей и заявки пассажиров на день, по направлению и стороне.
 * Её видят все, поэтому у заявок — только имя пассажира, без телефона и адреса.
 */

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

/** Заявка без телефона и адреса: имя пассажира, города, время, места, багаж и кресло. */
export interface PublicRequest {
  id: number;
  /** Имя пассажира — только первое слово, без фамилии. */
  name: string;
  /** Пассажир едет сам: можно показать фото его профиля Telegram. За другого человека — только буква. */
  avatar: boolean;
  route: string;
  day: string;
  timeKind: TimeKind;
  exactMinutes: number | null;
  fromCity: string;
  toCity: string;
  fromVillage: boolean;
  toVillage: boolean;
  seats: number;
  baggage: Baggage;
  childSeat: ChildSeat;
}

/** «Айгуль Сафина» → «Айгуль». */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Заявку оставил сам пассажир, а не кто-то за него. */
export function requestForSelf(r: Pick<RequestView, 'passengerPhone' | 'user'>): boolean {
  return r.passengerPhone === r.user.phone;
}

export function publicRequest(r: RequestView): PublicRequest {
  return {
    id: r.id,
    name: firstName(r.passengerName),
    avatar: requestForSelf(r),
    route: r.route,
    day: r.day,
    timeKind: r.timeKind,
    exactMinutes: r.exactMinutes,
    fromCity: r.from.city,
    toCity: r.to.city,
    fromVillage: r.from.village,
    toVillage: r.to.village,
    seats: r.seats,
    baggage: r.baggage,
    childSeat: r.childSeat,
  };
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

export async function openRequests(q: { directionId: number; fromSide: Side; day: string; excludeUserId?: number }): Promise<PublicRequest[]> {
  const list = await listOpenRequestsOn(q.directionId, q.fromSide, q.day);
  return list.filter((r) => r.user.id !== q.excludeUserId).map(publicRequest);
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

/** Дни, которые можно листать на доске: от сегодня до горизонта публикации рейсов. */
export async function boardDays(): Promise<string[]> {
  const s = await loadSettings();
  const today = todayKey();
  return Array.from({ length: s.trip_horizon_days + 1 }, (_, i) => addDays(today, i));
}
