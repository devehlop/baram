import type { Context } from 'grammy';
import type { Baggage, ChildSeat, PassengerType, Side, TimeKind } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { cut, esc, fmtPhone, money, normalizePhone } from '../../lib/format.js';
import { dayKey, fmtDateTime, minutesOfDay, now, parseTime } from '../../lib/time.js';
import { getBooking, type BookingView } from '../../services/bookings.js';
import { listLocalities, type LocalityView } from '../../services/directions.js';
import type { RequestView } from '../../services/requests.js';
import { hasAddress, listAddresses, listPassengers, savePassenger, type SavedAddressView, type SavedPassengerView } from '../../services/saved.js';
import { searchTrips, windowExpired } from '../../services/search.js';
import { loadSettings } from '../../services/settings.js';
import { getTrip, type TripView } from '../../services/trips.js';
import { getUserByTg } from '../../services/users.js';
import { submitBooking, submitRequest } from '../actions.js';
import type { MyConversation } from '../context.js';
import { kb, send } from '../tg.js';
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

interface SearchState {
  userId: number;
  self: { name: string; phone: string };
  savedPassengers: SavedPassengerView[];
  savedAddresses: SavedAddressView[];
  localities: LocalityView[];
  days: DayOption[];
  prepay: number;
  escalateMinutes: number;
  reviewed: boolean;
  /** Повтор прошлой поездки: спрашиваем только день и время. */
  prefilled: boolean;
  passenger?: { name: string; phone: string; type: PassengerType; self: boolean };
  from?: Addr;
  to?: Addr;
  day?: string;
  timeKind?: TimeKind;
  exactMinutes?: number | null;
  seats?: number;
  childSeat?: ChildSeat;
  baggage?: Baggage;
  baggageNote?: string | null;
  comment?: string | null;
  trip?: TripView;
  /** Рейс из ссылки в чате: день, время и направление уже известны, спрашиваем только про пассажира. */
  pinned?: TripView;
  pickupPoint?: string | null;
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
      /** Забронировать конкретный рейс — по ссылке из чата. */
      tripId: number;
    };

const TOTAL = 7;
const head = (n: number, question: string, note = '') =>
  `<i>${t('step-of', { n, total: TOTAL })}</i>\n<b>${question}</b>${note ? `\n${note}` : ''}`;

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

/** Куда можно поехать из выбранного «откуда»: противоположный конец того же направления. */
function reachable(s: SearchState, l: { directionId: number; side: Side }): boolean {
  if (!s.from) return true;
  const starts = s.from.village
    ? [s.from]
    : s.localities.filter((x) => x.kind === 'city' && x.name === s.from!.city);
  return starts.some((f) => f.directionId === l.directionId && f.side !== l.side);
}

