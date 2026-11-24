import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptBookingAction, completeTripAction, submitBooking } from '../src/bot/actions.js';
import { tripCard } from '../src/bot/ui/cards.js';
import { getRating, ratingOf } from '../src/services/ratings.js';
import { getTrip } from '../src/services/trips.js';
import { ADMIN_ID, approvedDriver, dbId, passenger, postTrip, setup, type Harness } from './helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

/** Рейс водителя 201 с одной принятой бронью пассажира tg, доведённый до «Доехали». Возвращает id брони. */
async function ride(tg: number, time: string, dayOffset = 0): Promise<{ bookingId: number; tripId: number }> {
  const trip = await postTrip(201, { time, dayOffset });
  const res = await submitBooking({
    tripId: trip.id,
    bookedBy: await dbId(tg),
    passenger: { name: `Пассажир ${tg}`, phone: `+7917000${String(tg).padStart(4, '0')}`, type: 'adult' },
    from: { localityId: 1, address: 'ул. Ленина, 12' },
    to: { localityId: 2, address: 'ул. Деловая, 7' },
    seats: 1,
    childSeat: 'none',
    baggage: 'bag',
    baggageNote: null,
  });
  if (!res.ok) throw new Error(res.reason);
  const driverId = await dbId(201);
  await acceptBookingAction(res.booking.id, driverId);
  await completeTripAction(trip.id, driverId);
  return { bookingId: res.booking.id, tripId: trip.id };
}

describe('оценки после поездки', () => {
  it('пассажир ставит звёзды, как в Яндексе; рейтинг виден всем с трёх оценок', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p1 = await passenger(h, 101, 'Айгуль', '+79170000002');
    const p2 = await passenger(h, 102, 'Булат', '+79170000003');
    const p3 = await passenger(h, 103, 'Гузель', '+79170000004');

    const r1 = await ride(101, '10:00');
    // В сообщении «Доехали» — пять одинаковых звёзд в ряд.
    expect(p1.last()).toContain('Нажмите на звезду');
    expect(p1.buttons().filter((b) => b === '⭐')).toHaveLength(5);
    await p1.pressData(`p:rt:${r1.bookingId}:5`);
    expect(p1.last()).toContain('Спасибо за оценку: ★★★★★');
    // Второй раз ту же поездку не оценить.
    await p1.pressData(`p:rt:${r1.bookingId}:1`);
    expect((await getRating(r1.bookingId, 'driver'))!.stars).toBe(5);

    // Пока оценок меньше трёх, в карточке рейса рейтинга нет.
    const next = await postTrip(201, { time: '20:00' });
    expect((await getTrip(next.id))!.driver.rating).toBeNull();

    const r2 = await ride(102, '13:00');
    await p2.pressData(`p:rt:${r2.bookingId}:4`);
    const r3 = await ride(103, '16:00');
    await p3.pressData(`p:rt:${r3.bookingId}:5`);

    expect(await ratingOf(await dbId(201), 'driver')).toEqual({ avg: 14 / 3, count: 3 });
    expect((await getTrip(next.id))!.driver.rating).toMatchObject({ count: 3 });

    // Пассажир видит рейтинг в поиске: на кнопке рейса и в карточке.
    await p1.text('🚗 Найти поездку');
    await p1.press('Буинск → Казань');
    await p1.press('Сегодня');
    expect(p1.buttons().join('\n')).toContain('20:00 · Ильдар ★4,7');
    expect(tripCard((await getTrip(next.id))!)).toContain('👤 Ильдар · ★ 4,7 · 3 оценки');

    // Водитель видит свой рейтинг в «Моих данных».
    await d.text('👤 Мои данные');
    expect(d.last()).toContain('Рейтинг: ★ 4,7 · 3 оценки');
  });

  it('1–3 ★ — вопрос «что было не так», админу приходит оценка с комментарием', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const admin = h.user(ADMIN_ID);

    const r = await ride(101, '10:00');
    await p.pressData(`p:rt:${r.bookingId}:2`);
    expect(p.last()).toContain('Что было не так?');
    await p.text('Опоздал на 40 минут');
    expect(p.last()).toContain('администратор разберётся');
    expect(admin.last()).toContain('Плохая оценка водителю: 2 из 5');
    expect(admin.last()).toContain('Опоздал на 40 минут');
    expect((await getRating(r.bookingId, 'driver'))!.comment).toBe('Опоздал на 40 минут');

    // В карточке пользователя у админа — рейтинг и последние плохие оценки.
    await admin.press('Открыть');
    expect(admin.last()).toContain('Рейтинг водителя: ★ 2,0 · 1 оценка');
    expect(admin.last()).toContain('★★☆☆☆ · Айгуль');
  });

  it('оценку можно поставить позже из «Мои поездки», комментарий — пропустить', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const admin = h.user(ADMIN_ID);
    const r = await ride(101, '10:00');

    await p.text('🔁 Мои поездки');
    await p.press('Буинск → Казань');
    await p.press('Оценить водителя');
    expect(p.last()).toContain('Как вам поездка с водителем Ильдар?');
    await p.pressData(`p:rt:${r.bookingId}:3`);
    await p.press('Пропустить');
    expect(admin.last()).toContain('Плохая оценка водителю: 3 из 5');
    expect(admin.last()).toContain('без комментария');
  });

  it('рейтинг ниже порога — сообщение админу один раз, при пересечении', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const admin = h.user(ADMIN_ID);
    const stars = [5, 4, 3, 2, 1];
    for (const [i, n] of stars.entries()) {
      const tg = 101 + i;
      const p = await passenger(h, tg, `П${i}`, `+7917000000${i + 2}`);
      const r = await ride(tg, `${10 + i}:00`);
      await p.pressData(`p:rt:${r.bookingId}:${n}`);
      if (n <= 3) await p.press('Пропустить');
    }
    // 5, 4, 3 → 4,0 — ещё не ниже порога; + 2 → 3,5 — ниже; + 1 → 3,0 — уже сообщали.
    const alerts = admin.all().split('Рейтинг водителя опустился ниже 4,0').length - 1;
    expect(alerts).toBe(1);
    expect(admin.all()).toContain('Сейчас: ★ 3,5 · оценок: 4');
  });

  it('водитель по желанию оценивает пассажиров; оценку видят другие водители', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await passenger(h, 101, 'Айгуль', '+79170000002');

    const trip = await postTrip(201, { time: '10:00' });
    const res = await submitBooking({
      tripId: trip.id,
      bookedBy: await dbId(101),
      passenger: { name: 'Айгуль', phone: '+79170000002', type: 'adult' },
      from: { localityId: 1, address: 'ул. Ленина, 12' },
      to: { localityId: 2, address: 'ул. Деловая, 7' },
      seats: 1,
      childSeat: 'none',
      baggage: 'bag',
      baggageNote: null,
    });
    if (!res.ok) throw new Error(res.reason);
    await acceptBookingAction(res.booking.id, await dbId(201));

    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    await d.press('Выехал');
    await d.press('Доехали');
    expect(d.last()).toContain('Рейс завершён');
    expect(d.last()).toContain('Оцените пассажиров — по желанию');
    await d.press('Оценить: Айгуль');
    expect(d.buttons().filter((b) => b === '⭐')).toHaveLength(5);
    await d.pressData(`d:rt:${res.booking.id}:4`);
    expect(d.last()).toContain('Оценка сохранена: ★★★★☆');
    expect(d.buttons().join('\n')).not.toContain('Оценить: Айгуль');
    expect(await ratingOf(await dbId(101), 'passenger')).toEqual({ avg: 4, count: 1 });
  });
});
