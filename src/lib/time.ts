import { DateTime } from 'luxon';

let zone = 'Europe/Moscow';
let nowFn: () => Date = () => new Date();

export function setZone(tz: string): void {
  zone = tz;
}

/** Только для тестов: подменить «сейчас». */
export function setNow(fn: (() => Date) | null): void {
  nowFn = fn ?? (() => new Date());
}

export function now(): Date {
  return nowFn();
}

type D = Date | string;

function dt(d: D): DateTime {
  const base = typeof d === 'string' ? DateTime.fromISO(d, { zone: 'utc' }) : DateTime.fromJSDate(d);
  return base.setZone(zone).setLocale('ru');
}

/** Ключ дня YYYY-MM-DD в часовом поясе приложения. */
export function dayKey(d: D): string {
  return dt(d).toFormat('yyyy-MM-dd');
}

export function todayKey(): string {
  return dayKey(now());
}

export function addDays(day: string, n: number): string {
  return DateTime.fromISO(day, { zone }).plus({ days: n }).toFormat('yyyy-MM-dd');
}

/** Момент времени по дню и минутам от полуночи (в часовом поясе приложения). */
export function fromDayMinutes(day: string, minutes: number): Date {
  return DateTime.fromISO(day, { zone }).plus({ minutes }).toJSDate();
}

export function dayStart(day: string): Date {
  return fromDayMinutes(day, 0);
}

export function dayEnd(day: string): Date {
  return fromDayMinutes(addDays(day, 1), 0);
}

export function minutesOfDay(d: D): number {
  const x = dt(d);
  return x.hour * 60 + x.minute;
}

export function fmtTime(d: D): string {
  return dt(d).toFormat('HH:mm');
}

export function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** «пт, 13 ноября» */
export function fmtDayKey(day: string): string {
  return DateTime.fromISO(day, { zone }).setLocale('ru').toFormat('ccc, d MMMM');
}

export function fmtDay(d: D): string {
  return fmtDayKey(dayKey(d));
}

/** «пт, 13 ноября в 17:00» */
export function fmtDateTime(d: D): string {
  return `${fmtDay(d)} в ${fmtTime(d)}`;
}

/** Короткая подпись для кнопки: «Пт 13.11» */
export function fmtDayShort(day: string): string {
  const s = DateTime.fromISO(day, { zone }).setLocale('ru').toFormat('ccc d.MM');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Разбирает время, набранное человеком: «17:30», «17.30», «17 30», «1730», «7». */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(/[.,\-\s]+/g, ':');
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) {
    const compact = /^(\d{1,2})(\d{2})$/.exec(s);
    if (compact && s.length >= 3) m = compact;
  }
  let h: number;
  let min: number;
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    min = 0;
  } else {
    return null;
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
