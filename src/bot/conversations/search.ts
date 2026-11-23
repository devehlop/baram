import type { Context } from 'grammy';
import type { Baggage, ChildSeat, PassengerType, Side, TimeKind } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { cut, esc, fmtPhone, money, normalizePhone } from '../../lib/format.js';
import { dayKey, fmtDateTime, fmtDayKey, fmtTime, parseTime } from '../../lib/time.js';
import { getBooking, listUserBookings, type BookingView } from '../../services/bookings.js';
import { listRoutes, nextDayWithTrips, openTrips, type BoardRoute } from '../../services/board.js';
import { listLocalities, type LocalityView } from '../../services/directions.js';
import type { RequestView } from '../../services/requests.js';
import { hasAddress, listAddresses, listPassengers, savePassenger, type SavedAddressView, type SavedPassengerView } from '../../services/saved.js';
import { windowExpired } from '../../services/search.js';
import { loadSettings } from '../../services/settings.js';
import { getTrip, type TripView } from '../../services/trips.js';
import { getUserByTg } from '../../services/users.js';
import { submitBooking, submitRequest } from '../actions.js';
import type { MyConversation } from '../context.js';
import { bookable } from '../landing.js';
import { kb, type Btn } from '../tg.js';
import { baggageLine, bookingForPassenger, carLine, timeLabel, tripButton, tripCard } from '../ui/cards.js';
import { column, grid, runSteps, Wizard, type Opt, type Outcome, type Step } from '../wizard.js';
import { dayButtons, dayOptions, nav, type DayOption } from './common.js';
import { cleanName } from './registration.js';

interface Addr {
  localityId: number;
  directionId: number;
  side: Side;
  city: string;
  village: boolean;
  address: string;
  lat: number | null;
  lon: number | null;
}

interface Passenger {
  name: string;
  phone: string;
  type: PassengerType;
  self: boolean;
}

/** Что можно подставить сразу: прошлая поездка, «Обратно» или «Как в прошлый раз». */
interface Prefill {
  route: BoardRoute;
  from: Addr;
  to: Addr;
  passenger: Passenger;
  seats: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote: string | null;
  comment: string | null;
}

interface SearchState {
  userId: number;
  self: { name: string; phone: string };
  savedPassengers: SavedPassengerView[];
  savedAddresses: SavedAddressView[];
  localities: LocalityView[];
  routes: BoardRoute[];
  days: DayOption[];
  prepay: number;
  escalateMinutes: number;
  /** «Как в прошлый раз» на первом шаге: маршрут, адреса и всё остальное из последней поездки. */
  last: (Prefill & { label: string }) | null;
  route?: BoardRoute;
  day?: string;
  /** Бронь выбранного рейса или заявка водителям, если рейса нет или не подошёл. */
  mode?: 'booking' | 'request';
  trip?: TripView;
  /** Рейс пришёл по ссылке из чата или канала: направление, день и рейс уже известны. */
  pinned: boolean;
  pickupPoint: string | null;
  /** «Откуда» — точка сбора водителя, а не свой адрес: при смене рейса её надо спросить заново. */
  fromIsPoint: boolean;
  timeKind?: TimeKind;
  exactMinutes: number | null;
  // Остальное заполнено самым частым ответом — человек меняет только то, что нужно, прямо в карточке.
  passenger: Passenger;
  from?: Addr;
  to?: Addr;
  seats: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote: string | null;
  comment: string | null;
  outcome?: { booking: BookingView; trip: TripView; needsAdmin: boolean } | { request: RequestView };
}

export type SearchPrefill =
  | {
      /** Повторить прошлую поездку: адреса, пассажир, места и багаж берутся из брони. */
      bookingId: number;
      /** «Обратно»: адреса меняются местами. */
      reverse: boolean;
    }
  | {
      /** «Еду с ним» по ссылке на рейс или с доски. */
      tripId: number;
    }
  | {
      /** С доски: маршрут и день уже выбраны — сразу рейсы этого дня или заявка. */
      directionId: number;
      fromSide: Side;
      day: string;
      request?: boolean;
    };

