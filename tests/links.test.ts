import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTripBookings } from '../src/services/bookings.js';
import { setChannel } from '../src/services/directions.js';
import { parseStartLink, sourceOf, startPayloadOf } from '../src/services/links.js';
import { getTrip } from '../src/services/trips.js';
import { getUserByTg } from '../src/services/users.js';
import { ADMIN_ID, approvedDriver, dbId, passenger, postTrip, setup, type Harness } from './helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

/** Регистрация пассажира кнопками, начиная с «/start <метка>». */
async function registerVia(id: number, payload: string, name = 'Айгуль') {
  const u = h.user(id, name);
  await u.text(`/start ${payload}`);
  await u.press('Согласен');
  await u.press('Я пассажир');
  await u.text(name);
  await u.contact(`+79170000${id}`);
  return u;
}

describe('метки в ссылках', () => {
  it('разбор: код друга, рейс водителя, рейс из канала, мусор', () => {
    expect(parseStartLink('s_Aigul')).toEqual({ kind: 'source', code: 'aigul' });
    expect(parseStartLink('s_qr_avtovokzal-2')).toEqual({ kind: 'source', code: 'qr_avtovokzal-2' });
    expect(parseStartLink('t_42')).toEqual({ kind: 'trip', tripId: 42, via: 'share' });
    expect(parseStartLink('c_7')).toEqual({ kind: 'trip', tripId: 7, via: 'channel' });
    expect(parseStartLink('s_')).toBeNull();
    expect(parseStartLink('t_abc')).toBeNull();
    expect(parseStartLink('hello')).toBeNull();
    expect(parseStartLink(null)).toBeNull();
    expect(startPayloadOf('/start s_aigul')).toBe('s_aigul');
    expect(startPayloadOf('/start')).toBeNull();
    expect(startPayloadOf('привет')).toBeNull();
  });

  it('метка друга записывается при регистрации и не перезаписывается потом', async () => {
    await registerVia(101, 's_Aigul');
    expect((await getUserByTg(101))!.source).toBe('aigul');

    const u = h.user(101);
    await u.text('/start s_other');
    expect((await getUserByTg(101))!.source).toBe('aigul');
    expect(u.menu()).toContain('🚗 Найти поездку');
  });

  it('без метки и с непонятной меткой источник пустой', async () => {
    await registerVia(101, 'что-то-странное');
    expect((await getUserByTg(101))!.source).toBeNull();
  });

  it('рейс водителя и канал превращаются в понятные источники', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    expect(await sourceOf(`t_${trip.id}`)).toBe(`drv_${await dbId(201)}`);
    expect(await sourceOf(`c_${trip.id}`)).toBe('channel');
    expect(await sourceOf('s_channel')).toBe('channel');
    expect(await sourceOf('t_999999')).toBeNull();
  });
});

