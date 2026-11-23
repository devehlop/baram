import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { submitRequest } from '../src/bot/actions.js';
import { addDays, todayKey } from '../src/lib/time.js';
import { approvedDriver, dbId, passenger, postTrip, setup, type Harness } from './helpers.js';

const NOW = '2026-11-10T06:00:00Z'; // вт, 10 ноября 2026, 09:00 МСК

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

/** Заявка пассажира на завтра (как если бы он прошёл поиск). */
async function requestTomorrow(tgId: number) {
  return submitRequest({
    userId: await dbId(tgId),
    directionId: 1,
    fromSide: 'a',
    day: addDays(todayKey(), 1),
    timeKind: 'morning',
    passenger: { name: 'Айгуль', phone: '+79170000002', type: 'adult' },
    from: { localityId: 1, address: 'ул. Ленина, 12' },
    to: { localityId: 2, address: 'ул. Деловая, 7' },
    seats: 2,
    childSeat: 'own',
    baggage: 'suitcase',
  });
}

describe('доска: все рейсы и заявки', () => {
  it('рейсы и заявки по дням и направлениям в одном сообщении, у заявок — имя без телефона и адреса', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    await passenger(h, 101, 'Айгуль', '+79170000002');
    const v = await passenger(h, 102, 'Динар', '+79170000004');
    await postTrip(201, { time: '17:00' });
    await postTrip(202, { time: '18:00', fromSide: 'b' });
    await requestTomorrow(101);

    await v.text('📋 Доска');
    expect(v.last()).toContain('Буинск → Казань · Сегодня');
    // Нажатие на уже выбранную вкладку и «Обновить» без новостей оставляют то же самое сообщение.
    const boardId = h.tg.of(102)[0]!.messageId;
    await v.press('🚗 Рейсы · 1');
    await v.press('Обновить');
    expect(h.tg.of(102).map((m) => m.messageId)).toEqual([boardId]);
    expect(v.last()).toContain('<b>17:00</b> · Ильдар');
    expect(v.last()).not.toContain('Рамиль'); // он едет в обратную сторону
    expect(v.buttons()).toContain('🚗 Рейсы · 1');
    expect(v.buttons()).toContain('🙋 Ищут попутку · 0');

    // Направление и день — кнопками в том же сообщении.
    await v.press('Казань → Буинск');
    expect(v.last()).toContain('<b>18:00</b> · Рамиль');
    await v.press('Буинск → Казань');
    await v.press('Завтра ▶');
    await v.press('🙋 Ищут попутку');
    const text = v.last();
    expect(text).toContain('<b>утром</b> · Айгуль · Буинск → Казань · 2 места · чемодан · 👶');
    expect(text).not.toContain('917');
    expect(text).not.toContain('Ленина');
    // Пассажир заявку взять не может, а водитель — может, прямо с доски.
    expect(v.buttons().some((b) => b.includes('Беру'))).toBe(false);
    expect(h.tg.of(102)).toHaveLength(1); // всё листание — в одном сообщении

    await d.text('📋 Доска');
    await d.press('Завтра ▶');
    await d.press('🙋 Ищут попутку');
    expect(d.buttons().some((b) => b.startsWith('✋ Беру: утром'))).toBe(true);
  });

  it('«Еду» с доски — сразу бронь этого рейса в том же сообщении; заявка — сразу с вопроса о времени', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await postTrip(201, { time: '17:00' });

    await p.text('📋 Доска');
    await p.press('Еду: 17:00 · Ильдар');
    expect(p.last()).toContain('Откуда вас забрать?');
    expect(h.tg.of(101)).toHaveLength(1);

    await p.text('📋 Доска');
    await p.press('▶');
    expect(p.last()).toContain('На этот день рейсов пока нет');
    await p.press('Оставить заявку');
    expect(p.last()).toContain('В какое время?');
    expect(p.last()).toContain('Буинск → Казань · завтра');
  });

  it('«📷 Фото машины» в карточке брони: фото приходят в чат, карточка встаёт под ними', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await postTrip(201, { time: '17:00' });

    await p.text('📋 Доска');
    await p.press('Еду: 17:00 · Ильдар');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    expect(p.last()).toContain('Проверьте и бронируйте');
    const cardId = h.tg.of(101).at(-1)!.messageId;

    await p.press('📷 Фото машины');
    const chat = h.tg.of(101);
    const album = chat.find((m) => m.photos > 0)!;
    expect(album.photos).toBe(2);
    // Карточка — последним сообщением, под фото, и это новое сообщение: старое убрано.
    expect(chat.at(-1)!.text).toContain('Проверьте и бронируйте');
    expect(chat.at(-1)!.messageId).toBeGreaterThan(album.messageId);
    expect(chat.some((m) => m.messageId === cardId)).toBe(false);

    await p.press('✅ Забронировать');
    expect(p.all()).toContain('Ильдар');
    expect(p.last()).not.toContain('Проверьте и бронируйте');
  });

  it('больше 10 заявок — листаются страницами в том же сообщении', async () => {
    await passenger(h, 101, 'Айгуль', '+79170000002');
    const v = await passenger(h, 102, 'Динар', '+79170000004');
    for (let i = 0; i < 12; i++) await requestTomorrow(101);
    await v.text('📋 Доска');
    await v.press('Завтра ▶');
    await v.press('🙋 Ищут попутку');
    expect(v.last()).toContain('Показаны 1–10 из 12');
    await v.press('Дальше ▶');
    expect(v.last()).toContain('Показаны 11–12 из 12');
    await v.press('◀ Раньше');
    expect(v.last()).toContain('Показаны 1–10 из 12');
    expect(h.tg.of(102)).toHaveLength(1);
  });

  it('адрес Mini App с ошибкой не ломает доску — просто нет кнопки приложения', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    app.miniappUrl = 'baram.example.ru';
    try {
      await p.text('📋 Доска');
      expect(p.last()).toContain('📋 <b>Доска</b>');
      expect(p.buttons()).not.toContain('📱 Открыть в приложении');
      app.miniappUrl = 'https://baram.example.ru/app';
      await p.text('📋 Доска');
      expect(p.buttons()).toContain('📱 Открыть в приложении');
    } finally {
      app.miniappUrl = undefined;
    }
  });

  it('итог заявки остаётся в чате: кнопка «Доска» открывает доску отдельным сообщением', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('📋 Доска');
    await p.press('Оставить заявку');
    await p.press('Вечером');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    await p.press('Отправить заявку');
    expect(p.last()).toContain('Заявка отправлена водителям');
    await p.press('📋 Доска');
    expect(p.last()).toContain('📋 <b>Доска</b>');
    const receipt = h.tg.of(101).find((m) => m.text.includes('Заявка отправлена водителям'));
    expect(receipt?.inline.flat().map((b) => b.text)).toContain('Отменить заявку');
  });

  it('команда /board открывает доску', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('/board');
    expect(p.last()).toContain('📋 <b>Доска</b>');
    expect(p.buttons()).toContain('Обновить');
  });
});