const addrOf = (l: LocalityView, address: string, lat: number | null = null, lon: number | null = null): Addr => ({
  localityId: l.id,
  directionId: l.directionId,
  side: l.side,
  city: l.name,
  village: l.kind === 'village',
  address,
  lat,
  lon,
});

function dayLabel(s: SearchState, day: string): string {
  return s.days.find((d) => d.day === day)?.label ?? fmtDayKey(day);
}

/** Строка «где мы»: маршрут, день, выбранный рейс или заявка. Стоит над каждым вопросом. */
function crumbs(s: SearchState): string {
  const parts: string[] = [];
  if (s.trip) {
    parts.push(`🚗 ${esc(s.trip.route)}`, `${dayLabel(s, dayKey(s.trip.departsAt)).toLowerCase()}, ${fmtTime(s.trip.departsAt)}`, esc(s.trip.driver.name));
  } else if (s.route) {
    parts.push(`${s.mode === 'request' ? '🙋' : '🚗'} ${esc(s.route.label)}`);
    if (s.day) parts.push(s.mode === 'request' && s.timeKind ? timeLabel(s.day, s.timeKind, s.exactMinutes).toLowerCase() : dayLabel(s, s.day).toLowerCase());
  }
  return parts.join(' · ');
}

const head = (s: SearchState, question: string, note = '') => {
  const c = crumbs(s);
  return `${c ? `<i>${c}</i>\n` : ''}<b>${question}</b>${note ? `\n${note}` : ''}`;
};

/** Место подходит маршруту: «откуда» — со стороны отправления, «куда» — с другой. */
function fits(s: SearchState, l: { directionId: number; side: Side }, isTo: boolean): boolean {
  const r = s.route!;
  return l.directionId === r.directionId && (l.side === r.fromSide) !== isTo;
}

/** Вопрос про адрес: сохранённые адреса, города, деревни; затем улица и дом текстом или геопозицией. */
async function askPlace(w: Wizard, s: SearchState, which: 'from' | 'to'): Promise<Addr | 'back' | 'home'> {
  const isTo = which === 'to';
  const ok = (l: { directionId: number; side: Side }) => fits(s, l, isTo);
  for (;;) {
    const saved = s.savedAddresses.filter(ok);
    const cities = s.localities.filter((l) => l.kind === 'city' && ok(l));
    const villages = s.localities.filter((l) => l.kind === 'village' && ok(l));
    const rows: Opt[][] = [
      ...saved.map((a) => [{ text: cut(`${a.label} · ${a.city}, ${a.address}`, 48), data: `s${a.id}` }]),
      ...cities.map((l) => [{ text: l.name, data: `c${l.id}` }]),
      ...(villages.length ? [[{ text: t('btn-village'), data: 'v' }]] : []),
    ];
    const a = await w.ask({ text: head(s, t(isTo ? 'search-ask-to' : 'search-ask-from'), t('search-place-note')), rows });
    if (a.kind !== 'btn') return a.kind === 'home' ? 'home' : 'back';

    if (a.data.startsWith('s')) {
      const x = saved.find((v) => v.id === Number(a.data.slice(1)))!;
      return { localityId: x.localityId, directionId: x.directionId, side: x.side, city: x.city, village: x.village, address: x.address, lat: x.lat, lon: x.lon };
    }

    let locality: LocalityView | undefined;
    if (a.data === 'v') {
      const v = await w.ask({
        text: head(s, t('search-ask-village')),
        rows: grid(villages.map((l) => ({ text: l.name, data: String(l.id) })), 2),
      });
      if (v.kind === 'home') return 'home';
      if (v.kind !== 'btn') continue;
      locality = villages.find((l) => l.id === Number(v.data));
      await w.say(t('search-village-warning'));
    } else {
      locality = cities.find((l) => l.id === Number(a.data.slice(1)));
    }
    if (!locality) continue;

    const ad = await w.ask({
      text: head(s, t(isTo ? 'search-ask-address-to' : 'search-ask-address', { city: esc(locality.name) })),
      acceptText: true,
      acceptLocation: true,
      hint: t('search-address-hint'),
      validate: (v) => (v.length >= 3 && v.length <= 120 ? null : t('search-address-hint')),
    });
    if (ad.kind === 'home') return 'home';
    if (ad.kind === 'text') return addrOf(locality, ad.text);
    if (ad.kind === 'location') return addrOf(locality, t('address-geo'), ad.lat, ad.lon);
    // «Назад» — снова к выбору места.
  }
}

