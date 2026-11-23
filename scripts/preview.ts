/**
 * Mini App в обычном браузере, без Telegram и без настоящей базы: демо-данные в памяти.
 *
 *   npm run miniapp:build && npm run miniapp:preview              → пассажир, http://localhost:8080
 *   AS=driver npm run miniapp:preview                             → водитель
 *   AS=new npm run miniapp:preview                                → незарегистрированный
 *
 * Только для просмотра вёрстки. Уведомления никуда не уходят.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Api } from 'grammy';
import { startApi } from '../src/api/server.js';
import { initApp } from '../src/app.js';
import { acceptBookingAction, publishTrip, submitBooking, submitRequest } from '../src/bot/actions.js';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { addDays, fromDayMinutes, todayKey } from '../src/lib/time.js';
import { saveAddress } from '../src/services/saved.js';
import { addVillage } from '../src/services/directions.js';
import { grantPrivilege, setDriverStatus, submitDriverForm } from '../src/services/drivers.js';
import { setSetting } from '../src/services/settings.js';
import { createUser } from '../src/services/users.js';

const pg = new PGlite();
const db = drizzle(pg, { schema }) as unknown as Db;
await migrate(drizzle(pg), { migrationsFolder: 'drizzle' });

// Картинки-заглушки вместо фото из Telegram: машина нужного цвета и кружок-аватарка.
const CAR_COLORS: Record<string, string> = { white: '#F4F1EA', grey: '#8D929A' };
function demoImage(name: string): string {
  const [kind, a = '', b = '0'] = name.replace(/\.svg$/, '').split('-');
  if (kind === 'avatar') {
    const hue = (Number(a) * 47) % 360;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="hsl(${hue} 45% 55%)"/><circle cx="80" cy="62" r="30" fill="#fff" opacity=".85"/><path d="M28 150c4-34 26-52 52-52s48 18 52 52" fill="#fff" opacity=".85"/></svg>`;
  }
  const body = CAR_COLORS[a] ?? '#B0B0B0';
  const bg = ['#C9D6DF', '#D8CBB3', '#5B4636'][Number(b)] ?? '#C9D6DF';
  const label = ['спереди', 'сбоку', 'салон'][Number(b)] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${bg}"/><rect y="430" width="800" height="170" fill="#6B6B6B"/><path d="M120 420l60-120h360l100 120h40v80H80v-80z" fill="${body}" stroke="#2B1A14" stroke-width="8"/><circle cx="230" cy="500" r="50" fill="#2B1A14"/><circle cx="560" cy="500" r="50" fill="#2B1A14"/><text x="400" y="120" font-family="sans-serif" font-size="44" text-anchor="middle" fill="#2B1A14">Демо-фото: ${label}</text></svg>`;
}

// Telegram-заглушка: сообщения «отправляются» в никуда, фото — картинки-заглушки.
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const json = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/file/bot')) return new Response(demoImage(u.split('/').pop()!), { headers: { 'content-type': 'image/svg+xml' } });
  const method = u.split('/').pop();
  const p = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (method === 'getFile') return json({ file_id: p.file_id, file_unique_id: p.file_id, file_path: `photos/${String(p.file_id)}.svg` });
  if (method === 'getUserProfilePhotos') {
    // У Айгуль фото профиля скрыто настройками — видна буква.
    if (p.user_id === 1001) return json({ total_count: 0, photos: [] });
    return json({ total_count: 1, photos: [[{ file_id: `avatar-${String(p.user_id)}`, file_unique_id: 'a', width: 160, height: 160 }]] });
  }
  return json({ message_id: 1, date: 0, chat: { id: 1, type: 'private' } });
}) as unknown as typeof fetch;
initApp({ db, api: new Api('1:PREVIEW', { fetch: fakeFetch }), adminIds: [], botUsername: 'baram_bot' });
await seed();
await setSetting('dispatcher_phone', '+78435550000');
await addVillage(1, 'a', 'Альшеево');
await addVillage(1, 'a', 'Кият');

const aigul = await createUser({ telegramId: 1001, name: 'Айгуль', phone: '+79171112233', role: 'passenger' });
const danis = await createUser({ telegramId: 1002, name: 'Данис', phone: '+79172223344', role: 'passenger' });

async function driver(tg: number, name: string, fullName: string, car: string, color: string, plate: string, childSeat: boolean, photo: string) {
  const u = await createUser({ telegramId: tg, name, phone: `+7917000${tg}`, role: 'driver' });
  const carPhotos = [0, 1, 2].map((i) => `car-${photo}-${i}`);
  await submitDriverForm(u.id, {
    fullName, car, carYear: 2019, carColor: color, plate, seats: 4, childSeat, carPhotos, payPhone: `+7917000${tg}`, payBank: 'Сбербанк',
  });
  await setDriverStatus(u.id, 'approved', null);
  return u;
}
const ildar = await driver(2001, 'Ильдар', 'Галиев Ильдар Ринатович', 'Lada Largus', 'Белый', 'А123ВС116', true, 'white');
const rustam = await driver(2002, 'Рустам', 'Сафин Рустам Маратович', 'Kia Rio', 'Серый', 'В456ОР116', false, 'grey');
await grantPrivilege(ildar.id, 'verified_badge', null, null);

const day = (offset: number) => addDays(todayKey(), offset);
async function trip(driverId: number, offset: number, minutes: number, fromSide: 'a' | 'b', price: number, extra: Partial<Parameters<typeof publishTrip>[0]> = {}) {
  const res = await publishTrip({
    driverId, directionId: 1, fromSide, departsAt: fromDayMinutes(day(offset), minutes), pickupMode: 'door', pickupPoints: [],
    villages: false, villagesNote: null, seats: 3, trunk: 'free', price, ...extra,
  });
  if (!('trip' in res) || !res.trip) throw new Error(`Демо-рейс не создан: ${JSON.stringify(res)}`);
  return res.trip;
}
const t1 = await trip(ildar.id, 1, 17 * 60, 'a', 500, { villages: true, villagesNote: 'Альшеево, Кият' });
await trip(rustam.id, 1, 18 * 60 + 30, 'a', 450, { pickupMode: 'points', pickupPoints: ['Автовокзал', 'Площадь'], trunk: 'half' });
await trip(rustam.id, 2, 9 * 60, 'a', 450);
await trip(ildar.id, 3, 18 * 60, 'b', 500);

const ride = {
  from: { localityId: 1, address: 'ул. Ленина, 12' },
  to: { localityId: 2, address: 'ул. Деловая, 7' },
  seats: 1, childSeat: 'none' as const, baggage: 'suitcase' as const, comment: 'Подъезд 3, позвоните заранее',
};
const b1 = await submitBooking({ ...ride, tripId: t1.id, bookedBy: aigul.id, passenger: { name: 'Айгуль', phone: aigul.phone, type: 'adult' } });
if (b1.ok) await acceptBookingAction(b1.booking.id, ildar.id);
await submitBooking({
  ...ride, tripId: t1.id, bookedBy: danis.id, baggage: 'bag', comment: null,
  passenger: { name: 'Артур', phone: '+79175556677', type: 'teen' }, from: { localityId: 1, address: 'ул. Вахитова, 3' },
});
// Заявки на доске: пассажиры, которым не нашлось рейса.
await submitRequest({ ...ride, userId: danis.id, directionId: 1, fromSide: 'a', day: day(1), timeKind: 'morning', seats: 2, childSeat: 'own', passenger: { name: 'Данис', phone: danis.phone, type: 'adult' } });
await submitRequest({ ...ride, userId: danis.id, directionId: 1, fromSide: 'a', day: day(1), timeKind: 'exact', exactMinutes: 21 * 60, baggage: 'many', baggageNote: 'Две коробки', passenger: { name: 'Данис', phone: danis.phone, type: 'adult' } });
await saveAddress({ userId: aigul.id, label: 'Дом', localityId: 1, address: 'ул. Ленина, 12' });
await saveAddress({ userId: aigul.id, label: 'Общага', localityId: 2, address: 'ул. Деловая, 7' });

const who = process.env.AS ?? 'passenger';
const devTelegramId = who === 'driver' ? 2001 : who === 'new' ? 9999 : 1001;
const port = Number(process.env.PORT ?? 8080);
startApi({ botToken: '1:PREVIEW', devTelegramId, staticDir: 'miniapp/dist', port });
console.log(`Mini App (${who}): http://localhost:${port}`);
