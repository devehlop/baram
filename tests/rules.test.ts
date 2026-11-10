import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishTrip, submitBooking } from '../src/bot/actions.js';
import { runJobs } from '../src/jobs/runner.js';
import { addDays, fromDayMinutes, todayKey } from '../src/lib/time.js';
import { getBooking, listTripBookings } from '../src/services/bookings.js';
import { listPassengers } from '../src/services/saved.js';
import { getTrip } from '../src/services/trips.js';
import { countViolations } from '../src/services/users.js';
import { ADMIN_ID, approvedDriver, dbId, passenger, postTrip, setClock, setup, type Harness, type TestUser } from './helpers.js';

const NOW = '2026-11-10T06:00:00Z'; // вт, 10 ноября 2026, 09:00 МСК

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

async function tripInput(tg: number, time: string, o: { side?: 'a' | 'b'; dayOffset?: number } = {}) {
  const [hh, mm] = time.split(':').map(Number);
  return {
    driverId: await dbId(tg),
    directionId: 1,
    fromSide: o.side ?? ('a' as const),
    departsAt: fromDayMinutes(addDays(todayKey(), o.dayOffset ?? 0), hh! * 60 + mm!),
    pickupMode: 'door' as const,
    pickupPoints: [],
    villages: false,
    villagesNote: null,
    seats: 3,
    trunk: 'free' as const,
    price: 500,
  };
}

/** Бронь напрямую через действие — как если бы пассажир прошёл анкету. */
async function book(tripId: number, tg: number, o: Partial<{ seats: number; baggage: 'bag' | 'suitcase' | 'many'; name: string; phone: string; type: 'adult' | 'teen' | 'child' }> = {}) {
  const res = await submitBooking({
    tripId,
    bookedBy: await dbId(tg),
    passenger: { name: o.name ?? 'Айгуль', phone: o.phone ?? '+79170000002', type: o.type ?? 'adult' },
    from: { localityId: 1, address: 'ул. Ленина, 12' },
    to: { localityId: 2, address: 'ул. Деловая, 7' },
    seats: o.seats ?? 1,
    childSeat: 'none',
    baggage: o.baggage ?? 'bag',
    baggageNote: o.baggage === 'many' ? 'Три коробки' : null,
  });
  if (!res.ok) throw new Error(`Бронь не создана: ${res.reason}`);
  return res;
}

describe('защита от спама при выкладке рейса', () => {
  it('лимит, дубли, пересечения, горизонт, прошедшее время', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const problem = async (time: string, o: { side?: 'a' | 'b'; dayOffset?: number } = {}) => {
      const res = await publishTrip(await tripInput(201, time, o));
      return 'problem' in res ? res.problem : null;
    };
    expect(await problem('08:00')).toBe('past'); // сейчас 09:00
    expect(await problem('12:00')).toBeNull();
    expect(await problem('12:40')).toBe('duplicate'); // тот же маршрут ±1 час
    expect(await problem('13:30', { side: 'b' })).toBe('overlap'); // до встречного рейса меньше 2 часов в пути
    expect(await problem('14:00', { side: 'b' })).toBeNull();
    expect(await problem('15:00')).toBe('overlap'); // повтор в ту же сторону раньше, чем туда-обратно
    expect(await problem('16:00')).toBeNull(); // второй рейс в ту же сторону
    expect(await problem('20:30')).toBe('limit'); // третий в ту же сторону за день
    expect(await problem('12:00', { dayOffset: 7 })).toBeNull();
    expect(await problem('12:00', { dayOffset: 8 })).toBe('horizon');
  });

  it('водителю без одобренной анкеты рейсы недоступны', async () => {
    const d = h.user(202);
    await d.text('/start');
    await d.press('Я водитель');
    await d.text('Рамиль');
    await d.contact('+79170000009');
    await d.text('/start'); // вышел из анкеты
    await d.text('🚘 Я водитель'); // анкеты ещё нет — снова анкета
    expect(d.last()).toContain('как в водительских правах');
  });

  it('в сценарии: повтор рейса в то же время не проходит, «Повторить прошлый» — день и «Выложить»', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await postTrip(201, { time: '17:00', price: 450 });
    await d.text('➕ Выложить рейс');
    expect(d.buttons()[0]).toContain('Повторить: Буинск → Казань, 17:00');
    await d.press('Повторить');
    await d.press('Сегодня');
    expect(d.last()).toContain('вт, 10 ноября в 17:00');
    await d.press('Выложить');
    expect(d.fresh()).toContain('уже есть рейс в эту сторону');
    await d.press('Завтра');
    await d.press('17:00'); // «Как в прошлый раз: 17:00»
    expect(d.last()).toContain('ср, 11 ноября в 17:00');
    expect(d.last()).toContain('450 ₽');
    await d.press('Выложить');
    expect(d.last()).toContain('Рейс выложен');
  });
});