/** Выбрали рейс: подгоняем ответы под него (места, кресло, точка сбора). */
function useTrip(s: SearchState, trip: TripView): void {
  s.mode = 'booking';
  s.trip = trip;
  s.pickupPoint = null;
  if (s.fromIsPoint) {
    s.from = undefined;
    s.fromIsPoint = false;
  }
  s.seats = Math.max(1, Math.min(s.seats, trip.seatsFree));
  if (s.childSeat === 'driver' && !trip.driver.childSeat) s.childSeat = 'none';
}

const fieldValue = {
  who: (s: SearchState) => (s.passenger.self ? t('who-self') : s.passenger.name),
  baggage: (s: SearchState) => t(`card-baggage-${s.baggage}`),
  child: (s: SearchState) => t(`card-child-${s.childSeat}`),
};

/** Карточка перед бронью или заявкой: всё, что известно, одним экраном. */
function cardText(s: SearchState): string {
  const p = s.passenger;
  const lines: (string | false | null | undefined)[] = [];
  if (s.mode === 'booking' && s.trip) {
    const trip = s.trip;
    lines.push(
      `<b>${t('card-title-booking')}</b>`,
      '',
      `🚗 ${esc(trip.route)}, ${fmtDateTime(trip.departsAt)}`,
      `👤 ${esc(trip.driver.name)}${trip.driver.badge ? ` · ${t('badge-verified')}` : ''} · ${carLine(trip.driver)}`,
      `💰 <b>${money(trip.price * s.seats)}</b>${t('summary-pay-note')}`,
    );
  } else {
    lines.push(`<b>${t('card-title-request')}</b>`, '', `🙋 ${esc(s.route!.label)}, ${timeLabel(s.day!, s.timeKind!, s.exactMinutes)}`);
  }
  lines.push(
    '',
    `${t('booking-rides')}: ${p.self ? t('who-self') : `${esc(p.name)}, ${fmtPhone(p.phone)}`}`,
    `${t('label-from')}: ${esc(s.from!.city)}, ${esc(s.from!.address)}`,
    s.pickupPoint && !s.fromIsPoint && `${t('label-pickup-point')}: ${esc(s.pickupPoint)}`,
    `${t('label-to')}: ${esc(s.to!.city)}, ${esc(s.to!.address)}`,
    `${t('seats-count', { n: s.seats })} · ${baggageLine({ baggage: s.baggage, baggageNote: s.baggageNote })}`,
    s.childSeat !== 'none' && t(`child-seat-${s.childSeat}`),
    s.comment && `💬 ${esc(s.comment)}`,
    s.baggage === 'many' && `\n${t('summary-prepay-note', { amount: money(s.prepay) })}`,
    (s.from!.village || s.to!.village) && `\n${t('search-village-warning')}`,
    (s.from!.village || s.to!.village) && s.trip && !s.trip.villages && `⚠️ ${t('trip-villages-no')}`,
    `\n${t('card-hint')}`,
  );
  return lines.filter((x): x is string => typeof x === 'string').join('\n');
}

