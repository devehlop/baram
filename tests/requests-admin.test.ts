import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitBooking } from '../src/bot/actions.js';
import { runJobs } from '../src/jobs/runner.js';
import { getBooking, listTripBookings } from '../src/services/bookings.js';
import { getDriver } from '../src/services/drivers.js';
import { listUserOpenRequests } from '../src/services/requests.js';
import { loadSettings } from '../src/services/settings.js';
import { getTrip } from '../src/services/trips.js';
import { getUserByTg } from '../src/services/users.js';
import { ADMIN_ID, approvedDriver, dbId, passenger, postTrip, setClock, setup, type Harness, type TestUser } from './helpers.js';

const NOW = '2026-11-10T06:00:00Z'; // вт, 10 ноября 2026, 09:00 МСК

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

/** Пассажир проходит анкету до списка рейсов. */
async function searchTo(p: TestUser, o: { day?: string; time?: string; fromCity?: string; toCity?: string; village?: string } = {}) {
  await p.text('🚗 Найти поездку');
  await p.press('Я сам');
  if (o.village) {
    await p.press('Деревня или село');
    await p.press(o.village);
  } else {
    await p.press(o.fromCity ?? 'Буинск');
  }
  await p.text('ул. Ленина, 12');
  await p.press(o.toCity ?? 'Казань');
  await p.text('ул. Деловая, 7');
  await p.press(o.day ?? 'Сегодня');
  await p.press(o.time ?? 'Вечером');
  await p.press('1');
  await p.press('Нет');
  await p.press('Только сумка');
  await p.press('Пропустить');
}

describe('гибкий поиск', () => {
  it('нет рейса на это время — показывает ближайшие, а не «ничего не найдено»', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116', childSeat: true });
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await postTrip(201, { time: '20:00' });
    await postTrip(202, { time: '07:00', dayOffset: 1, villages: true });
    await postTrip(202, { time: '18:00', dayOffset: 3 }); // далеко — не показываем

    await searchTo(p, { time: 'Днём' });
    expect(p.last()).toContain('Точно на это время рейса нет. Ближайшие рейсы');
    expect(p.last()).toContain('вт, 10 ноября в 20:00');
    expect(p.last()).toContain('ср, 11 ноября в 07:00');
    expect(p.last()).not.toContain('13 ноября');
    expect(p.buttons()).toContain('🔔 Оставить заявку');
    // У рейса в другой день подпись кнопки с датой.
    expect(p.buttons().some((b) => b.startsWith('Ср 11.11 07:00 · Рамиль'))).toBe(true);
  });

  it('деревня: предупреждение о доплате и пометка у рейсов, которые в деревни не заезжают', async () => {
    const admin = h.user(ADMIN_ID);
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await postTrip(201, { time: '18:00' });

    // Админ добавляет деревню — в коде деревень нет, только в базе.
    await admin.text('/admin');
    await admin.press('Деревни');
    await admin.press('+ Деревня у города Буинск');
    await admin.text('Альшеево');
    expect(admin.last()).toContain('Добавлено: Альшеево');

    await searchTo(p, { village: 'Альшеево' });
    expect(p.all()).toContain('За деревню может быть доплата');
    expect(p.last()).toContain('В деревни не заезжает');
  });

  it('свои точки сбора: пассажир выбирает точку водителя', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '18:00', pickupMode: 'points', pickupPoints: ['ТЦ Мега', 'Горки'] });
    await searchTo(p);
    expect(p.last()).toContain('Забирает из своих точек: ТЦ Мега, Горки');
    await p.press('18:00 · Ильдар');
    expect(p.last()).toContain('Где вам удобно сесть?');
    await p.press('Горки');
    expect(p.last()).toContain('Точка сбора: Горки');
    await p.press('Всё верно');
    expect(d.last()).toContain('Точка сбора: Горки');
    expect((await listTripBookings(trip.id))[0]!.pickupPoint).toBe('Горки');
  });
});