describe('бронь за другого, багаж, предоплата', () => {
  it('водитель видит заказчика и пассажира; «сел в машину» приходит заказчику', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Данис', '+79170000002');
    const trip = await postTrip(201);

    await p.text('🚗 Найти поездку');
    await p.press('Другой человек');
    await p.text('гульнара');
    await p.text('8 917 555-44-33');
    await p.press('Подросток');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    await p.press('Сегодня');
    await p.press('Вечером');
    await p.press('1');
    await p.press('Нет');
    await p.press('Много багажа');
    await p.text('Три коробки с банками');
    await p.press('Пропустить');
    await p.press('17:00 · Ильдар');
    expect(p.last()).toContain('Едет: Гульнара, +7 917 555-44-33');
    expect(p.last()).toContain('предоплата 600 ₽');
    await p.press('Всё верно');

    expect(d.last()).toContain('Едет: Гульнара (подросток 14–17), +7 917 555-44-33');
    expect(d.last()).toContain('Оформил: Данис, +7 917 000-00-02');
    expect(d.last()).toContain('Подросток едет один');
    expect(d.last()).toContain('Три коробки с банками');
    await d.press('Принять');

    // Реквизиты — только из анкеты водителя, с предупреждением о мошенниках.
    expect(p.last()).toContain('Предоплата за крупный багаж — 600 ₽');
    expect(p.last()).toContain('+7 917 000-00-01 (Сбербанк), получатель — Ильдар Г.');
    expect(p.last()).toContain('никогда не просят перевести на другой номер');

    await d.press('Предоплата получена');
    expect(p.last()).toContain('Водитель получил предоплату');

    const [b] = await listTripBookings(trip.id);
    await d.pressData(`d:pick:${b!.id}`);
    expect(p.last()).toContain('Гульнара в машине: Lada Largus, 2019, белый, А123ВС116, водитель Ильдар');

    // Человек запомнился — в следующий раз он отдельной кнопкой.
    expect(await listPassengers(await dbId(101))).toMatchObject([{ name: 'Гульнара', phone: '+79175554433', type: 'teen' }]);
    await p.text('🚗 Найти поездку');
    expect(p.buttons()).toContain('Гульнара');
  });

  it('нет предоплаты за 2 часа до выезда — водителю сигнал', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201);
    const { booking } = await book(trip.id, 101, { baggage: 'many' });
    await d.pressData(`d:acc:${booking.id}`);
    setClock('2026-11-10T12:30:00Z'); // 15:30, до выезда 1,5 часа
    await runJobs();
    expect(d.all()).toContain('нет предоплаты за крупный багаж');
    expect(p.last()).toContain('водитель ждёт предоплату');
  });
});