const steps: Step<SearchState>[] = [
  {
    id: 'route',
    when: (s) => !s.route,
    run: async (w, s) => {
      const rows: Opt[][] = [];
      if (s.last) rows.push([{ text: cut(`🔁 ${t('btn-as-last-time')} ${s.last.label}`, 60), data: 'last' }]);
      rows.push(...column(s.routes.map((r, i) => ({ text: r.label, data: `r${i}` }))));
      const a = await w.ask({ text: head(s, t('search-ask-route')), rows, back: false });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'last' && s.last) {
        Object.assign(s, { ...s.last, fromIsPoint: false });
        return 'next';
      }
      s.route = s.routes[Number(a.data.slice(1))]!;
      // Маршрут сменился — адреса с прошлого раза ему уже не подходят.
      if (s.from && !fits(s, s.from, false)) s.from = undefined;
      if (s.to && !fits(s, s.to, true)) s.to = undefined;
      return 'next';
    },
  },
  {
    id: 'day',
    when: (s) => !s.pinned,
    run: async (w, s) => {
      const d = await w.ask({ text: head(s, t('search-ask-day')), rows: grid(dayButtons(s.days), 2) });
      if (d.kind !== 'btn') {
        if (d.kind === 'back') s.route = undefined;
        return nav(d) ?? 'back';
      }
      s.day = s.days[Number(d.data.slice(1))]!.day;
      return 'next';
    },
  },
  {
    id: 'results',
    when: (s) => !s.pinned,
    run: async (w, s): Promise<Outcome> => {
      s.mode = undefined;
      s.trip = undefined;
      const route = s.route!;
      const day = s.day!;
      const q = { directionId: route.directionId, fromSide: route.fromSide, day, excludeDriverId: s.userId };
      const found = await w.ext(() => openTrips(q));
      const later = found.length ? null : await w.ext(() => nextDayWithTrips(q));
      const shown = found.slice(0, 8);
      const cards = shown.length <= 4 ? shown.map((x) => tripCard(x)).join('\n\n') : shown.map((x) => `• ${esc(tripButton(x, false))} · ${t('trip-seats-free', { n: x.seatsFree })}`).join('\n');
      const text = shown.length
        ? `${head(s, t('search-day-trips', { n: found.length }))}\n\n${cards}\n\n${t('search-pick')}`
        : `${head(s, t('search-day-empty'))}${later ? `\n\n${t('search-next-day', { day: dayLabel(s, later.day), n: later.count })}` : ''}\n\n${t('search-none')}`;

      const i = s.days.findIndex((x) => x.day === day);
      const prev = s.days[i - 1];
      const next = s.days[i + 1];
      const rows: Opt[][] = [
        ...shown.map((x) => [{ text: `${tripButton(x, false)} · ${t('trip-seats-free', { n: x.seatsFree })}`, data: `t${x.id}` }]),
        ...(later ? [[{ text: t('btn-show-day', { day: dayLabel(s, later.day) }), data: `g${later.day}` }]] : []),
        [prev && { text: `◀ ${prev.label}`, data: `g${prev.day}` }, next && { text: `${next.label} ▶`, data: `g${next.day}` }].filter((x): x is Opt => !!x),
        [{ text: t('btn-leave-request'), data: 'req', style: shown.length ? undefined : 'primary' }],
      ];
      const a = await w.ask({ text, rows });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data.startsWith('g')) {
        s.day = a.data.slice(1);
        return { goto: 'results' };
      }
      if (a.data === 'req') {
        s.mode = 'request';
        return 'next';
      }
      const trip = shown.find((x) => x.id === Number(a.data.slice(1)));
      if (!trip) return { goto: 'results' };
      useTrip(s, trip);
      return 'next';
    },
  },
  {
    id: 'reqTime',
    when: (s) => s.mode === 'request',
    run: async (w, s) => {
      const p = await w.ask({
        text: head(s, t('search-ask-time')),
        rows: column([
          { text: t('time-btn-morning'), data: 'morning' },
          { text: t('time-btn-day'), data: 'day' },
          { text: t('time-btn-evening'), data: 'evening' },
          { text: t('time-btn-exact'), data: 'exact' },
        ]),
      });
      if (p.kind !== 'btn') return nav(p) ?? 'back';
      const kind = p.data as TimeKind;
      let exact: number | null = null;
      if (kind === 'exact') {
        const x = await w.ask({
          text: head(s, t('search-ask-exact-time')),
          acceptText: true,
          hint: t('hint-time'),
          validate: (v) => (parseTime(v) === null ? t('hint-time') : null),
        });
        if (x.kind !== 'text') return x.kind === 'home' ? 'home' : { goto: 'reqTime' };
        exact = parseTime(x.text);
      }
      if (await w.ext(() => windowExpired(s.day!, kind, exact))) {
        await w.say(t('search-time-passed'));
        return { goto: 'reqTime' };
      }
      s.timeKind = kind;
      s.exactMinutes = exact;
      return 'next';
    },
  },
  {
    // Водитель забирает из своих точек: точка и есть «откуда», адрес не нужен.
    id: 'point',
    when: (s) => s.mode === 'booking' && !!s.trip && s.trip.pickupMode !== 'door' && s.trip.pickupPoints.length > 0,
    run: async (w, s) => {
      const trip = s.trip!;
      const p = await w.ask({
        text: head(s, t('search-ask-point', { driver: esc(trip.driver.name) })),
        rows: column([
          ...trip.pickupPoints.map((name, i) => ({ text: name, data: `p${i}` })),
          ...(trip.pickupMode === 'mixed' ? [{ text: t('point-my-address'), data: 'addr' }] : []),
        ]),
      });
      if (p.kind !== 'btn') return nav(p) ?? 'back';
      if (p.data === 'addr') {
        s.pickupPoint = null;
        if (s.fromIsPoint) {
          s.from = undefined;
          s.fromIsPoint = false;
        }
        // Дальше по порядку: «откуда», затем «куда» — только если его ещё нет.
        return s.from ? 'next' : { goto: 'from' };
      }
      s.pickupPoint = trip.pickupPoints[Number(p.data.slice(1))]!;
      if (trip.pickupMode === 'points' || s.fromIsPoint || !s.from) {
        const city = s.localities.find((l) => l.kind === 'city' && l.directionId === trip.directionId && l.side === trip.fromSide);
        if (city) {
          s.from = addrOf(city, s.pickupPoint);
          s.fromIsPoint = true;
        }
      }
      return 'next';
    },
  },
  {
    id: 'from',
    when: (s) => !s.from,
    run: async (w, s) => {
      const res = await askPlace(w, s, 'from');
      if (res === 'back' || res === 'home') return res;
      s.from = res;
      s.fromIsPoint = false;
      return 'next';
    },
  },
  {
    id: 'to',
    when: (s) => !s.to,
    run: async (w, s) => {
      const res = await askPlace(w, s, 'to');
      if (res === 'back' || res === 'home') return res;
      s.to = res;
      return 'next';
    },
  },
  {
    id: 'card',
    run: async (w, s): Promise<Outcome> => {
      const booking = s.mode === 'booking';
      const btn = (text: string, data: string): Opt => ({ text: cut(text, 32), data });
      const rows: Opt[][] = [
        [{ text: t(booking ? 'btn-book' : 'btn-send-request'), data: 'ok', style: 'success' }],
        [btn(`💺 ${t('seats-count', { n: s.seats })}`, 'seats'), btn(`🧳 ${fieldValue.baggage(s)}`, 'baggage')],
        [btn(`👶 ${fieldValue.child(s)}`, 'child'), btn(`👤 ${fieldValue.who(s)}`, 'who')],
        [btn(`📍 ${t('label-from')}`, s.fromIsPoint ? 'point' : 'from'), btn(`🏁 ${t('label-to')}`, 'to')],
        [btn(`💬 ${t(s.comment ? 'btn-comment-edit' : 'btn-comment-add')}`, 'comment'), ...(booking ? [btn(t('btn-other-trip'), 'other')] : [])],
      ];
      // Фото машины из анкеты водителя: пассажир заранее видит, на чём поедет.
      if (booking && s.trip!.driver.photos.length) rows.splice(1, 0, [btn(t('btn-car-photos'), 'photos')]);
      const a = await w.ask({ text: cardText(s), rows });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'photos') {
        const d = s.trip!.driver;
        // Фото приходят отдельными сообщениями, а карточка встаёт под ними — бронировать можно сразу.
        await w.photos(d.photos, `${d.name} · ${d.car}, ${d.carYear}, ${d.carColor.toLowerCase()}`);
        return { goto: 'card' };
      }
      if (a.data === 'other') {
        s.pinned = false;
        s.day ??= dayKey(s.trip!.departsAt);
        return { goto: 'results' };
      }
      if (a.data !== 'ok') return { goto: a.data, returnTo: 'card' };

      const base = {
        passenger: { name: s.passenger.name, phone: s.passenger.phone, type: s.passenger.type },
        from: s.from!,
        to: s.to!,
        seats: s.seats,
        childSeat: s.childSeat,
        baggage: s.baggage,
        baggageNote: s.baggageNote,
        comment: s.comment,
      };
      if (!booking) {
        const request = await w.ext(() =>
          submitRequest({
            ...base,
            userId: s.userId,
            directionId: s.route!.directionId,
            fromSide: s.route!.fromSide,
            day: s.day!,
            timeKind: s.timeKind!,
            exactMinutes: s.exactMinutes,
          }),
        );
        s.outcome = { request };
        return 'next';
      }
      const trip = s.trip!;
      const res = await w.ext(() => submitBooking({ ...base, tripId: trip.id, bookedBy: s.userId, pickupPoint: s.pickupPoint }));
      if (!res.ok) {
        // Места заняли, пока человек отвечал, или рейс ушёл — показываем другие рейсы на этот день.
        const now = await w.ext(() => getTrip(trip.id));
        const gone = res.reason === 'no_seats' && !(await w.ext(async () => !!now && bookable(now)));
        await w.say(t(gone ? 'search-trip-gone' : `bk-fail-${res.reason}`));
        s.pinned = false;
        s.day = dayKey(trip.departsAt);
        return { goto: 'results' };
      }
      s.outcome = { booking: res.booking, trip, needsAdmin: res.needsAdmin };
      return 'next';
    },
  },

  // ——— Правка из карточки. В обычном порядке эти шаги не встречаются, на них попадают только кнопкой. ———
  {
    id: 'seats',
    when: () => false,
    run: async (w, s) => {
      const max = s.mode === 'booking' && s.trip ? Math.max(1, Math.min(6, s.trip.seatsFree)) : 6;
      const a = await w.ask({
        text: head(s, t('search-ask-seats')),
        rows: grid(Array.from({ length: max }, (_, i) => ({ text: String(i + 1), data: String(i + 1) })), 3),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.seats = Number(a.data);
      return 'next';
    },
  },
  {
    id: 'child',
    when: () => false,
    run: async (w, s) => {
      // Кресло водителя можно попросить, только если оно у него есть.
      const driverHas = s.mode !== 'booking' || !!s.trip?.driver.childSeat;
      const c = await w.ask({
        text: head(s, t('search-ask-child'), driverHas ? '' : t('search-no-driver-child-seat')),
        rows: column([
          { text: t('btn-no'), data: 'none' },
          { text: t('child-own'), data: 'own' },
          ...(driverHas ? [{ text: t('child-driver'), data: 'driver' }] : []),
        ]),
      });
      if (c.kind !== 'btn') return nav(c) ?? 'back';
      s.childSeat = c.data as ChildSeat;
      return 'next';
    },
  },
  {
    id: 'baggage',
    when: () => false,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('search-ask-baggage')),
        rows: column([
          { text: t('baggage-btn-bag'), data: 'bag' },
          { text: t('baggage-btn-suitcase'), data: 'suitcase' },
          { text: t('baggage-btn-many'), data: 'many' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data !== 'many') {
        s.baggage = a.data as Baggage;
        s.baggageNote = null;
        return 'next';
      }
      const note = await w.ask({
        text: head(s, t('search-ask-baggage-note', { amount: money(s.prepay) })),
        acceptText: true,
        validate: (v) => (v.length >= 2 && v.length <= 200 ? null : t('hint-text-length', { min: 2, max: 200 })),
      });
      if (note.kind !== 'text') return note.kind === 'home' ? 'home' : { goto: 'baggage', returnTo: 'card' };
      s.baggage = 'many';
      s.baggageNote = note.text;
      return 'next';
    },
  },
  {
    id: 'comment',
    when: () => false,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('search-ask-comment'), t('search-comment-note')),
        rows: [[{ text: t(s.comment ? 'btn-comment-remove' : 'btn-skip'), data: 'skip' }]],
        acceptText: true,
        validate: (v) => (v.length <= 300 ? null : t('hint-text-length', { min: 1, max: 300 })),
      });
      if (a.kind === 'text') s.comment = a.text;
      else if (a.kind === 'btn') s.comment = null;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'who',
    when: () => false,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('search-ask-who')),
        rows: column([
          { text: t('who-self'), data: 'self' },
          ...s.savedPassengers.map((p) => ({ text: p.name, data: `p${p.id}` })),
          { text: t('who-other'), data: 'other' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'self') {
        s.passenger = { ...s.self, type: 'adult', self: true };
        return 'next';
      }
      if (a.data.startsWith('p')) {
        const p = s.savedPassengers.find((x) => x.id === Number(a.data.slice(1)))!;
        s.passenger = { name: p.name, phone: p.phone, type: p.type, self: false };
        return 'next';
      }
      // Другой человек: имя, телефон, взрослый / подросток / ребёнок.
      const again: Outcome = { goto: 'who', returnTo: 'card' };
      const n = await w.ask({
        text: head(s, t('who-ask-name')),
        acceptText: true,
        validate: (v) => (cleanName(v) ? null : t('reg-name-hint')),
      });
      if (n.kind !== 'text') return n.kind === 'home' ? 'home' : again;
      const ph = await w.ask({
        text: head(s, t('who-ask-phone', { name: esc(cleanName(n.text)!) })),
        acceptText: true,
        acceptContact: true,
        hint: t('who-phone-hint'),
        validate: (v) => (normalizePhone(v) ? null : t('who-phone-hint')),
      });
      const phone = ph.kind === 'text' ? normalizePhone(ph.text) : ph.kind === 'contact' ? ph.phone : null;
      if (!phone) return ph.kind === 'home' ? 'home' : again;
      const ty = await w.ask({
        text: head(s, t('who-ask-type')),
        rows: column([
          { text: t('who-type-adult'), data: 'adult' },
          { text: t('who-type-teen'), data: 'teen' },
          { text: t('who-type-child'), data: 'child' },
        ]),
      });
      if (ty.kind !== 'btn') return ty.kind === 'home' ? 'home' : again;
      s.passenger = { name: cleanName(n.text)!, phone, type: ty.data as PassengerType, self: false };
      return 'next';
    },
  },
];

