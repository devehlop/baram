import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runJobs } from '../src/jobs/runner.js';
import { listTripBookings } from '../src/services/bookings.js';
import { getTrip, listDriverTrips } from '../src/services/trips.js';
import { approvedDriver, dbId, passenger, setClock, setup, type Harness } from './helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

describe('главный сценарий: рейс → поиск → бронь → поездка', () => {
  it('проходит целиком кнопками', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    // Водитель выкладывает рейс по шагам.
    await d.text('➕ Выложить рейс');
    expect(d.last()).toContain('Куда едете?');
    await d.press('Буинск → Казань');
    await d.press('Сегодня');
    await d.press('17:00');
    await d.press('От дома до дома');
    await d.press('Нет');
    await d.press('3');
    await d.press('Свободен');
    expect(d.last()).toContain('Проверьте рейс');
    expect(d.last()).toContain('вт, 10 ноября в 17:00');
    await d.press('Выложить');
    expect(d.last()).toContain('Рейс выложен');
    const [trip] = await listDriverTrips(await dbId(201));
    expect(trip).toMatchObject({ route: 'Буинск → Казань', seatsFree: 3, price: 800 });

    // Пассажир: куда → когда → рейс → откуда и куда забрать → карточка → «Забронировать».
    await p.text('🚗 Найти поездку');
    expect(p.last()).toContain('Куда едете?');
    await p.press('Буинск → Казань');
    await p.press('Сегодня');
    expect(p.last()).toContain('1 рейс на этот день');
    expect(p.last()).toContain('Lada Largus, 2019, белый');
    expect(p.last()).not.toContain('А123ВС116'); // госномер — только после подтверждения
    await p.press('17:00 · Ильдар');
    expect(p.last()).toContain('Откуда вас забрать?');
    expect(p.buttons()).not.toContain('Казань'); // только города стороны отправления
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    expect(p.last()).toContain('Куда вас отвезти?');
    expect(p.buttons()).not.toContain('Буинск');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    // Всё остальное заполнено самым частым ответом: я, 1 место, сумка, без ребёнка.
    expect(p.last()).toContain('Проверьте и бронируйте');
    expect(p.last()).toContain('Едет: Я сам');
    expect(p.last()).toContain('1 место · только сумка или рюкзак');
    expect(p.last()).toContain('800 ₽');
    await p.press('Забронировать');
    expect(p.last()).toContain('Заявка на бронь отправлена водителю');
    expect((await getTrip(trip!.id))!.seatsFree).toBe(2); // место удержано сразу
    // Одно окно: весь поиск прошёл в одном сообщении, ответы человека убраны из чата.
    expect(h.tg.of(101)).toHaveLength(1);

    // Водитель принимает.
    expect(d.last()).toContain('Новая бронь');
    expect(d.last()).toContain('Новый пассажир');
    await d.press('Принять');
    expect(p.fresh()).toContain('Водитель подтвердил бронь');
    expect(p.all()).toContain('А123ВС116');

    // За 3 часа до выезда — «Едете?»
    setClock('2026-11-10T11:30:00Z'); // 14:30
    await runJobs();
    expect(p.last()).toContain('Едете сегодня в 17:00?');
    await runJobs(); // второй проход не дублирует вопрос
    expect(h.tg.of(101).filter((m) => m.text.includes('Едете сегодня')).length).toBe(1);
    await p.press('Да, еду');
    expect(d.last()).toContain('подтвердил поездку');

    // Поездка.
    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    expect(d.last()).toContain('Пассажиры по порядку объезда');
    await d.press('Выехал');
    expect(p.last()).toContain('Водитель Ильдар выехал');
    await d.press('Айгуль');
    expect(d.last()).toContain('ул. Ленина, 12');
    await d.press('10 мин');
    expect(p.last()).toContain('примерно через 10 минут');
    // Статус поездки — одно «живое» сообщение: «Выехал» сменилось на «Буду через 10 минут».
    expect(p.all()).not.toContain('Водитель Ильдар выехал');
    // Телефон водителя при этом не теряется.
    expect(p.last()).toContain('Телефон водителя: +7 917 000-00-01');
    await d.press('Забрал');
    await d.press('Доехали');
    expect(d.last()).toContain('Рейс завершён');
    expect(p.last()).toContain('Поездка завершена');
    const [b] = await listTripBookings(trip!.id, ['completed']);
    expect(b).toMatchObject({ status: 'completed', passengerName: 'Айгуль' });
  });

  it('«Назад» и правка в карточке; «Мои поездки», «Обратно», «Как в прошлый раз»', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const { postTrip } = await import('./helpers.js');
    await postTrip(201, { time: '17:00' });
    await postTrip(201, { fromSide: 'b', dayOffset: 2, time: '18:00' });

    await p.text('🚗 Найти поездку');
    await p.press('Буинск → Казань');
    await p.press('Сегодня');
    await p.press('17:00 · Ильдар');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Назад'); // с вопроса «Куда» — обратно на «Откуда»
    expect(p.last()).toContain('Откуда вас забрать?');
    await p.press('Буинск');
    await p.text('ул. Ленина, 14');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');

    // Правка прямо в карточке: места, багаж, комментарий.
    await p.press('💺');
    await p.press('2');
    expect(p.last()).toContain('1 600 ₽');
    await p.press('🧳');
    await p.press('Чемодан');
    await p.press('💬');
    await p.text('Позвоните заранее');
    expect(p.last()).toContain('Позвоните заранее');
    expect(p.last()).toContain('чемодан или большая сумка');
    await p.press('💺');
    await p.press('1');
    expect(p.last()).toContain('800 ₽');
    expect(p.last()).toContain('ул. Ленина, 14');
    await p.press('Забронировать');
    expect(p.last()).toContain('Запомнить адрес');

    // Сохраняем адрес «откуда» как «Дом» — и возвращаемся к карточке брони.
    await p.press('Буинск, ул. Ленина, 14');
    await p.press('Дом');
    expect(p.last()).toContain('Сохранено: Дом');
    expect(p.last()).toContain('ул. Деловая, 7');

    await d.press('Принять');

    // «Мои поездки» → «Обратно»: адреса меняются местами, спрашиваем только день и рейс.
    await p.text('🔁 Мои поездки');
    expect(p.buttons().some((x) => x.includes('Буинск → Казань'))).toBe(true);
    await p.press('Буинск → Казань');
    await p.press('Обратно');
    expect(p.last()).toContain('Казань → Буинск');
    await p.press('Чт 12.11');
    await p.press('18:00 · Ильдар');
    expect(p.last()).toContain('Проверьте и бронируйте');
    expect(p.last()).toContain('Откуда: Казань, ул. Деловая, 7');

    // Новый поиск: первой кнопкой — «Как в прошлый раз», а сохранённый адрес — первым на шаге «Откуда».
    await p.text('🚗 Найти поездку');
    expect(p.buttons()[0]).toContain('Как в прошлый раз');
    await p.press('Буинск → Казань');
    await p.press('Сегодня');
    await p.press('17:00 · Ильдар');
    expect(p.buttons()[0]).toContain('Дом · Буинск, ул. Ленина, 14');
  });
});
