import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelTripAction } from '../src/bot/actions.js';
import { shareLines, shareRows, shareUrl, tripLink } from '../src/bot/ui/share.js';
import { dbId, approvedDriver, passenger, postTrip, setup, type Harness } from './helpers.js';
import { getTrip, listDriverTrips } from '../src/services/trips.js';
import { listTripBookings } from '../src/services/bookings.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

function shareButtons(d: ReturnType<Harness['user']>) {
  const msgs = h.tg.of(d.id);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const urls = msgs[i]!.inline.flat().filter((b) => b.url?.startsWith('https://t.me/share/url'));
    if (urls.length) return urls;
  }
  return [];
}

function decode(url: string) {
  const u = new URL(url);
  return { link: u.searchParams.get('url')!, text: u.searchParams.get('text')! };
}

describe('кнопка «Поделиться в чате»', () => {
  it('после публикации рейса есть две кнопки: с телефоном и без', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await d.text('➕ Выложить рейс');
    await d.press('Буинск → Казань');
    await d.press('Сегодня');
    await d.press('17:00');
    await d.press('От дома до дома');
    await d.press('Нет');
    await d.press('3');
    await d.press('Свободен');
    await d.text('500 руб');
    await d.press('Выложить');
    expect(d.last()).toContain('Рейс выложен');
    expect(d.last()).toContain('Расскажите о рейсе в чатах');

    const [trip] = await listDriverTrips(await dbId(201));
    const [withPhone, without] = shareButtons(d);
    expect(withPhone!.text).toContain('с телефоном');
    expect(without!.text).toContain('без телефона');

    const a = decode(withPhone!.url!);
    expect(a.link).toBe(`https://t.me/baram_test_bot?start=t_${trip!.id}`);
    expect(a.text).toContain('Еду Буинск → Казань');
    expect(a.text).toContain('Сегодня, 10 ноября · 17:00');
    expect(a.text).toContain('От дома до дома');
    expect(a.text).toContain('Свободно: 3 места · 500 ₽ с человека');
    expect(a.text).toContain('+7 917 000-00-01');
    expect(a.text).toContain('Забронировать место');

    const b = decode(without!.url!);
    expect(b.text).not.toContain('+7 917');
    expect(b.text).toContain('Еду Буинск → Казань');
  });

  it('есть и на экране рейса, и пропадает, когда рейс отменён или мест нет', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, { seats: 1 });
    await d.text('📋 Мои рейсы');
    await d.press('Буинск → Казань');
    expect(shareButtons(d)).toHaveLength(2);

    // Нельзя поделиться рейсом, который уже отменён или заполнен.
    expect(shareRows((await getTrip(trip.id))!)).toHaveLength(2);
    expect(shareRows({ ...(await getTrip(trip.id))!, seatsFree: 0 })).toHaveLength(0);
    await cancelTripAction(trip.id, { driverId: await dbId(201) });
    expect(shareRows((await getTrip(trip.id))!)).toHaveLength(0);
  });

  it('не вылезает за предел ссылки Telegram даже с длинными точками посадки', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, {
      pickupMode: 'mixed',
      pickupPoints: ['Автовокзал Буинск, у главного входа', 'Торговый центр «Мега» на Горках', 'Остановка Северный посёлок', 'Заправка Лукойл на выезде'],
      villages: true,
    });
    for (const phone of [true, false]) {
      const url = shareUrl({ ...trip, driver: { ...trip.driver, childSeat: true } }, phone)!;
      expect(url).toBeTruthy();
      expect(url.length).toBeLessThanOrEqual(1900);
      const { text } = decode(url);
      expect(text).toContain('Еду Буинск → Казань');
      expect(text).toContain('Свободно:');
      if (phone) expect(text).toContain('+7 917 000-00-01');
    }
    expect(shareLines(trip, false).length).toBeGreaterThan(4);
    expect(tripLink(trip.id)).toContain('start=t_');
  });
});

describe('ссылка на рейс из чата', () => {
  it('пассажир открывает ссылку, видит рейс и бронирует без вопросов про день и время', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201, { dayOffset: 1, time: '11:00' });
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    await p.text(`/start t_${trip.id}`);
    expect(p.last()).toContain('Буинск → Казань');
    expect(p.last()).toContain('Ильдар');
    expect(p.last()).not.toContain('А123ВС116');
    expect(p.buttons()).toContain('📲 Забронировать место');

    await p.press('Забронировать место');
    expect(p.fresh()).toContain('Бронируем рейс');
    await p.press('Я сам');
    await p.press('Буинск');
    expect(p.buttons()).not.toContain('Буинск'); // «куда» — только Казань и т. п.
    await p.text('ул. Ленина, 12');
    expect(p.last()).toContain('Куда едете?');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    // День и время не спрашиваем — сразу места.
    expect(p.last()).toContain('Шаг 5 из 7');
    await p.press('1');
    await p.press('Нет');
    await p.press('Только сумка');
    await p.press('Пропустить');
    expect(p.last()).toContain('Нашёлся 1 рейс');
    expect(p.last()).toContain('11:00');
    await p.press('11:00 · Ильдар');
    expect(p.last()).toContain('Проверьте поездку');
    await p.press('Всё верно');

    const list = await listTripBookings(trip.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.passengerName).toBe('Айгуль');
  });

  it('новый человек сначала проходит регистрацию, потом видит рейс', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    const p = h.user(555, 'Новичок');

    await p.text(`/start t_${trip.id}`);
    expect(p.last()).toContain('как пассажир или вы водитель');
    await p.press('Я пассажир');
    await p.text('Рустам');
    await p.contact('+79170000099');
    const all = p.fresh();
    expect(all).toContain('Рустам');
    expect(all).toContain('Буинск → Казань');
    expect(p.buttons()).toContain('📲 Забронировать место');
  });

  it('отменённый рейс: понятный ответ и кнопка поиска', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    await cancelTripAction(trip.id, { driverId: await dbId(201) });
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text(`/start t_${trip.id}`);
    expect(p.last()).toContain('уже недоступен');
    expect(p.buttons()).toContain('🔎 Другие рейсы');
    expect(p.buttons()).not.toContain('📲 Забронировать место');
  });

  it('рейс отменили, пока пассажир отвечал на вопросы: честно говорим и предлагаем заявку', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text(`/start t_${trip.id}`);
    await p.press('Забронировать место');
    await p.press('Я сам');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    await p.press('1');
    await p.press('Нет');
    await p.press('Только сумка');
    await cancelTripAction(trip.id, { driverId: await dbId(201) });
    await p.press('Пропустить');
    expect(p.last()).toContain('уже недоступен');
    expect(p.buttons()).toContain('🔔 Оставить заявку');
  });

  it('несуществующий рейс', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('/start t_999999');
    expect(p.last()).toContain('уже недоступен');
  });

  it('водитель, открыв свою ссылку, не бронирует сам у себя', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const trip = await postTrip(201);
    await d.text(`/start t_${trip.id}`);
    expect(d.last()).toContain('Это ваш рейс');
    expect(d.buttons()).not.toContain('📲 Забронировать место');
  });

  it('обычный /start по-прежнему открывает меню', async () => {
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await p.text('/start');
    expect(p.menu()).toContain('🚗 Найти поездку');
  });
});
