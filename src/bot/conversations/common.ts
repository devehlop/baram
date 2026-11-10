import { t } from '../../i18n.js';
import { addDays, fmtDayShort, todayKey } from '../../lib/time.js';
import type { Opt, Outcome } from '../wizard.js';

/** «Назад» / «В начало» → переход для runSteps; иначе null. */
export function nav(a: { kind: string }): Outcome | null {
  return a.kind === 'back' ? 'back' : a.kind === 'home' ? 'home' : null;
}

export interface DayOption {
  day: string;
  label: string;
}

/** Дни для выбора: сегодня, завтра и дальше до горизонта. Вызывать внутри ext(): зависит от «сейчас». */
export function dayOptions(horizonDays: number): DayOption[] {
  const today = todayKey();
  const out: DayOption[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const day = addDays(today, i);
    out.push({ day, label: i === 0 ? t('day-today') : i === 1 ? t('day-tomorrow') : fmtDayShort(day) });
  }
  return out;
}

export function dayButtons(days: DayOption[]): Opt[] {
  return days.map((d, i) => ({ text: d.label, data: `d${i}` }));
}

export const lengthBetween = (min: number, max: number) => (v: string) =>
  v.length >= min && v.length <= max ? null : t('hint-text-length', { min, max });