describe('заявки', () => {
  it('нет рейса → заявка водителям → водитель выкладывает рейс и берёт заявку', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    await searchTo(p);
    expect(p.last()).toContain('Рейсов на это время пока нет');
    await p.press('Оставить заявку');
    expect(p.fresh()).toContain('Заявка отправлена водителям');
    expect(p.fresh()).toContain('за 30 минут');
    expect(d.last()).toContain('Заявка от пассажира');
    expect(d.last()).not.toContain('+7 917 000-00-02'); // телефон — только после «Беру»

    // Рейса у водителя нет: взять нельзя, пока не выложит.
    await d.press('Беру');
    expect(d.last()).toContain('сначала выложите рейс');
    const trip = await postTrip(201, { time: '18:30' });
    expect(p.last()).toContain('Появился рейс на ваш день');

    await d.press('Обновить');
    expect(d.last()).toContain('В какой рейс берёте пассажира?');
    await d.press('В рейс 18:30');
    expect(d.last()).toContain('Заявка ваша');
    expect(d.last()).toContain('+7 917 000-00-02');
    expect(p.last()).toContain('Водитель взял вашу заявку');
    expect(p.last()).toContain('А123ВС116');
    const [b] = await listTripBookings(trip.id);
    expect(b).toMatchObject({ status: 'accepted', source: 'request', passengerName: 'Айгуль' });
    expect((await getTrip(trip.id))!.seatsFree).toBe(2);
    expect(await listUserOpenRequests(await dbId(101))).toEqual([]);
  });

  it('пассажир сам бронирует появившийся рейс из уведомления', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await searchTo(p);
    await p.press('Оставить заявку');
    await postTrip(201, { time: '18:30' });
    await p.press('Еду с ним');
    expect(p.last()).toContain('Заявка на бронь отправлена водителю');
    expect(d.last()).toContain('Новая бронь');
    expect(await listUserOpenRequests(await dbId(101))).toEqual([]);
  });

  it('никто не взял за 30 минут → админу; админ предлагает водителю или закрывает', async () => {
    const admin = h.user(ADMIN_ID);
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await searchTo(p);
    await p.press('Оставить заявку');

    setClock('2026-11-10T06:20:00Z');
    await runJobs();
    expect(admin.all()).not.toContain('Заявку никто не взял');
    setClock('2026-11-10T06:31:00Z');
    await runJobs();
    expect(admin.last()).toContain('Заявку никто не взял');
    expect(admin.last()).toContain('+7 917 000-00-02'); // админ видит телефон
    expect(p.last()).toContain('Передали её диспетчеру');
    await runJobs();
    expect(h.tg.of(ADMIN_ID).filter((m) => m.text.includes('Заявку никто не взял')).length).toBe(1);

    await admin.press('Открыть');
    expect(admin.last()).toContain('Кому предложить');
    await admin.press('Предложить: Ильдар');
    expect(d.last()).toContain('Диспетчер просит взять заявку');

    await admin.press('Закрыть: водителя нет');
    expect(p.last()).toContain('машину на это время найти не удалось');
    expect(await listUserOpenRequests(await dbId(101))).toEqual([]);
  });

  it('заявка, время которой прошло, закрывается сама', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await searchTo(p, { time: 'Днём' });
    await p.press('Оставить заявку');
    setClock('2026-11-10T17:00:00Z'); // 20:00 — окно «днём» ± 2 часа прошло
    await runJobs();
    expect(p.last()).toContain('Время вашей заявки прошло');
  });
});

describe('админ в боте', () => {
  it('проверка анкеты: запросить фото → одобрить; отклонить с причиной', async () => {
    const admin = h.user(ADMIN_ID);
    const d = h.user(202);
    await d.text('/start');
    await d.press('Я водитель');
    await d.text('Рамиль');
    await d.contact('+79170000009');
    await d.text('Сафин Рамиль Ильдарович');
    await d.press('Kia Rio');
    await d.text('2021');
    await d.press('Серый');
    await d.text('В777ВВ116');
    await d.press('4');
    await d.press('Нет');
    await d.photo('a');
    await d.photo('b');
    await d.press('Готово');
    await d.press('Тот же');
    await d.press('Т-Банк');
    await d.press('Отправить на проверку');
    const id = (await getUserByTg(202))!.id;

    // Пока анкета на проверке, рейсы недоступны.
    await d.text('➕ Выложить рейс');
    expect(d.last()).toContain('Анкета ещё на проверке');

    expect(h.tg.of(ADMIN_ID).some((m) => m.photos === 2)).toBe(true); // админ получил фото машины
    await admin.press('Запросить фото заново');
    expect((await getDriver(id))!.status).toBe('photos_requested');
    expect(d.last()).toContain('просит прислать фото машины заново');
    await d.press('Отправить фото');
    await d.photo('c');
    await d.photo('d');
    await d.press('Готово');
    expect((await getDriver(id))!).toMatchObject({ status: 'pending', carPhotos: ['c', 'd'] });

    await admin.press('Отклонить');
    await admin.press('Данные не совпадают');
    expect((await getDriver(id))!).toMatchObject({ status: 'rejected', rejectReason: 'Данные не совпадают' });
    expect(d.last()).toContain('Причина: Данные не совпадают');

    await admin.text('/admin');
    await admin.press('Найти пользователя');
    await admin.text('0000009');
    await admin.press('Рамиль');
    await admin.press('Вернуть водителя в работу');
    expect((await getDriver(id))!.status).toBe('approved');
    expect(d.last()).toContain('Анкета одобрена');
    expect(d.menu()).toContain('➕ Выложить рейс');
  });

  it('жалоба: в работу → заметка → решение', async () => {
    const admin = h.user(ADMIN_ID);
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201);
    const res = await submitBooking({
      tripId: trip.id,
      bookedBy: await dbId(101),
      passenger: { name: 'Айгуль', phone: '+79170000002', type: 'adult' },
      from: { localityId: 1, address: 'ул. Ленина, 12' },
      to: { localityId: 2, address: 'ул. Деловая, 7' },
      seats: 1,
      childSeat: 'none',
      baggage: 'bag',
    });
    if (!res.ok) throw new Error('нет брони');
    await d.press('Принять');

    await p.pressData(`p:cmp:${res.booking.id}`);
    expect(p.last()).toContain('Опишите, что случилось');
    await p.text('Водитель просил перевести деньги на другой номер');
    expect(p.last()).toContain('сообщение отправлено диспетчеру');
    expect(admin.last()).toContain('Жалоба №1');
    expect(admin.last()).toContain('На кого: Ильдар');

    await admin.press('Открыть');
    await admin.press('Взять в работу');
    expect(admin.last()).toContain('в работе');
    await admin.press('Добавить заметку');
    await admin.text('Позвонил водителю');
    await admin.press('Открыть');
    expect(admin.last()).toContain('Позвонил водителю');
    await admin.press('Решить и закрыть');
    await admin.text('Водителю предупреждение');
    await admin.text('/admin');
    expect(admin.buttons()).toContain('Открытые жалобы: 0');
  });

  it('настройки меняются в боте и сразу действуют; блокировка; привилегии', async () => {
    const admin = h.user(ADMIN_ID);
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    await admin.text('/admin');
    await admin.press('Настройки');
    await admin.press('Предоплата за багаж');
    await admin.text('много'); // не число
    expect(admin.last()).toContain('целое число');
    await admin.text('700');
    expect((await loadSettings()).big_baggage_prepay).toBe(700);

    // Значок «Проверен» и приоритет.
    await admin.text('/admin');
    await admin.press('Найти пользователя');
    await admin.text('Ильдар');
    await admin.press('Ильдар');
    await admin.press('Выдать значок «Проверен»');
    await admin.press('На 30 дней');
    expect((await getDriver(await dbId(201)))!.badge).toBe(true);
    await postTrip(201, { time: '18:00' });
    await searchTo(p);
    expect(p.last()).toContain('Ильдар · ✅ Проверен');

    // Блокировка пассажира.
    await admin.text('/admin');
    await admin.press('Найти пользователя');
    await admin.text('+79170000002');
    await admin.press('Айгуль');
    await admin.press('Заблокировать');
    await admin.text('Оскорбления');
    await p.text('🚗 Найти поездку');
    expect(p.last()).toContain('Ваш аккаунт заблокирован');
    void d;
  });

  it('не админ не может пользоваться админскими кнопками', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('/admin');
    expect(p.last()).toContain('только администратору');
    await p.pressData('a:set');
    expect(h.tg.answers.at(-1)!.text).toContain('только администратору');
    expect(p.menu()).not.toContain('🛠 Админ');
  });
});