/** Вопрос про адрес: сохранённые адреса, города, деревни; затем улица и дом текстом или геопозицией. */
async function askPlace(w: Wizard, s: SearchState, which: 'from' | 'to'): Promise<Addr | 'back' | 'home'> {
  const isTo = which === 'to';
  const pin = s.pinned;
  const fits = (l: { directionId: number; side: Side }) =>
    (!pin || (l.directionId === pin.directionId && (isTo ? l.side !== pin.fromSide : l.side === pin.fromSide))) &&
    (!isTo || reachable(s, l));
  for (;;) {
    const saved = s.savedAddresses.filter(fits);
    const cityNames = [...new Set(s.localities.filter((l) => l.kind === 'city' && fits(l)).map((l) => l.name))];
    const villages = s.localities.filter((l) => l.kind === 'village' && fits(l));
    const rows: Opt[][] = [
      ...saved.map((a) => [{ text: cut(`${a.label} · ${a.city}, ${a.address}`, 48), data: `s${a.id}` }]),
      ...cityNames.map((name, i) => [{ text: name, data: `c${i}` }]),
      ...(villages.length ? [[{ text: t('btn-village'), data: 'v' }]] : []),
    ];
    const a = await w.ask({
      text: head(isTo ? 3 : 2, t(isTo ? 'search-ask-to' : 'search-ask-from'), t('search-place-note')),
      rows,
    });
    if (a.kind !== 'btn') return a.kind === 'home' ? 'home' : 'back';

    if (a.data.startsWith('s')) {
      const x = saved.find((v) => v.id === Number(a.data.slice(1)))!;
      return { localityId: x.localityId, directionId: x.directionId, side: x.side, city: x.city, village: x.village, address: x.address, lat: x.lat, lon: x.lon };
    }

    let locality: LocalityView | undefined;
    if (a.data === 'v') {
      const v = await w.ask({
        text: t('search-ask-village'),
        rows: grid(villages.map((l) => ({ text: l.name, data: String(l.id) })), 2),
      });
      if (v.kind === 'home') return 'home';
      if (v.kind !== 'btn') continue;
      locality = villages.find((l) => l.id === Number(v.data));
      await w.say(t('search-village-warning'));
    } else {
      const name = cityNames[Number(a.data.slice(1))];
      locality = s.localities.find((l) => l.kind === 'city' && l.name === name && fits(l));
    }
    if (!locality) continue;

    const ad = await w.ask({
      text: t('search-ask-address', { city: esc(locality.name) }),
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

/** Когда «откуда» и «куда» — один город в разных направлениях, уточняем строку «откуда» по выбранному «куда». */
function alignFrom(s: SearchState): void {
  if (!s.from || !s.to || s.from.village || s.from.directionId === s.to.directionId) return;
  const twin = s.localities.find((l) => l.kind === 'city' && l.name === s.from!.city && l.directionId === s.to!.directionId);
  if (twin) s.from = { ...s.from, localityId: twin.id, directionId: twin.directionId, side: twin.side };
}

const steps: Step<SearchState>[] = [
  {
    id: 'who',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(1, t('search-ask-who')),
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
      const n = await w.ask({
        text: t('who-ask-name'),
        acceptText: true,
        validate: (v) => (cleanName(v) ? null : t('reg-name-hint')),
      });
      if (n.kind !== 'text') return n.kind === 'home' ? 'home' : { goto: 'who' };
      const ph = await w.ask({
        text: t('who-ask-phone', { name: esc(cleanName(n.text)!) }),
        acceptText: true,
        acceptContact: true,
        hint: t('who-phone-hint'),
        validate: (v) => (normalizePhone(v) ? null : t('who-phone-hint')),
      });
      const phone = ph.kind === 'text' ? normalizePhone(ph.text) : ph.kind === 'contact' ? ph.phone : null;
      if (!phone) return ph.kind === 'home' ? 'home' : { goto: 'who' };
      const ty = await w.ask({
        text: t('who-ask-type'),
        rows: column([
          { text: t('who-type-adult'), data: 'adult' },
          { text: t('who-type-teen'), data: 'teen' },
          { text: t('who-type-child'), data: 'child' },
        ]),
      });
      if (ty.kind !== 'btn') return ty.kind === 'home' ? 'home' : { goto: 'who' };
      s.passenger = { name: cleanName(n.text)!, phone, type: ty.data as PassengerType, self: false };
      return 'next';
    },
  },
  {
    id: 'from',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const prevTo = s.to;
      s.from = undefined;
      const res = await askPlace(w, s, 'from');
      if (res === 'back' || res === 'home') return res;
      s.from = res;
      // После исправления «откуда» старое «куда» могло перестать подходить.
      if (prevTo && !reachable(s, prevTo)) {
        s.to = undefined;
        return { goto: 'to', returnTo: s.reviewed ? 'results' : undefined };
      }
      alignFrom(s);
      return 'next';
    },
  },
  {
    id: 'to',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const res = await askPlace(w, s, 'to');
      if (res === 'back' || res === 'home') return res;
      s.to = res;
      alignFrom(s);
      return 'next';
    },
  },
  {
    id: 'when',
    when: (s) => !s.pinned,
    run: async (w, s) => {
      const d = await w.ask({ text: head(4, t('search-ask-day')), rows: grid(dayButtons(s.days), 2) });
      if (d.kind !== 'btn') return nav(d) ?? 'back';
      const day = s.days[Number(d.data.slice(1))]!.day;
      const p = await w.ask({
        text: t('search-ask-time'),
        rows: column([
          { text: t('time-btn-morning'), data: 'morning' },
          { text: t('time-btn-day'), data: 'day' },
          { text: t('time-btn-evening'), data: 'evening' },
          { text: t('time-btn-exact'), data: 'exact' },
        ]),
      });
      if (p.kind !== 'btn') return p.kind === 'home' ? 'home' : { goto: 'when' };
      const kind = p.data as TimeKind;
      let exact: number | null = null;
      if (kind === 'exact') {
        const x = await w.ask({
          text: t('search-ask-exact-time'),
          acceptText: true,
          hint: t('hint-time'),
          validate: (v) => (parseTime(v) === null ? t('hint-time') : null),
        });
        if (x.kind !== 'text') return x.kind === 'home' ? 'home' : { goto: 'when' };
        exact = parseTime(x.text);
      }
      if (await w.ext(() => windowExpired(day, kind, exact))) {
        await w.say(t('search-time-passed'));
        return { goto: 'when' };
      }
      s.day = day;
      s.timeKind = kind;
      s.exactMinutes = exact;
      return 'next';
    },
  },
  {
    id: 'seats',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(5, t('search-ask-seats')),
        rows: grid([1, 2, 3, 4, 5, 6].map((n) => ({ text: String(n), data: String(n) })), 3),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      const c = await w.ask({
        text: t('search-ask-child'),
        rows: column([
          { text: t('btn-no'), data: 'none' },
          { text: t('child-own'), data: 'own' },
          { text: t('child-driver'), data: 'driver' },
        ]),
      });
      if (c.kind !== 'btn') return c.kind === 'home' ? 'home' : { goto: 'seats' };
      s.seats = Number(a.data);
      s.childSeat = c.data as ChildSeat;
      return 'next';
    },
  },
  {
    id: 'baggage',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(6, t('search-ask-baggage')),
        rows: column([
          { text: t('baggage-btn-bag'), data: 'bag' },
          { text: t('baggage-btn-suitcase'), data: 'suitcase' },
          { text: t('baggage-btn-many'), data: 'many' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.baggage = a.data as Baggage;
      s.baggageNote = null;
      if (s.baggage !== 'many') return 'next';
      const note = await w.ask({
        text: t('search-ask-baggage-note', { amount: money(s.prepay) }),
        acceptText: true,
        validate: (v) => (v.length >= 2 && v.length <= 200 ? null : t('hint-text-length', { min: 2, max: 200 })),
      });
      if (note.kind !== 'text') return note.kind === 'home' ? 'home' : { goto: 'baggage' };
      s.baggageNote = note.text;
      return 'next';
    },
  },
  {
    id: 'comment',
    when: (s) => !s.prefilled,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(7, t('search-ask-comment'), t('search-comment-note')),
        rows: [[{ text: t('btn-skip'), data: 'skip' }]],
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
    id: 'results',
    run: async (w, s): Promise<Outcome> => {
      s.trip = undefined;
      s.pickupPoint = null;
      const query = {
        directionId: s.to!.directionId,
        fromSide: s.from!.side,
        day: s.day!,
        timeKind: s.timeKind!,
        exactMinutes: s.exactMinutes,
        seats: s.seats!,
        needChildSeat: s.childSeat === 'driver',
        excludeDriverId: s.userId,
      };
      const found = await w.ext(() => searchTrips(query));
      let exact = found.exact.slice(0, 5);
      let near = found.near.slice(0, exact.length ? 2 : 5);
      let pinnedGone = false;
      if (s.pinned) {
        // Рейс из ссылки: показываем только его. Пока человек отвечал, рейс могли отменить или занять места.
        const pinned = s.pinned;
        const fresh = await w.ext(async () => {
          const x = await getTrip(pinned.id);
          const ok = x && x.status === 'published' && new Date(x.departsAt) > now() && x.seatsFree >= s.seats! && x.driverId !== s.userId;
          return ok ? x : null;
        });
        if (fresh) {
          exact = [fresh];
          near = [];
        } else pinnedGone = true;
      }
      const shown = [...exact, ...near];
      const opts = { village: s.from!.village || s.to!.village, needChildSeat: s.childSeat === 'driver' };
      const cards = (list: TripView[]) => list.map((x) => tripCard(x, opts)).join('\n\n');
      const text = [
        pinnedGone ? t('search-pinned-gone') : '',
        exact.length ? `${t('search-found', { n: exact.length })}\n\n${cards(exact)}` : '',
        near.length ? `${t(exact.length ? 'search-also-near' : 'search-near')}\n\n${cards(near)}` : '',
        shown.length ? t('search-pick') : t('search-none'),
      ]
        .filter(Boolean)
        .join('\n\n');
      const a = await w.ask({
        text,
        rows: [
          ...shown.map((x) => [{ text: tripButton(x, dayKey(x.departsAt) !== s.day), data: `t${x.id}` }]),
          [{ text: t('btn-leave-request'), data: 'req' }],
        ],
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';

      const base = {
        passenger: { name: s.passenger!.name, phone: s.passenger!.phone, type: s.passenger!.type },
        from: s.from!,
        to: s.to!,
        seats: s.seats!,
        childSeat: s.childSeat!,
        baggage: s.baggage!,
        baggageNote: s.baggageNote,
        comment: s.comment,
      };
      if (a.data === 'req') {
        const request = await w.ext(() =>
          submitRequest({
            ...base,
            userId: s.userId,
            directionId: query.directionId,
            fromSide: query.fromSide,
            day: s.day!,
            timeKind: s.timeKind!,
            exactMinutes: s.exactMinutes,
          }),
        );
        s.outcome = { request };
        return 'next';
      }

      const trip = shown.find((x) => x.id === Number(a.data.slice(1)))!;
      if (trip.pickupMode !== 'door' && trip.pickupPoints.length) {
        const p = await w.ask({
          text: t('search-ask-point', { driver: esc(trip.driver.name) }),
          rows: column([
            ...trip.pickupPoints.map((name, i) => ({ text: name, data: `p${i}` })),
            ...(trip.pickupMode === 'mixed' ? [{ text: t('point-my-address'), data: 'addr' }] : []),
          ]),
        });
        if (p.kind !== 'btn') return p.kind === 'home' ? 'home' : { goto: 'results' };
        s.pickupPoint = p.data === 'addr' ? null : trip.pickupPoints[Number(p.data.slice(1))]!;
      }
      s.trip = trip;
      return 'next';
    },
  },
  {
    id: 'summary',
    when: (s) => !s.outcome,
    run: async (w, s) => {
      s.reviewed = true;
      const trip = s.trip!;
      const p = s.passenger!;
      const lines = [
        `<b>${t('summary-title')}</b>`,
        '',
        `${esc(trip.route)}, ${fmtDateTime(trip.departsAt)}`,
        `${t('label-driver')}: ${esc(trip.driver.name)}, ${carLine(trip.driver)}`,
        `${t('booking-rides')}: ${p.self ? t('who-self') : `${esc(p.name)}, ${fmtPhone(p.phone)}`}`,
        `${t('label-from')}: ${esc(s.from!.city)}, ${esc(s.from!.address)}`,
        `${t('label-to')}: ${esc(s.to!.city)}, ${esc(s.to!.address)}`,
        s.pickupPoint ? `${t('label-pickup-point')}: ${esc(s.pickupPoint)}` : '',
        `${t('seats-count', { n: s.seats! })} · ${baggageLine({ baggage: s.baggage!, baggageNote: s.baggageNote ?? null })}`,
        s.childSeat !== 'none' ? t(`child-seat-${s.childSeat}`) : '',
        s.comment ? `💬 ${esc(s.comment)}` : '',
        `💰 <b>${money(trip.price * s.seats!)}</b>${t('summary-pay-note')}`,
        s.baggage === 'many' ? `\n${t('summary-prepay-note', { amount: money(s.prepay) })}` : '',
        s.from!.village || s.to!.village ? `\n${t('search-village-warning')}` : '',
      ];
      const a = await w.ask({
        text: lines.filter((x) => x !== '').join('\n'),
        rows: column([
          { text: t('btn-all-correct'), data: 'ok' },
          { text: t('btn-fix'), data: 'fix' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'fix') {
        const fields = ['who', 'from', 'to', 'when', 'seats', 'baggage', 'comment'].filter((f) => !(s.pinned && f === 'when'));
        const fix = await w.ask({
          text: t('ask-what-to-fix'),
          rows: grid(fields.map((f) => ({ text: t(`search-field-${f}`), data: f })), 2),
          home: false,
        });
        if (fix.kind !== 'btn') return { goto: 'summary' };
        return { goto: fix.data, returnTo: 'results' };
      }
      const res = await w.ext(() =>
        submitBooking({
          tripId: trip.id,
          bookedBy: s.userId,
          passenger: { name: p.name, phone: p.phone, type: p.type },
          from: s.from!,
          to: s.to!,
          pickupPoint: s.pickupPoint,
          seats: s.seats!,
          childSeat: s.childSeat!,
          baggage: s.baggage!,
          baggageNote: s.baggageNote,
          comment: s.comment,
        }),
      );
      if (!res.ok) {
        await w.say(t(`bk-fail-${res.reason}`));
        return { goto: 'results' };
      }
      s.outcome = { booking: res.booking, trip, needsAdmin: res.needsAdmin };
      return 'next';
    },
  },
];

/** «Найти поездку»: 7 коротких вопросов → рейсы → итог → бронь. Нет рейса — та же анкета уходит заявкой. */
export async function search(conv: MyConversation, ctx: Context, prefill?: SearchPrefill): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId);

  const init = await w.ext(async () => {
    const user = await getUserByTg(telegramId);
    if (!user) return null;
    const set = await loadSettings();
    const localities = await listLocalities();
    const state: SearchState = {
      userId: user.id,
      self: { name: user.name, phone: user.phone },
      savedPassengers: await listPassengers(user.id),
      savedAddresses: await listAddresses(user.id),
      localities,
      days: dayOptions(set.trip_horizon_days),
      prepay: set.big_baggage_prepay,
      escalateMinutes: set.request_escalate_minutes,
      reviewed: false,
      prefilled: false,
    };
    if (prefill && 'tripId' in prefill) {
      const trip = await getTrip(prefill.tripId);
      if (trip && trip.status === 'published' && new Date(trip.departsAt) > now() && trip.driverId !== user.id) {
        Object.assign(state, {
          pinned: trip,
          day: dayKey(trip.departsAt),
          timeKind: 'exact',
          exactMinutes: minutesOfDay(trip.departsAt),
        } satisfies Partial<SearchState>);
      }
    }
    const b = prefill && 'bookingId' in prefill ? await getBooking(prefill.bookingId) : undefined;
    if (prefill && 'bookingId' in prefill && b && b.booker?.id === user.id && b.from && b.to) {
      const place = (p: NonNullable<BookingView['from']>): Addr | undefined => {
        const l = localities.find((x) => x.id === p.localityId);
        return l ? addrOf(l, p.address, p.lat, p.lon) : undefined;
      };
      const [from, to] = prefill.reverse ? [place(b.to), place(b.from)] : [place(b.from), place(b.to)];
      if (from && to) {
        Object.assign(state, {
          passenger: { name: b.passengerName ?? user.name, phone: b.passengerPhone ?? user.phone, type: b.passengerType, self: b.isSelf },
          from,
          to,
          seats: b.seats,
          childSeat: b.childSeat,
          baggage: b.baggage,
          baggageNote: b.baggageNote,
          comment: b.comment,
        } satisfies Partial<SearchState>);
      }
    }
    return state;
  });
  if (!init) return;
  const s = init;
  s.prefilled = s.from !== undefined && s.to !== undefined;
  if (s.prefilled) {
    await w.say(
      t('search-repeat-intro', {
        from: `${esc(s.from!.city)}, ${esc(s.from!.address)}`,
        to: `${esc(s.to!.city)}, ${esc(s.to!.address)}`,
      }),
    );
  }

  if (s.pinned) {
    await w.say(t('search-pinned-intro', { route: esc(s.pinned.route), when: fmtDateTime(s.pinned.departsAt) }));
  }

  const res = await runSteps(w, steps, s, s.prefilled ? 'when' : undefined);
  if (res === 'home' || !s.outcome) {
    await w.say(t('search-cancelled'));
    return;
  }

  const outcome = s.outcome;
  await w.ext(async () => {
    if (s.passenger && !s.passenger.self) await savePassenger(s.userId, s.passenger);
    if ('request' in outcome) {
      const r = outcome.request;
      await send(
        chatId,
        `${t('req-sent', { minutes: s.escalateMinutes })}\n\n${timeLabel(r.day, r.timeKind, r.exactMinutes)}, ${esc(r.route)}`,
        kb([[{ text: t('btn-cancel-request'), data: `p:rqx:${r.id}` }]]),
      );
      return;
    }
    const b = (await getBooking(outcome.booking.id)) ?? outcome.booking;
    const trip = (await getTrip(outcome.trip.id)) ?? outcome.trip;
    await send(
      chatId,
      `${t(outcome.needsAdmin ? 'bk-sent-needs-admin' : 'bk-sent')}\n\n${bookingForPassenger(b, trip, s.prepay)}`,
      kb([
        [{ text: t('btn-need-return'), data: `p:rev:${b.id}` }],
        [{ text: t('menu-my-trips'), data: 'p:trips' }],
      ]),
    );
    // Предлагаем запомнить новые адреса — в следующий раз они будут первой кнопкой.
    const fresh: { text: string; data: string }[] = [];
    for (const [key, a] of [['f', s.from!], ['t', s.to!]] as const) {
      if (a.lat === null && !(await hasAddress(s.userId, a.localityId, a.address))) {
        fresh.push({ text: cut(`${a.city}, ${a.address}`, 40), data: `p:sa:${b.id}:${key}` });
      }
    }
    if (fresh.length) await send(chatId, t('save-address-offer'), kb(fresh.map((x) => [x])));
  });
}