/** Подстановка из прошлой брони. reverse — «Обратно»: адреса меняются местами. */
function prefillFrom(b: BookingView, reverse: boolean, localities: LocalityView[], routes: BoardRoute[], self: { name: string; phone: string }): Prefill | null {
  if (!b.from || !b.to) return null;
  const place = (p: NonNullable<BookingView['from']>): Addr | undefined => {
    const l = localities.find((x) => x.id === p.localityId);
    return l ? addrOf(l, p.address, p.lat, p.lon) : undefined;
  };
  const [from, to] = reverse ? [place(b.to), place(b.from)] : [place(b.from), place(b.to)];
  const route = from && routes.find((r) => r.directionId === from.directionId && r.fromSide === from.side);
  if (!from || !to || !route) return null;
  return {
    route,
    from,
    to,
    passenger: { name: b.passengerName ?? self.name, phone: b.passengerPhone ?? self.phone, type: b.passengerType, self: b.isSelf },
    seats: b.seats,
    childSeat: b.childSeat,
    baggage: b.baggage,
    baggageNote: b.baggageNote,
    comment: b.comment,
  };
}

/**
 * «Найти поездку»: куда → когда → рейсы этого дня. Выбрал рейс — откуда и куда забрать, и карточка,
 * где всё остальное уже заполнено самым частым ответом. Рейса нет — та же карточка уходит заявкой.
 */