describe('устойчивость сценариев', () => {
  it('кнопка уведомления посреди анкеты не сбивает анкету; команда и меню прерывают её', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '18:00' });
    const res = await submitBooking({
      tripId: trip.id,
      bookedBy: await dbId(101),
      passenger: { name: 'Айгуль', phone: '+79170000002', type: 'adult' },
      from: { localityId: 1, address: 'ул. Ленина, 12' },
      to: { localityId: 2, address: 'ул. Деловая, 7' },
      seats: 1,
      childSeat: 'none',
      baggage: 'bag',
    });
    if (!res.ok) throw new Error('нет брони');

    // Водитель начал выкладывать новый рейс и посреди анкеты принимает бронь из уведомления.
    await d.text('➕ Выложить рейс');
    await d.press('Новый рейс');
    await d.press('Казань → Буинск');
    await d.press('Принять'); // кнопка в сообщении «Новая бронь», а не в анкете
    expect((await getBooking(res.booking.id))!.status).toBe('accepted');
    await d.press('Завтра'); // анкета продолжается с того же шага
    expect(d.last()).toContain('Во сколько выезжаете?');

    // Текст там, где ждём кнопку, — подсказка, шаг не теряется.
    await d.press('12:00');
    await d.text('какой-то текст');
    expect(d.last()).toContain('нажмите одну из кнопок');
    // У отвеченных вопросов кнопки убираются; нажатие по старой кнопке — вежливый отказ, шаг не теряется.
    await d.pressData('w:d1');
    expect(h.tg.answers.at(-1)!.text).toContain('уже не работает');
    await d.press('От дома до дома');
    expect(d.last()).toContain('Заезжаете в деревни?');

    // Меню прерывает анкету.
    await d.text('📋 Мои рейсы');
    expect(d.last()).toContain('Мои рейсы');
    await d.pressData('w:n'); // кнопка из прерванной анкеты
    expect(h.tg.answers.at(-1)!.text).toContain('уже не работает');
    void p;
  });

  it('состояние анкеты переживает «перезапуск»: оно хранится в базе, а не в памяти', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('🚗 Найти поездку');
    await p.press('Я сам');
    await p.press('Буинск');
    // Новый экземпляр бота на той же базе — как после перезапуска процесса.
    const { createBot } = await import('../src/bot/bot.js');
    const { initApp } = await import('../src/app.js');
    const bot2 = createBot('1:TEST', { fetch: h.tg.fetch });
    bot2.botInfo = h.bot.botInfo;
    initApp({ db: h.db, api: bot2.api, adminIds: [ADMIN_ID] });
    h.bot = bot2;
    await p.text('ул. Ленина, 12');
    expect(p.last()).toContain('Куда едете?');
  });
});
