import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { acceptBookingAction, completeTripAction, submitBooking } from '../src/bot/actions.js';
import { visitors } from '../src/db/schema.js';
import { activity, funnel } from '../src/services/stats.js';
import { ADMIN_ID, approvedDriver, dbId, passenger, postTrip, setClock, setup, type Harness } from './helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

async function visitor(tg: number) {
  const [row] = await h.db.select().from(visitors).where(eq(visitors.telegramId, tg));
  return row;
}

/** Пассажир tg бронирует рейс водителя 201 и доезжает. */
async function ride(tg: number) {
  const trip = await postTrip(201, { time: '10:00' });
  const res = await submitBooking({
    tripId: trip.id,
    bookedBy: await dbId(tg),
    passenger: { name: `Пассажир ${tg}`, phone: `+7917000${String(tg).padStart(4, '0')}`, type: 'adult' },
    from: { localityId: 1, address: 'ул. Ленина, 12' },
    to: { localityId: 2, address: 'ул. Деловая, 7' },
    seats: 2,
    childSeat: 'none',
    baggage: 'bag',
    baggageNote: null,
  });
  if (!res.ok) throw new Error(res.reason);
  const driverId = await dbId(201);
  await acceptBookingAction(res.booking.id, driverId);
  await completeTripAction(trip.id, driverId);
}

describe('кто нажал «Старт»', () => {
  it('первое сообщение записывается до регистрации, метка источника — с первого раза и навсегда', async () => {
    const u = h.user(101);
    await u.text('/start s_Aigul');
    expect(u.last()).not.toContain('Найти поездку'); // ещё не зарегистрирован
    const first = await visitor(101);
    expect(first).toMatchObject({ source: 'aigul', firstSeenAt: new Date(NOW), lastSeenAt: new Date(NOW) });

    setClock('2026-11-11T06:00:00Z');
    await u.text('/start s_other');
    const again = await visitor(101);
    expect(again!.source).toBe('aigul');
    expect(again!.firstSeenAt).toEqual(new Date(NOW));
    expect(again!.lastSeenAt).toEqual(new Date('2026-11-11T06:00:00Z'));
  });
});

describe('статистика в админке', () => {
  it('воронка: нажали «Старт» → зарегистрировались → забронировали → доехали', async () => {
    // Помощники заводят людей прямо в базе, минуя бота, — поэтому «Старт» за них нажимаем сами.
    await (await approvedDriver(h, 201, 'Ильдар', '+79170000001')).text('/start');
    await (await passenger(h, 101, 'Айгуль', '+79170000002')).text('/start');
    await (await passenger(h, 102, 'Булат', '+79170000003')).text('/start');
    await h.user(103).text('/start'); // нажал и ушёл
    await h.user(104).text('/start s_qr'); // нажал и ушёл
    await ride(101);

    const f = await funnel();
    expect(f).toEqual({ started: 5, registered: 3, booked: 1, rode: 1, drivers: 1 });
    const a = await activity();
    expect(a).toMatchObject({ usersTotal: 3, driversApproved: 1, tripsCompleted: 1, bookingsCompleted: 1, seatsCompleted: 2 });

    const admin = h.user(ADMIN_ID);
    await admin.text('/admin');
    await admin.press('📊 Статистика');
    const text = admin.last();
    expect(text).toContain('Статистика за 7 дней');
    expect(text).toContain('Нажали «Старт»: 5'); // админ, написавший /admin, не считается
    expect(text).toContain('Зарегистрировались: 3 · 60%');
    expect(text).toContain('Забронировали поездку: 1 · 20%');
    expect(text).toContain('Доехали: 1 · 20%');
    expect(text).toContain('Пока не зарегистрировались: 2');
    expect(text).toContain('Довезли пассажиров: 2');

    // Через месяц «за 7 дней» пусто, а «за всё время» — все.
    setClock('2026-12-20T06:00:00Z');
    await admin.press('7 дней');
    expect(admin.last()).toContain('Нажали «Старт»: 0');
    await admin.press('Всё время');
    expect(admin.last()).toContain('Статистика за всё время');
    expect(admin.last()).toContain('Нажали «Старт»: 5');
  });

  it('«Откуда приходят» показывает и тех, кто нажал «Старт», но не зарегистрировался', async () => {
    await h.user(103).text('/start s_qr');
    await h.user(104).text('/start s_qr');
    const admin = h.user(ADMIN_ID);
    await admin.text('/admin');
    await admin.press('📈 Откуда приходят');
    expect(admin.last()).toContain('qr: нажали «Старт» 2 · зарегистрировались 0');
  });

  it('«Старт» и регистрация одного человека считаются по одной метке', async () => {
    const u = h.user(101);
    await u.text('/start'); // пришёл без метки и ушёл
    await u.text('/start s_aigul'); // вернулся по ссылке друга и зарегистрировался
    await u.press('Согласен');
    await u.press('Я пассажир');
    await u.text('Айгуль');
    await u.contact('+79170000002');
    const admin = h.user(ADMIN_ID);
    await admin.text('/admin');
    await admin.press('📈 Откуда приходят');
    expect(admin.last()).toContain('aigul: нажали «Старт» 1 · зарегистрировались 1');
    expect(admin.last()).not.toContain('Без метки');
  });

  it('админов в статистике нет, даже перенесённых миграцией из зарегистрированных', async () => {
    // Так выглядит админ, который зарегистрировался до появления учёта «Старта».
    await h.db.insert(visitors).values({ telegramId: ADMIN_ID, source: 'qr', firstSeenAt: new Date(NOW), lastSeenAt: new Date(NOW) });
    await h.user(103).text('/start s_qr');
    expect((await funnel()).started).toBe(1);
    expect((await activity()).active).toBe(1);
    const admin = h.user(ADMIN_ID);
    await admin.text('/admin');
    await admin.press('📈 Откуда приходят');
    expect(admin.last()).toContain('qr: нажали «Старт» 1 ·');
  });

  it('не админ статистику не видит', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.pressData('a:st:7');
    expect(p.last()).not.toContain('Статистика');
  });
});