describe('«Поделиться рейсом» и бронь по ссылке', () => {
  it('водитель получает объявление со ссылкой; новый человек по ней регистрируется и бронирует этот рейс', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, { time: '17:30', seats: 3, villages: true });

    // Водитель: «Мои рейсы» → рейс → «Поделиться рейсом».
    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    await d.press('Поделиться рейсом');
    const link = `https://t.me/baram_test_bot?start=t_${trip.id}`;
    const msgs = h.tg.of(201);
    const post = msgs[msgs.length - 2]!.text; // само объявление — для пересылки и копирования
    expect(post).toContain('🚗 Еду Буинск → Казань');
    expect(post).toContain('Сегодня, 10 ноября · 17:30');
    expect(post).toContain('Свободно: 3 места · 500 ₽ с человека');
    expect(post).toContain('Забираю от дома');
    expect(post).toContain('Заезжаю в деревни');
    expect(post).not.toContain('+7 917'); // номер в копии водитель допишет сам
    expect(post).toContain(link);
    const shareBtns = msgs[msgs.length - 1]!.inline.flat().filter((b) => b.url);
    expect(shareBtns.map((b) => b.text)).toEqual(['📣 В чат — с телефоном', '📣 В чат — без телефона']);
    expect(shareBtns[0]!.url).toContain('https://t.me/share/url?url=' + encodeURIComponent(link));

    // Пассажир впервые открывает ссылку: регистрация → сразу карточка этого рейса.
    const p = await registerVia(101, `t_${trip.id}`);
    expect((await getUserByTg(101))!.source).toBe(`drv_${await dbId(201)}`);
    expect(p.last()).toContain('Рейс по ссылке');
    expect(p.last()).toContain('17:30');
    expect(p.buttons()).toContain('🚗 Еду с ним');

    // «Еду с ним»: без шага «Когда?» и без поиска.
    await p.press('Еду с ним');
    expect(p.fresh()).toContain('Бронируем место в рейсе');
    expect(p.last()).toContain('Шаг 1 из 6');
    await p.press('Я сам');
    expect(p.last()).toContain('Откуда едете?');
    expect(p.buttons()).toContain('Буинск');
    expect(p.buttons()).not.toContain('Казань'); // рейс идёт из Буинска
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    expect(p.last()).toContain('Шаг 4 из 6');
    expect(p.buttons()).toContain('3');
    expect(p.buttons()).not.toContain('4'); // мест в рейсе всего 3
    await p.press('2');
    await p.press('Нет');
    await p.press('Только сумка');
    await p.press('Пропустить');
    expect(p.last()).toContain('Проверьте поездку');
    expect(p.last()).toContain('вт, 10 ноября в 17:30');
    await p.press('Всё верно');
    expect(p.fresh()).toContain('Заявка на бронь отправлена водителю');

    const [b] = await listTripBookings(trip.id);
    expect(b).toMatchObject({ seats: 2, status: 'pending' });
    expect(d.last()).toContain('Новая бронь');
  });

  it('места заняли, пока человек отвечал, — переходим к обычному поиску на тот же день', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const other = await passenger(h, 102, 'Динар', '+79170000004');
    const trip = await postTrip(201, { time: '17:00', seats: 1 });
    await postTrip(202, { time: '18:00' });

    await p.text(`/start t_${trip.id}`);
    await p.press('Еду с ним');
    await p.press('Я сам');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    await p.press('1');
    await p.press('Нет');
    await p.press('Только сумка');

    // Последнее место забрал другой пассажир.
    await other.text(`/start t_${trip.id}`);
    await other.press('Еду с ним');
    await other.press('Я сам');
    await other.press('Буинск');
    await other.text('ул. Мира, 3');
    await other.press('Казань');
    await other.text('ул. Баумана, 1');
    await other.press('1');
    await other.press('Нет');
    await other.press('Только сумка');
    await other.press('Пропустить');
    await other.press('Всё верно');
    expect((await getTrip(trip.id))!.seatsFree).toBe(0);

    await p.press('Пропустить');
    expect(p.fresh()).toContain('Этот рейс забронировать уже нельзя');
    expect(p.last()).toContain('18:00');
    expect(p.buttons().some((x) => x.includes('18:00 · Рамиль'))).toBe(true);
  });
});

describe('канал и админ', () => {
  it('в посте канала у рейса со свободными местами — ссылка на бронь, под постом — кнопка с меткой канала', async () => {
    await setChannel(1, '-1001234567890');
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, { time: '17:00' });
    const post = h.tg.messages.find((m) => m.chatId === -1001234567890)!;
    expect(post.text).toContain(`<a href="https://t.me/baram_test_bot?start=c_${trip.id}">забронировать</a>`);
    expect(post.inline.flat()[0]!.url).toBe('https://t.me/baram_test_bot?start=s_channel');
  });

  it('«Откуда приходят»: люди, брони и поездки по каждой метке', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    await registerVia(101, 's_aigul', 'Айгуль');
    await registerVia(102, 's_aigul', 'Ляйсан');
    const p = await registerVia(103, `t_${trip.id}`, 'Динар');
    await p.press('Еду с ним');
    await p.press('Я сам');
    await p.press('Буинск');
    await p.text('ул. Мира, 3');
    await p.press('Казань');
    await p.text('ул. Баумана, 1');
    await p.press('1');
    await p.press('Нет');
    await p.press('Только сумка');
    await p.press('Пропустить');
    await p.press('Всё верно');

    const admin = h.user(ADMIN_ID);
    await admin.text('/admin');
    await admin.press('Откуда приходят');
    const text = admin.last();
    expect(text).toContain('за 30 дней');
    expect(text).toContain('aigul: людей 2 · бронировали 0 · броней 0 · доехали 0');
    expect(text).toContain('Рейс водителя Ильдар: людей 1 · бронировали 1 · броней 1 · доехали 0');
    expect(text).toContain('Без метки: людей 1'); // сам водитель
    expect(text).toContain('https://t.me/baram_test_bot?start=s_aigul');
    await admin.press('За всё время');
    expect(admin.last()).toContain('за всё время');
  });
});