describe('отмены и неявки', () => {
  let d: TestUser;
  let p: TestUser;
  beforeEach(async () => {
    d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    p = await passenger(h, 101, 'Айгуль', '+79170000002');
  });

  it('больше чем за 4 часа — свободная отмена, место возвращается', async () => {
    const trip = await postTrip(201, { time: '17:00' });
    const { booking } = await book(trip.id, 101);
    await d.pressData(`d:acc:${booking.id}`);
    await p.text('🔁 Мои поездки');
    await p.press('Буинск → Казань');
    await p.press('Отменить бронь');
    expect(p.last()).toContain('свободная отмена');
    await p.press('Да, отменить');
    expect(p.last()).toContain('Бронь отменена. Водитель получил сообщение.');
    expect(d.last()).toContain('Айгуль отменил бронь (1 место)');
    expect((await getTrip(trip.id))!.seatsFree).toBe(3);
    expect(await countViolations(await dbId(101))).toBe(0);
  });

  it('меньше чем за 4 часа — поздняя отмена; три таких — бронь через админа', async () => {
    const admin = h.user(ADMIN_ID);
    for (const [i, time] of ['11:00', '11:30', '12:00'].entries()) {
      const drv = await approvedDriver(h, 300 + i, `Водитель${i}`, `+7917000010${i}`, { plate: `В00${i}ВВ116` });
      void drv;
      const trip = await postTrip(300 + i, { time });
      const { booking } = await book(trip.id, 101);
      await h.user(300 + i).pressData(`d:acc:${booking.id}`);
      await p.pressData(`p:x:${booking.id}`);
      expect(p.last()).toContain('поздняя отмена');
      await p.press('Да, отменить');
      expect((await getBooking(booking.id))!.lateCancel).toBe(true);
    }
    expect(p.last()).toContain('Следующие брони будет подтверждать диспетчер');
    expect(await countViolations(await dbId(101))).toBe(3);

    const trip = await postTrip(201, { time: '19:00' });
    const res = await book(trip.id, 101);
    expect(res.needsAdmin).toBe(true);
    expect(res.booking.status).toBe('pending_admin');
    expect(d.all()).not.toContain('Новая бронь'); // водителю пока не показываем
    expect(admin.last()).toContain('Бронь ждёт вашего подтверждения');
    await admin.press('Разрешить');
    expect(d.last()).toContain('Новая бронь');
    expect((await getBooking(res.booking.id))!.status).toBe('pending');
  });

  it('пассажир не ответил на «Едете?» — через час сообщаем водителю', async () => {
    const trip = await postTrip(201, { time: '17:00' });
    const { booking } = await book(trip.id, 101);
    await d.pressData(`d:acc:${booking.id}`);
    setClock('2026-11-10T11:05:00Z'); // 14:05
    await runJobs();
    expect(p.last()).toContain('Едете сегодня');
    setClock('2026-11-10T11:50:00Z');
    await runJobs();
    expect(d.all()).not.toContain('не ответил');
    setClock('2026-11-10T12:10:00Z'); // прошёл час
    await runJobs();
    expect(d.last()).toContain('Айгуль не ответил на вопрос «Едете?»');
  });

  it('«Не пришёл» остаётся в истории пассажира; «Сел другой человек» — админу и заказчику', async () => {
    const admin = h.user(ADMIN_ID);
    const trip = await postTrip(201, { time: '17:00' });
    const { booking } = await book(trip.id, 101);
    await d.pressData(`d:acc:${booking.id}`);
    await d.pressData(`d:wrong:${booking.id}`);
    expect(admin.last()).toContain('Сел другой человек');
    expect(p.last()).toContain('сел не тот человек');
    await d.pressData(`d:ns:${booking.id}`);
    await d.press('Да, не пришёл');
    expect(p.last()).toContain('пассажир не пришёл');
    expect((await getBooking(booking.id))!.status).toBe('no_show');
    expect(await countViolations(await dbId(101))).toBe(1);
  });

  it('водитель отменил рейс: пассажиры получают сообщение, поздняя отмена — админу', async () => {
    const admin = h.user(ADMIN_ID);
    const trip = await postTrip(201, { time: '11:00' }); // до выезда 2 часа
    const { booking } = await book(trip.id, 101);
    await d.pressData(`d:acc:${booking.id}`);
    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    await d.press('Отменить рейс');
    await d.press('Да, отменить рейс');
    expect(p.last()).toContain('Водитель отменил рейс');
    expect(admin.last()).toContain('отменил рейс с бронями в последний момент');
    expect((await getBooking(booking.id))!).toMatchObject({ status: 'cancelled', cancelledBy: 'driver', lateCancel: false });
  });

  it('рейс без «Доехали» закрывается сам', async () => {
    const trip = await postTrip(201, { time: '10:00' });
    const { booking } = await book(trip.id, 101);
    await d.pressData(`d:acc:${booking.id}`);
    setClock('2026-11-10T16:30:00Z'); // 19:30: выезд 10:00 + 2 ч пути + 8 ч запаса = 20:00, ещё не прошло
    await runJobs();
    expect((await getTrip(trip.id))!.status).toBe('published');
    setClock('2026-11-10T17:10:00Z'); // 20:10
    await runJobs();
    expect((await getTrip(trip.id))!.status).toBe('completed');
    expect((await getBooking(booking.id))!.status).toBe('completed');
  });
});

describe('места по телефону', () => {
  it('одно нажатие убирает места из поиска; данные — потом контактом', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, { seats: 3 });
    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    await d.press('Занято по телефону');
    await d.press('2');
    expect((await getTrip(trip.id))!.seatsFree).toBe(1);
    expect(d.buttons().some((b) => b.includes('По телефону'))).toBe(true);

    await d.press('По телефону');
    expect(d.last()).toContain('Без данных пассажира');
    await d.press('Добавить имя и телефон');
    await d.contact('+79175550000', { own: false, name: 'Фарида' });
    expect(d.last()).toContain('Сохранено: Фарида, +7 917 555-00-00');
    const [b] = await listTripBookings(trip.id);
    expect(b).toMatchObject({ source: 'phone', seats: 2, passengerName: 'Фарида', status: 'accepted' });

    // Больше мест, чем осталось, занять нельзя; освободить — можно.
    await d.pressData(`d:ph:${trip.id}:3`);
    expect((await getTrip(trip.id))!.seatsFree).toBe(1);
    await d.pressData(`d:bx:${b!.id}`);
    await d.press('Да, отменить');
    expect((await getTrip(trip.id))!.seatsFree).toBe(3);
  });
});
