import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { settings } from '../db/schema.js';

/**
 * Все числа-правила бота. Значения хранятся в таблице settings и меняются админом в боте;
 * здесь — только значения по умолчанию для первого заполнения базы.
 */
export const NUMERIC_SETTINGS = {
  trip_horizon_days: 7, // на сколько дней вперёд можно выложить рейс
  trips_per_side_per_day: 2, // рейсов в одну сторону в день
  trip_duplicate_minutes: 60, // тот же маршрут ±N минут считается дублем
  request_escalate_minutes: 30, // заявку не взяли — передаём админу
  late_cancel_hours: 4, // отмена позже этого срока — «поздняя»
  confirm_ask_hours: 3, // за сколько часов спрашиваем «Едете?»
  confirm_wait_minutes: 60, // сколько ждём ответа, прежде чем сообщить водителю
  violations_limit: 3, // поздних отмен и неявок до ограничения
  violations_period_days: 30,
  big_baggage_prepay: 600, // предоплата за крупный багаж, ₽
  prepay_deadline_hours: 2, // без предоплаты за N часов до выезда водитель может отменить
  search_flex_hours: 2, // гибкий поиск: ± часов
  search_exact_minutes: 60, // «точное время»: ± минут
  trip_autoclose_hours: 8, // рейс без «Доехали» закрывается сам
  driver_late_cancel_hours: 3, // отмена рейса с бронями позже срока — сигнал админу
  price_min: 100,
  price_max: 5000,
} as const;

export const TEXT_SETTINGS = {
  dispatcher_phone: '', // телефон диспетчера для кнопки «Помощь»
} as const;

export type NumericKey = keyof typeof NUMERIC_SETTINGS;
export type TextKey = keyof typeof TEXT_SETTINGS;
export type SettingKey = NumericKey | TextKey;
export type Settings = Record<NumericKey, number> & Record<TextKey, string>;

export const SETTING_KEYS = [
  ...Object.keys(NUMERIC_SETTINGS),
  ...Object.keys(TEXT_SETTINGS),
] as SettingKey[];

export function isNumericKey(key: string): key is NumericKey {
  return key in NUMERIC_SETTINGS;
}

export function isSettingKey(key: string): key is SettingKey {
  return key in NUMERIC_SETTINGS || key in TEXT_SETTINGS;
}

export async function loadSettings(): Promise<Settings> {
  const rows = await app.db.select().from(settings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, number | string> = {};
  for (const [key, def] of Object.entries(NUMERIC_SETTINGS)) {
    const n = Number(stored.get(key));
    out[key] = stored.has(key) && Number.isFinite(n) ? n : def;
  }
  for (const [key, def] of Object.entries(TEXT_SETTINGS)) {
    out[key] = stored.get(key) ?? def;
  }
  return out as Settings;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await app.db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Первое заполнение: добавляет недостающие ключи, существующие не трогает. */
export async function seedSettings(): Promise<void> {
  const all = { ...NUMERIC_SETTINGS, ...TEXT_SETTINGS };
  for (const [key, def] of Object.entries(all)) {
    await app.db.insert(settings).values({ key, value: String(def) }).onConflictDoNothing();
  }
}

export async function getStoredSetting(key: SettingKey): Promise<string | undefined> {
  const [row] = await app.db.select().from(settings).where(eq(settings.key, key));
  return row?.value;
}
