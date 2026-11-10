import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../src/api/auth.js';
import { createApi } from '../src/api/server.js';
import { getBooking } from '../src/services/bookings.js';
import { getTrip } from '../src/services/trips.js';
import { approvedDriver, passenger, postTrip, setup, type Harness } from './helpers.js';

const TOKEN = '1:TEST';
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
let api: ReturnType<typeof createApi>;
beforeEach(async () => {
  h = await setup({ now: NOW });
  api = createApi({ botToken: TOKEN });
});
afterEach(() => h.close());

/** Запрос к API от имени пользователя Telegram с настоящей подписью initData. */
async function call(tgId: number | null, method: string, path: string, body?: unknown) {
  const res = await api.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(tgId ? { authorization: `tma ${signInitData({ id: tgId, first_name: 'T' }, TOKEN)}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const ride = {
  from: { localityId: 1, address: 'ул. Ленина, 12' },
  to: { localityId: 2, address: 'ул. Деловая, 7' },
  seats: 1,
  childSeat: 'none',
  baggage: 'bag',
};

describe('подпись Telegram', () => {
  it('принимает верную подпись, отвергает подделку и устаревшие данные', () => {
    const good = signInitData({ id: 42 }, TOKEN);
    expect(verifyInitData(good, TOKEN)).toMatchObject({ id: 42 });
    expect(verifyInitData(good, 'другой:токен')).toBeNull();
    expect(verifyInitData(good.replace('%22id%22%3A42', '%22id%22%3A43'), TOKEN)).toBeNull(); // подменили ID
    const old = signInitData({ id: 42 }, TOKEN, Math.floor(Date.now() / 1000) - 2 * 24 * 3600);
    expect(verifyInitData(old, TOKEN)).toBeNull();
    expect(verifyInitData('', TOKEN)).toBeNull();
  });

  it('без подписи API закрыт; незарегистрированному доступно только /api/me', async () => {
    expect((await call(null, 'GET', '/api/me')).status).toBe(401);
    const me = await call(777, 'GET', '/api/me');
    expect(me.json).toMatchObject({ registered: false });
    expect((await call(777, 'GET', '/api/form')).status).toBe(403);
  });
});

describe('пассажир в Mini App', () => {
  it('поиск → бронь → подтверждение → отмена; номер машины открывается только после «Принять»', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });

    const form = await call(101, 'GET', '/api/form');
    expect(form.json.localities.map((l: any) => l.name)).toEqual(['Буинск', 'Казань']);
    expect(form.json.days[0]).toMatchObject({ day: '2026-11-10', label: 'Сегодня' });

    const found = await call(101, 'POST', '/api/search', { fromLocalityId: 1, toLocalityId: 2, day: '2026-11-10', timeKind: 'evening', seats: 1 });
    expect(found.json.exact).toHaveLength(1);
    expect(found.json.exact[0].driver).not.toHaveProperty('plate');
    expect(found.json.exact[0].driver).not.toHaveProperty('phone');
    expect(found.json.exact[0].driver).not.toHaveProperty('payPhone');

    // Обратное направление тем же рейсом забронировать нельзя.
    const wrong = await call(101, 'POST', '/api/bookings', { ...ride, tripId: trip.id, from: ride.to, to: ride.from });
    expect(wrong.status).toBe(400);

    const made = await call(101, 'POST', '/api/bookings', { ...ride, tripId: trip.id });
    expect(made.status).toBe(200);
    const id = made.json.booking.id;
    expect(d.last()).toContain('Новая бронь'); // водитель получил уведомление в чате

    let mine = await call(101, 'GET', `/api/bookings/${id}`);
    expect(mine.json.booking.status).toBe('pending');
    expect(mine.json.trip.driver).not.toHaveProperty('plate');

    await d.press('Принять');
    mine = await call(101, 'GET', `/api/bookings/${id}`);
    expect(mine.json.trip.driver).toMatchObject({ plate: 'А123ВС116', phone: '+79170000001' });

    // Чужую бронь не видно и не отменить.
    await passenger(h, 102, 'Чужой', '+79170000005');
    expect((await call(102, 'GET', `/api/bookings/${id}`)).status).toBe(404);
    expect((await call(102, 'POST', `/api/bookings/${id}/cancel`)).status).toBe(409);

    const cancel = await call(101, 'POST', `/api/bookings/${id}/cancel`);
    expect(cancel.json).toMatchObject({ late: false });
    expect((await getTrip(trip.id))!.seatsFree).toBe(3);
  });

  it('бронь за другого человека и заявка, когда рейса нет', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await passenger(h, 101, 'Данис', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });

    const bad = await call(101, 'POST', '/api/bookings', { ...ride, tripId: trip.id, passenger: { name: 'x1', phone: '12345678901', type: 'adult' } });
    expect(bad.status).toBe(400);

    const made = await call(101, 'POST', '/api/bookings', { ...ride, tripId: trip.id, passenger: { name: 'гульнара', phone: '8 917 555-44-33', type: 'teen' } });
    expect(made.json.booking).toMatchObject({ passengerName: 'Гульнара', passengerPhone: '+79175554433', passengerType: 'teen', isSelf: false });
    expect((await call(101, 'GET', '/api/form')).json.passengers).toMatchObject([{ name: 'Гульнара' }]);

    const req = await call(101, 'POST', '/api/requests', { ...ride, day: '2026-11-12', timeKind: 'morning' });
    expect(req.json).toMatchObject({ escalateMinutes: 30, request: { status: 'open', route: 'Буинск → Казань' } });
    expect((await call(101, 'GET', '/api/bookings')).json.requests).toHaveLength(1);
  });
});

describe('водитель в Mini App', () => {
  it('главная, выкладка рейса с проверками, бронь, поездка', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    expect((await call(101, 'GET', '/api/driver/home')).status).toBe(403); // не водитель

    const trip = { directionId: 1, fromSide: 'a', day: '2026-11-10', minutes: 17 * 60, pickupMode: 'points', pickupPoints: 'ТЦ Мега, Горки', villages: false, seats: 3, trunk: 'free', price: 500 };
    const posted = await call(201, 'POST', '/api/driver/trips', trip);
    expect(posted.json.trip).toMatchObject({ route: 'Буинск → Казань', pickupPoints: ['ТЦ Мега', 'Горки'], seatsFree: 3 });
    expect((await call(201, 'POST', '/api/driver/trips', trip)).json).toEqual({ error: 'duplicate' });
    expect((await call(201, 'POST', '/api/driver/trips', { ...trip, minutes: 8 * 60 })).json).toEqual({ error: 'past' });
    expect((await call(201, 'POST', '/api/driver/trips', { ...trip, day: '2026-11-11', seats: 6 })).json).toEqual({ error: 'seats' });
    const tripId = posted.json.trip.id;

    const made = await call(101, 'POST', '/api/bookings', { ...ride, tripId, pickupPoint: 'Горки' });
    const bookingId = made.json.booking.id;

    const home = await call(201, 'GET', '/api/driver/home');
    expect(home.json.trips).toHaveLength(1);
    expect(home.json.pending).toMatchObject([{ booking: { id: bookingId, passengerName: 'Айгуль', pickupPoint: 'Горки' } }]);
    expect(home.json.routes.map((r: any) => r.label)).toEqual(['Буинск → Казань', 'Казань → Буинск']);

    // Чужой водитель не может управлять рейсом и бронью.
    await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    expect((await call(202, 'GET', `/api/driver/trips/${tripId}`)).status).toBe(404);
    expect((await call(202, 'POST', `/api/driver/bookings/${bookingId}/accept`)).status).toBe(409);
    expect((await call(202, 'POST', `/api/driver/trips/${tripId}/cancel`)).status).toBe(409);

    expect((await call(201, 'POST', `/api/driver/bookings/${bookingId}/accept`)).status).toBe(200);
    expect(p.last()).toContain('Водитель подтвердил бронь');
    expect((await call(201, 'POST', `/api/driver/trips/${tripId}/depart`)).status).toBe(200);
    expect(p.last()).toContain('выехал');
    expect((await call(201, 'POST', `/api/driver/bookings/${bookingId}/eta`, { minutes: 10 })).status).toBe(200);
    expect((await call(201, 'POST', `/api/driver/bookings/${bookingId}/pickup`)).status).toBe(200);
    const view = await call(201, 'GET', `/api/driver/trips/${tripId}`);
    expect(view.json.bookings[0].status).toBe('picked_up');
    expect((await call(201, 'POST', `/api/driver/trips/${tripId}/complete`)).status).toBe(200);
    expect((await getBooking(bookingId))!.status).toBe('completed');
    expect(p.last()).toContain('Поездка завершена');
  });
});
