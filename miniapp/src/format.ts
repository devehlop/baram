import type { Baggage, BookingStatus, Trip, Trunk } from './types';

const TZ = 'Europe/Moscow';
const parts = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, ...opts }).format(new Date(iso));

export const time = (iso: string) => parts(iso, { hour: '2-digit', minute: '2-digit' });

/** «пт, 13 ноября» */
export const dayLong = (iso: string) => parts(iso, { weekday: 'short', day: 'numeric', month: 'long' });

export const dateTime = (iso: string) => `${dayLong(iso)}, ${time(iso)}`;

/** «~19:00» — прибытие по времени в пути направления. */
export const arrival = (trip: Trip) => time(new Date(new Date(trip.departsAt).getTime() + trip.travelMinutes * 60_000).toISOString());

export const money = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

export const minutesLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function phone(p: string | null | undefined): string {
  if (!p) return '';
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : p;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return `${n} ${one}`;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const seats = (n: number) => plural(n, 'место', 'места', 'мест');

export const car = (d: Trip['driver']) => `${d.car}, ${d.carColor.toLowerCase()}`;

export const TRUNK: Record<Trunk, string> = {
  free: 'Багажник свободен',
  half: 'Багажник наполовину',
  full: 'Багажник почти занят',
};

export const BAGGAGE: Record<Baggage, string> = {
  bag: 'сумка или рюкзак',
  suitcase: 'чемодан',
  many: 'много багажа',
};

export const STATUS: Record<BookingStatus, string> = {
  pending_admin: 'Ждём подтверждения диспетчера',
  pending: 'Ждём ответа водителя',
  accepted: 'Бронь подтверждена',
  confirmed: 'Бронь подтверждена',
  picked_up: 'Вы в машине',
  completed: 'Поездка завершена',
  declined: 'Водитель не смог вас взять',
  cancelled: 'Бронь отменена',
  no_show: 'Пассажир не пришёл',
};

/** Ссылка «В навигатор» на Яндекс Карты. */
export function mapsUrl(p: { city: string; address: string; lat: number | null; lon: number | null }): string {
  if (p.lat != null && p.lon != null) return `https://yandex.ru/maps/?pt=${p.lon},${p.lat}&z=17&l=map`;
  return `https://yandex.ru/maps/?text=${encodeURIComponent(`${p.city}, ${p.address}`)}`;
}

/** Время, набранное человеком: «17:30», «17.30», «1730», «7». */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(/[.,\-\s]+/g, ':');
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m && s.length >= 3) m = /^(\d{1,2})(\d{2})$/.exec(s);
  const h = m ? Number(m[1]) : /^\d{1,2}$/.test(s) ? Number(s) : NaN;
  const min = m ? Number(m[2]) : 0;
  return Number.isNaN(h) || h > 23 || min > 59 ? null : h * 60 + min;
}
