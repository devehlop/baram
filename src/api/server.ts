import { timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { z } from 'zod';
import { app as deps, isAdminTg } from '../app.js';
import {
  acceptBookingAction,
  cancelByPassenger,
  cancelTripAction,
  completeTripAction,
  confirmRideAction,
  declineBookingAction,
  departAction,
  etaAction,
  noShowAction,
  pickUpAction,
  prepaidAction,
  publishTrip,
  submitBooking,
  submitRequest,
} from '../bot/actions.js';
import { dayOptions } from '../bot/conversations/common.js';
import { cleanName } from '../bot/conversations/registration.js';
import type { UserRow } from '../db/schema.js';
import { normalizePhone, splitList } from '../lib/format.js';
import { fromDayMinutes } from '../lib/time.js';
import { log } from '../logger.js';
import { parseMaxJson } from '../max/client.js';
import { getBooking, listTripBookings, listUserBookings, type BookingView } from '../services/bookings.js';
import { getLocality, listDirections, listLocalities, routeLabel } from '../services/directions.js';
import { driverDirectionIds, getDriver } from '../services/drivers.js';
import { getRequest, listOpenRequestsForDriver, listUserOpenRequests } from '../services/requests.js';
import { listAddresses, listPassengers, savePassenger } from '../services/saved.js';
import { listRoutes, openRequests, openTrips, requestForSelf } from '../services/board.js';
import { getAvatar, getImage, type Image } from '../services/photos.js';
import { searchTrips } from '../services/search.js';
import { loadSettings } from '../services/settings.js';
import { getTrip, lastTrip, listDriverTrips, type TripView } from '../services/trips.js';
import { getUserByTg, setActiveRole } from '../services/users.js';
import { verifyInitData } from './auth.js';

export interface ApiOptions {
  botToken: string;
  /** Только для локального просмотра без Telegram: считать все запросы запросами этого пользователя. */
  devTelegramId?: number;
  /** Папка с собранным Mini App (miniapp/dist). */
  staticDir?: string;
  /** Вебхук бота в MAX: POST /max/webhook с секретом в заголовке. */
  maxWebhook?: { secret: string; push: (update: any) => Promise<void> };
}

type Env = { Variables: { tgId: number; user: UserRow } };

/** Рейс для пассажира до подтверждения брони: без госномера, телефона и реквизитов. Фото машины — только их число. */
function publicTrip(t: TripView) {
  const { phone: _p, plate: _pl, payPhone: _pp, payBank: _pb, telegramId: _tg, fullName: _fn, photos, ...driver } = t.driver;
  return { ...t, driver: { ...driver, photoCount: photos.length } };
}

/** Рейс для пассажира с бронью: после «Принять» открываются номер машины, телефон и реквизиты. */
function tripForBooking(t: TripView, b: BookingView) {
  const accepted = ['accepted', 'confirmed', 'picked_up', 'completed'].includes(b.status);
  if (!accepted) return publicTrip(t);
  const { telegramId: _tg, photos, ...driver } = t.driver;
  return { ...t, driver: { ...driver, photoCount: photos.length } };
}

/** Картинка в ответ: байты из Telegram. Ссылку на файл не отдаём — в ней токен бота. */
function imageResponse(img: Image | null): Response {
  if (!img) return Response.json({ error: 'not_found' }, { status: 404 });
  return new Response(img.bytes, { headers: { 'content-type': img.type, 'cache-control': 'private, max-age=3600' } });
}

const place = z.object({
  localityId: z.number().int().positive(),
  address: z.string().trim().min(3).max(120),
  lat: z.number().nullish(),
  lon: z.number().nullish(),
});

const rideFields = {
  passenger: z
    .object({ name: z.string().trim().min(2).max(40), phone: z.string().min(10).max(20), type: z.enum(['adult', 'teen', 'child']) })
    .nullish(),
  from: place,
  to: place,
  seats: z.number().int().min(1).max(6),
  childSeat: z.enum(['none', 'own', 'driver']),
  baggage: z.enum(['bag', 'suitcase', 'many']),
  baggageNote: z.string().trim().max(200).nullish(),
  comment: z.string().trim().max(300).nullish(),
};

const timeFields = {
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeKind: z.enum(['morning', 'day', 'evening', 'exact']),
  exactMinutes: z.number().int().min(0).max(1439).nullish(),
};

const bookingBody = z.object({ ...rideFields, tripId: z.number().int().positive(), pickupPoint: z.string().trim().max(80).nullish() });
const requestBody = z.object({ ...rideFields, ...timeFields });
const searchBody = z.object({
  fromLocalityId: z.number().int().positive(),
  toLocalityId: z.number().int().positive(),
  seats: z.number().int().min(1).max(6),
  needChildSeat: z.boolean().optional(),
  ...timeFields,
});
const tripBody = z.object({
  directionId: z.number().int().positive(),
  fromSide: z.enum(['a', 'b']),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.number().int().min(0).max(1439),
  pickupMode: z.enum(['door', 'points', 'mixed']),
  pickupPoints: z.string().max(300).default(''),
  villages: z.boolean(),
  villagesNote: z.string().trim().max(120).nullish(),
  seats: z.number().int().min(1).max(6),
  trunk: z.enum(['free', 'half', 'full']),
  // Цену водитель не задаёт: она берётся из направления. Поле от старых версий Mini App игнорируется.
});

/** Направление и сторона по паре «откуда — куда». null, если такой поездки нет. */
async function routeOf(fromLocalityId: number, toLocalityId: number) {
  const [from, to] = await Promise.all([getLocality(fromLocalityId), getLocality(toLocalityId)]);
  if (!from || !to || from.directionId !== to.directionId || from.side === to.side) return null;
  return { directionId: from.directionId, fromSide: from.side };
}

export function createApi(opts: ApiOptions): Hono<Env> {
  const api = new Hono<Env>();

  api.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: 'bad_request', issues: err.issues.map((i) => i.path.join('.')) }, 400);
    log.error({ err, path: c.req.path }, 'Ошибка API');
    return c.json({ error: 'server_error' }, 500);
  });

  // Кто пришёл: проверяем подпись Telegram на каждом запросе. Кнопке в интерфейсе не доверяем.
  // Вебхук MAX. Отвечаем сразу, а обрабатываем после: MAX ждёт ответа не дольше 30 секунд
  // и при ошибке присылает то же обновление повторно.
  const hook = opts.maxWebhook;
  if (hook) {
    api.post('/max/webhook', async (c) => {
      const given = c.req.header('x-max-bot-api-secret') ?? '';
      if (given.length !== hook.secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(hook.secret))) {
        return c.json({ error: 'forbidden' }, 403);
      }
      let update: unknown = null;
      try {
        update = parseMaxJson(await c.req.text());
      } catch {
        return c.json({ error: 'bad_json' }, 400);
      }
      if (update && typeof update === 'object') void hook.push(update);
      return c.json({ ok: true });
    });
  }

  api.use('/api/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const tg = header.startsWith('tma ') ? verifyInitData(header.slice(4), opts.botToken) : null;
    const tgId = tg?.id ?? opts.devTelegramId;
    if (!tgId) return c.json({ error: 'unauthorized' }, 401);
    c.set('tgId', tgId);
    const user = await getUserByTg(tgId);
    if (user?.restriction === 'blocked') return c.json({ error: 'blocked' }, 403);
    if (!user && c.req.path !== '/api/me') return c.json({ error: 'not_registered' }, 403);
    if (user) c.set('user', user);
    await next();
  });

  api.get('/api/me', async (c) => {
    const user = c.get('user') as UserRow | undefined;
    const s = await loadSettings();
    const base = { botUsername: deps.botUsername ?? null, dispatcherPhone: s.dispatcher_phone || null };
    if (!user) return c.json({ registered: false, ...base });
    const d = await getDriver(user.id);
    return c.json({
      registered: true,
      ...base,
      user: { id: user.id, name: user.name, phone: user.phone, activeRole: user.activeRole },
      driver: d ? { status: d.status, car: d.car, plate: d.plate, seats: d.seats, badge: d.badge } : null,
      isAdmin: isAdminTg(user.telegramId),
      prepay: s.big_baggage_prepay,
      lateCancelHours: s.late_cancel_hours,
    });
  });

  api.post('/api/role', async (c) => {
    const { role } = z.object({ role: z.enum(['passenger', 'driver']) }).parse(await c.req.json());
    if (role === 'driver' && !(await getDriver(c.get('user').id))) return c.json({ error: 'not_driver' }, 403);
    await setActiveRole(c.get('user').id, role);
    return c.json({ ok: true });
  });

  // ——— Пассажир ———

  api.get('/api/form', async (c) => {
    const user = c.get('user');
    const s = await loadSettings();
    const [localities, addresses, passengers, mine] = await Promise.all([
      listLocalities(),
      listAddresses(user.id),
      listPassengers(user.id),
      listUserBookings(user.id),
    ]);
    // Последняя поездка — для карточки «Ваш частый маршрут».
    const lastBooking = [...mine.upcoming, ...mine.past].map((x) => x.booking).find((b) => b.from && b.to) ?? null;
    return c.json({ localities, addresses, passengers, days: dayOptions(s.trip_horizon_days), lastBooking });
  });

  api.post('/api/search', async (c) => {
    const q = searchBody.parse(await c.req.json());
    const route = await routeOf(q.fromLocalityId, q.toLocalityId);
    if (!route) return c.json({ error: 'no_route' }, 400);
    const res = await searchTrips({ ...route, ...q, excludeDriverId: c.get('user').id });
    return c.json({ exact: res.exact.map(publicTrip), near: res.near.map(publicTrip) });
  });

  // ——— Доска: открытые рейсы и заявки на день. Видна всем, у заявок — имя пассажира, без телефонов и адресов. ———
  api.get('/api/board', async (c) => {
    const s = await loadSettings();
    const routes = await listRoutes();
    const days = dayOptions(s.trip_horizon_days);
    const [dir, side] = (c.req.query('route') ?? '').split('-');
    const route = routes.find((r) => String(r.directionId) === dir && r.fromSide === side) ?? routes[0] ?? null;
    const wanted = c.req.query('day');
    const day = days.find((d) => d.day === wanted)?.day ?? days[0]!.day;
    if (!route) return c.json({ routes, days, route, day, trips: [], requests: [] });
    const q = { directionId: route.directionId, fromSide: route.fromSide, day };
    const [trips, requests] = await Promise.all([openTrips(q), openRequests(q)]);
    return c.json({ routes, days, route, day, trips: trips.map(publicTrip), requests });
  });

  // ——— Картинки: фото машины и фото профиля Telegram. Mini App грузит их с той же подписью initData. ———

  // Фото машины видны всем, кто видит рейс: пассажир заранее знает, на чём поедет.
  api.get('/api/trips/:id/photos/:n', async (c) => {
    const trip = await getTrip(Number(c.req.param('id')));
    const fileId = trip?.driver.photos[Number(c.req.param('n'))];
    return imageResponse(fileId ? await getImage(fileId) : null);
  });

  api.get('/api/trips/:id/avatar', async (c) => {
    const trip = await getTrip(Number(c.req.param('id')));
    return imageResponse(trip ? await getAvatar(trip.driver.telegramId) : null);
  });

  // Фото профиля пассажира — только у открытой заявки и только если он едет сам, а не кто-то за него.
  api.get('/api/requests/:id/avatar', async (c) => {
    const r = await getRequest(Number(c.req.param('id')));
    const ok = r && (r.status === 'open' || r.user.id === c.get('user').id) && requestForSelf(r);
    return imageResponse(ok ? await getAvatar(r.user.telegramId) : null);
  });

  /** Пассажир из тела запроса: сам пользователь или другой человек (имя и телефон проверяются). */
  function passengerOf(user: UserRow, p: z.infer<typeof bookingBody>['passenger']) {
    if (!p) return { self: true, value: { name: user.name, phone: user.phone, type: 'adult' as const } };
    const name = cleanName(p.name);
    const phone = normalizePhone(p.phone);
    if (!name || !phone) return null;
    return { self: phone === user.phone, value: { name, phone, type: p.type } };
  }

  api.post('/api/bookings', async (c) => {
    const user = c.get('user');
    const body = bookingBody.parse(await c.req.json());
    const p = passengerOf(user, body.passenger);
    if (!p) return c.json({ error: 'bad_passenger' }, 400);
    const trip = await getTrip(body.tripId);
    const route = await routeOf(body.from.localityId, body.to.localityId);
    if (!trip || !route || route.directionId !== trip.directionId || route.fromSide !== trip.fromSide) {
      return c.json({ error: 'no_route' }, 400);
    }
    const res = await submitBooking({ ...body, bookedBy: user.id, passenger: p.value });
    if (!res.ok) return c.json({ error: res.reason }, 409);
    if (!p.self) await savePassenger(user.id, p.value);
    return c.json({ booking: res.booking, needsAdmin: res.needsAdmin });
  });

  api.post('/api/requests', async (c) => {
    const user = c.get('user');
    const body = requestBody.parse(await c.req.json());
    const p = passengerOf(user, body.passenger);
    const route = await routeOf(body.from.localityId, body.to.localityId);
    if (!p || !route) return c.json({ error: 'bad_request' }, 400);
    const r = await submitRequest({ ...body, ...route, userId: user.id, passenger: p.value });
    if (!p.self) await savePassenger(user.id, p.value);
    const s = await loadSettings();
    return c.json({ request: r, escalateMinutes: s.request_escalate_minutes });
  });

  api.get('/api/bookings', async (c) => {
    const user = c.get('user');
    const mine = await listUserBookings(user.id);
    const withTrip = async (list: typeof mine.upcoming) =>
      Promise.all(
        list.map(async (x) => {
          const trip = await getTrip(x.booking.tripId);
          return { booking: x.booking, trip: trip ? tripForBooking(trip, x.booking) : null };
        }),
      );
    return c.json({
      upcoming: await withTrip(mine.upcoming),
      past: await withTrip(mine.past),
      requests: await listUserOpenRequests(user.id),
    });
  });

  api.get('/api/bookings/:id', async (c) => {
    const b = await getBooking(Number(c.req.param('id')));
    if (!b || b.booker?.id !== c.get('user').id) return c.json({ error: 'not_found' }, 404);
    const trip = (await getTrip(b.tripId))!;
    return c.json({ booking: b, trip: tripForBooking(trip, b) });
  });

  api.post('/api/bookings/:id/cancel', async (c) => {
    const res = await cancelByPassenger(Number(c.req.param('id')), c.get('user').id);
    return res ? c.json(res) : c.json({ error: 'not_available' }, 409);
  });

  api.post('/api/bookings/:id/confirm', async (c) => {
    const ok = await confirmRideAction(Number(c.req.param('id')), c.get('user').id);
    return ok ? c.json({ ok }) : c.json({ error: 'not_available' }, 409);
  });

  // ——— Водитель ———

  api.use('/api/driver/*', async (c, next) => {
    const d = await getDriver(c.get('user').id);
    if (!d) return c.json({ error: 'not_driver' }, 403);
    await next();
  });

  api.get('/api/driver/home', async (c) => {
    const user = c.get('user');
    const d = (await getDriver(user.id))!;
    const s = await loadSettings();
    const trips = await listDriverTrips(user.id);
    const pending: { booking: BookingView; trip: TripView }[] = [];
    for (const trip of trips) {
      for (const booking of await listTripBookings(trip.id, ['pending'])) pending.push({ booking, trip });
    }
    const dirIds = await driverDirectionIds(user.id);
    const dirs = (await listDirections()).filter((x) => dirIds.includes(x.id));
    return c.json({
      driver: { name: user.name, status: d.status, badge: d.badge, seats: d.seats, rejectReason: d.rejectReason },
      trips,
      pending,
      openRequests: d.status === 'approved' ? (await listOpenRequestsForDriver(user.id)).length : 0,
      last: (await lastTrip(user.id)) ?? null,
      routes: dirs.flatMap((x) => (['a', 'b'] as const).map((side) => ({ directionId: x.id, fromSide: side, label: routeLabel(x, side), price: x.price }))),
      days: dayOptions(s.trip_horizon_days),
    });
  });

  api.get('/api/driver/trips/:id', async (c) => {
    const trip = await getTrip(Number(c.req.param('id')));
    if (!trip || trip.driverId !== c.get('user').id) return c.json({ error: 'not_found' }, 404);
    return c.json({ trip, bookings: await listTripBookings(trip.id) });
  });

  api.post('/api/driver/trips', async (c) => {
    const b = tripBody.parse(await c.req.json());
    const res = await publishTrip({
      driverId: c.get('user').id,
      directionId: b.directionId,
      fromSide: b.fromSide,
      departsAt: fromDayMinutes(b.day, b.minutes),
      pickupMode: b.pickupMode,
      pickupPoints: b.pickupMode === 'door' ? [] : splitList(b.pickupPoints, 5),
      villages: b.villages,
      villagesNote: b.villages ? (b.villagesNote ?? null) : null,
      seats: b.seats,
      trunk: b.trunk,
    });
    if ('problem' in res) return c.json({ error: res.problem }, 409);
    return c.json({ trip: res.trip, waitingRequests: res.waitingRequests });
  });

  api.post('/api/driver/trips/:id/:action', async (c) => {
    const id = Number(c.req.param('id'));
    const me = c.get('user').id;
    const action = c.req.param('action');
    const ok =
      action === 'depart'
        ? await departAction(id, me)
        : action === 'complete'
          ? await completeTripAction(id, me)
          : action === 'cancel'
            ? await cancelTripAction(id, { driverId: me })
            : false;
    return ok ? c.json({ ok }) : c.json({ error: 'not_available' }, 409);
  });

  api.post('/api/driver/bookings/:id/:action', async (c) => {
    const id = Number(c.req.param('id'));
    const me = c.get('user').id;
    const action = c.req.param('action');
    let ok = false;
    if (action === 'accept') ok = await acceptBookingAction(id, me);
    else if (action === 'decline') ok = await declineBookingAction(id, me);
    else if (action === 'pickup') ok = await pickUpAction(id, me);
    else if (action === 'noshow') ok = await noShowAction(id, me);
    else if (action === 'prepaid') ok = await prepaidAction(id, me);
    else if (action === 'eta') {
      const { minutes } = z.object({ minutes: z.number().int().min(1).max(120) }).parse(await c.req.json());
      ok = await etaAction(id, me, minutes);
    }
    return ok ? c.json({ ok }) : c.json({ error: 'not_available' }, 409);
  });

  api.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // Собранный Mini App: статические файлы, а любой другой путь — index.html.
  if (opts.staticDir) {
    api.use('/*', serveStatic({ root: opts.staticDir }));
    api.get('/*', serveStatic({ root: opts.staticDir, path: 'index.html' }));
  }
  return api;
}

export function startApi(opts: ApiOptions & { port: number }): () => void {
  const server = serve({ fetch: createApi(opts).fetch, port: opts.port, hostname: '0.0.0.0' });
  log.info({ port: opts.port }, 'HTTP-сервер запущен (Mini App, вебхук MAX)');
  return () => server.close();
}