export async function search(conv: MyConversation, ctx: Context, prefill?: SearchPrefill): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId, ctx.callbackQuery?.message?.message_id);

  const init = await w.ext(async () => {
    const user = await getUserByTg(telegramId);
    if (!user) return null;
    const set = await loadSettings();
    const localities = await listLocalities();
    const routes = await listRoutes();
    const self = { name: user.name, phone: user.phone };
    const state: SearchState = {
      userId: user.id,
      self,
      savedPassengers: await listPassengers(user.id),
      savedAddresses: await listAddresses(user.id),
      localities,
      routes,
      days: dayOptions(set.trip_horizon_days),
      prepay: set.big_baggage_prepay,
      escalateMinutes: set.request_escalate_minutes,
      last: null,
      pinned: false,
      pickupPoint: null,
      fromIsPoint: false,
      exactMinutes: null,
      passenger: { ...self, type: 'adult', self: true },
      seats: 1,
      childSeat: 'none',
      baggage: 'bag',
      baggageNote: null,
      comment: null,
    };
    if (prefill && 'tripId' in prefill) {
      // Свой рейс по своей же ссылке не бронируют; ушедший рейс — обычный поиск на тот же маршрут.
      const trip = await getTrip(prefill.tripId);
      if (trip && trip.driverId !== user.id) {
        state.route = routes.find((r) => r.directionId === trip.directionId && r.fromSide === trip.fromSide);
        state.day = dayKey(trip.departsAt);
        if (bookable(trip)) {
          state.pinned = true;
          useTrip(state, trip);
        }
      }
      return { state, tripGone: !state.pinned };
    }
    if (prefill && 'directionId' in prefill) {
      state.route = routes.find((r) => r.directionId === prefill.directionId && r.fromSide === prefill.fromSide);
      if (state.route && state.days.some((d) => d.day === prefill.day)) {
        state.day = prefill.day;
        if (prefill.request) state.mode = 'request';
      }
      return { state, tripGone: false };
    }
    if (prefill) {
      const b = await getBooking(prefill.bookingId);
      const p = b && b.booker?.id === user.id ? prefillFrom(b, prefill.reverse, localities, routes, self) : null;
      if (p) Object.assign(state, p);
      return { state, tripGone: false };
    }
    // «Как в прошлый раз» — последняя поездка с адресами.
    const mine = await listUserBookings(user.id);
    const lastBooking = [...mine.upcoming, ...mine.past].map((x) => x.booking).find((b) => b.from && b.to);
    const last = lastBooking && prefillFrom(lastBooking, false, localities, routes, self);
    if (last) state.last = { ...last, label: `${last.from.city} → ${last.to.city}` };
    return { state, tripGone: false };
  });
  if (!init) return;
  const s = init.state;
  if (init.tripGone) await w.say(t('search-trip-gone'));

  // С доски: сразу к рейсам дня или к заявке. «Назад» с первого шага закрывает поиск.
  const start = s.route && s.day && !s.pinned && !s.from ? (s.mode === 'request' ? 'reqTime' : 'results') : undefined;
  const res = await runSteps(w, steps, s, start);
  if (res === 'home' || !s.outcome) {
    await w.say(t('search-cancelled'));
    return;
  }

  const outcome = s.outcome;
  const result = await w.ext(async () => {
    if (!s.passenger.self) await savePassenger(s.userId, s.passenger);
    if ('request' in outcome) {
      const r = outcome.request;
      return {
        text: `${t('req-sent', { minutes: s.escalateMinutes })}\n\n${timeLabel(r.day, r.timeKind, r.exactMinutes)}, ${esc(r.route)}`,
        rows: [[{ text: t('btn-cancel-request'), data: `p:rqx:${r.id}`, style: 'danger' }], [{ text: t('menu-board'), data: 'b:home' }, { text: t('menu-my-trips'), data: 'p:trips' }]] as Btn[][],
      };
    }
    const b = (await getBooking(outcome.booking.id)) ?? outcome.booking;
    const trip = (await getTrip(outcome.trip.id)) ?? outcome.trip;
    // Предлагаем запомнить новые адреса — в следующий раз они будут первой кнопкой.
    const fresh: Btn[][] = [];
    for (const [key, a] of [['f', s.from!], ['t', s.to!]] as const) {
      if (a.lat === null && !(key === 'f' && s.fromIsPoint) && !(await hasAddress(s.userId, a.localityId, a.address))) {
        fresh.push([{ text: `💾 ${cut(`${a.city}, ${a.address}`, 40)}`, data: `p:sa:${b.id}:${key}` }]);
      }
    }
    return {
      text: `${t(outcome.needsAdmin ? 'bk-sent-needs-admin' : 'bk-sent')}\n\n${bookingForPassenger(b, trip, s.prepay)}${fresh.length ? `\n\n${t('save-address-offer')}` : ''}`,
      rows: [...fresh, [{ text: t('btn-need-return'), data: `p:rev:${b.id}` }], [{ text: t('menu-my-trips'), data: 'p:trips' }]] as Btn[][],
    };
  });
  await w.finish(result.text, kb(result.rows));
}
