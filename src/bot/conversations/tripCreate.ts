import type { Context } from 'grammy';
import type { PickupMode, Side, Trunk } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc, money, splitList } from '../../lib/format.js';
import { fmtDayKey, fmtMinutes, fromDayMinutes, minutesOfDay, parseTime } from '../../lib/time.js';
import { listDirections, routeLabel } from '../../services/directions.js';
import { driverDirectionIds, getDriver } from '../../services/drivers.js';
import { loadSettings } from '../../services/settings.js';
import { lastTrip, validateTrip, type TripInput, type TripView } from '../../services/trips.js';
import { getUserByTg } from '../../services/users.js';
import { publishTrip } from '../actions.js';
import type { MyConversation } from '../context.js';
import { kb, send } from '../tg.js';
import { pickupLine, tripCard } from '../ui/cards.js';
import { shareRows } from '../ui/share.js';
import { column, grid, runSteps, Wizard, type Step } from '../wizard.js';
import { dayButtons, dayOptions, nav, type DayOption } from './common.js';

interface TripState {
  userId: number;
  maxSeats: number;
  priceMin: number;
  priceMax: number;
  routes: { directionId: number; fromSide: Side; label: string }[];
  days: DayOption[];
  last: TripView | null;
  repeat: boolean;
  reviewed: boolean;
  directionId?: number;
  fromSide?: Side;
  route?: string;
  day?: string;
  minutes?: number;
  pickupMode?: PickupMode;
  pickupPoints: string[];
  villages?: boolean;
  villagesNote: string | null;
  seats?: number;
  trunk?: Trunk;
  price?: number;
  published?: { trip: TripView; waitingRequests: number };
}

const QUICK_TIMES = [6, 7, 8, 12, 15, 17, 18, 19].map((h) => h * 60);
const MAX_POINTS = 5;

function toInput(s: TripState): TripInput {
  return {
    driverId: s.userId,
    directionId: s.directionId!,
    fromSide: s.fromSide!,
    departsAt: fromDayMinutes(s.day!, s.minutes!),
    pickupMode: s.pickupMode!,
    pickupPoints: s.pickupMode === 'door' ? [] : s.pickupPoints,
    villages: s.villages!,
    villagesNote: s.villages ? s.villagesNote : null,
    seats: s.seats!,
    trunk: s.trunk!,
    price: s.price!,
  };
}

const steps: Step<TripState>[] = [
  {
    id: 'route',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const a = await w.ask({
        text: t('trip-ask-route'),
        rows: column(s.routes.map((r, i) => ({ text: r.label, data: `r${i}` }))),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      const r = s.routes[Number(a.data.slice(1))]!;
      s.directionId = r.directionId;
      s.fromSide = r.fromSide;
      s.route = r.label;
      return 'next';
    },
  },
  {
    id: 'day',
    run: async (w, s) => {
      const a = await w.ask({ text: t('trip-ask-day'), rows: grid(dayButtons(s.days), 2) });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.day = s.days[Number(a.data.slice(1))]!.day;
      return 'next';
    },
  },
  {
    id: 'time',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const a = await w.ask({
        text: t('trip-ask-time'),
        rows: [
          ...(s.minutes !== undefined ? [[{ text: t('btn-same-as-last', { value: fmtMinutes(s.minutes) }), data: `m${s.minutes}` }]] : []),
          ...grid(QUICK_TIMES.map((m) => ({ text: fmtMinutes(m), data: `m${m}` })), 4),
        ],
        acceptText: true,
        hint: t('hint-time'),
        validate: (v) => (parseTime(v) === null ? t('hint-time') : null),
      });
      if (a.kind === 'btn') s.minutes = Number(a.data.slice(1));
      else if (a.kind === 'text') s.minutes = parseTime(a.text)!;
      else return nav(a) ?? 'back';

      // Сразу проверяем день и время: лимиты, пересечения, дубли — чтобы не заполнять анкету зря.
      const problem = await w.ext(() =>
        validateTrip({ ...toInput({ ...s, pickupMode: 'door', villages: false, trunk: 'free' }), seats: 1, price: s.priceMin }),
      );
      if (problem) {
        await w.say(t(`trip-problem-${problem}`));
        return problem === 'past' ? { goto: 'time' } : { goto: 'day', returnTo: 'time' };
      }
      return s.reviewed ? { goto: 'summary' } : 'next';
    },
  },
  {
    id: 'pickup',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const a = await w.ask({
        text: t('trip-ask-pickup'),
        rows: column([
          { text: t('pickup-door'), data: 'door' },
          { text: t('pickup-points'), data: 'points' },
          { text: t('pickup-mixed'), data: 'mixed' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.pickupMode = a.data as PickupMode;
      if (s.pickupMode === 'door') return 'next';

      const prev = s.pickupPoints.length ? s.pickupPoints : (s.last?.pickupPoints ?? []);
      const p = await w.ask({
        text: t('trip-ask-points'),
        rows: prev.length ? [[{ text: t('btn-same-as-last', { value: prev.join(', ').slice(0, 40) }), data: 'same' }]] : [],
        acceptText: true,
        validate: (v) => (splitList(v, MAX_POINTS).length ? null : t('trip-points-hint')),
      });
      if (p.kind === 'btn') s.pickupPoints = prev;
      else if (p.kind === 'text') s.pickupPoints = splitList(p.text, MAX_POINTS);
      else return p.kind === 'home' ? 'home' : { goto: 'pickup' };
      return 'next';
    },
  },
  {
    id: 'villages',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const a = await w.ask({
        text: t('trip-ask-villages'),
        rows: column([
          { text: t('villages-yes'), data: 'y' },
          { text: t('btn-no'), data: 'n' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.villages = a.data === 'y';
      s.villagesNote = null;
      if (!s.villages) return 'next';
      const v = await w.ask({
        text: t('trip-ask-villages-which'),
        rows: [[{ text: t('villages-all'), data: 'all' }]],
        acceptText: true,
        validate: (x) => (x.length <= 120 ? null : t('hint-text-length', { min: 1, max: 120 })),
      });
      if (v.kind === 'text') s.villagesNote = v.text;
      else if (v.kind !== 'btn') return v.kind === 'home' ? 'home' : { goto: 'villages' };
      return 'next';
    },
  },
  {
    id: 'seats',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const nums = Array.from({ length: s.maxSeats }, (_, i) => i + 1);
      const a = await w.ask({ text: t('trip-ask-seats'), rows: grid(nums.map((n) => ({ text: String(n), data: String(n) })), 3) });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.seats = Number(a.data);
      return 'next';
    },
  },
  {
    id: 'trunk',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const a = await w.ask({
        text: t('trip-ask-trunk'),
        rows: column([
          { text: t('trunk-btn-free'), data: 'free' },
          { text: t('trunk-btn-half'), data: 'half' },
          { text: t('trunk-btn-full'), data: 'full' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.trunk = a.data as Trunk;
      return 'next';
    },
  },
  {
    id: 'price',
    when: (s) => !s.repeat,
    run: async (w, s) => {
      const hint = t('trip-price-hint', { min: money(s.priceMin), max: money(s.priceMax) });
      const parse = (v: string) => {
        const n = Number(v.replace(/[^\d]/g, ''));
        return /\d/.test(v) && n >= s.priceMin && n <= s.priceMax ? n : null;
      };
      const prev = s.price ?? s.last?.price;
      const a = await w.ask({
        text: t('trip-ask-price'),
        rows: prev ? [[{ text: t('btn-same-as-last', { value: money(prev) }), data: 'same' }]] : [],
        acceptText: true,
        hint,
        validate: (v) => (parse(v) === null ? hint : null),
      });
      if (a.kind === 'btn') s.price = prev!;
      else if (a.kind === 'text') s.price = parse(a.text)!;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'summary',
    run: async (w, s) => {
      s.reviewed = true;
      const a = await w.ask({
        text: t('trip-summary', {
          route: esc(s.route),
          when: `${fmtDayKey(s.day!)} в ${fmtMinutes(s.minutes!)}`,
          pickup: pickupLine({ pickupMode: s.pickupMode!, pickupPoints: s.pickupPoints }),
          villages: s.villages ? t('trip-villages-yes') + (s.villagesNote ? `: ${esc(s.villagesNote)}` : '') : t('trip-villages-no'),
          seats: s.seats,
          trunk: t(`trunk-${s.trunk}`),
          price: money(s.price!),
        }),
        rows: column([
          { text: t('btn-publish'), data: 'ok' },
          { text: t('btn-fix'), data: 'fix' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'fix') {
        const fields = ['route', 'day', 'time', 'pickup', 'villages', 'seats', 'trunk', 'price'];
        const fix = await w.ask({
          text: t('ask-what-to-fix'),
          rows: grid(fields.map((f) => ({ text: t(`trip-field-${f}`), data: f })), 2),
          home: false,
        });
        if (fix.kind !== 'btn') return { goto: 'summary' };
        return { goto: fix.data, returnTo: 'summary' };
      }
      const res = await w.ext(() => publishTrip(toInput(s)));
      if ('problem' in res) {
        await w.say(t(`trip-problem-${res.problem}`));
        return { goto: 'day', returnTo: 'time' };
      }
      s.published = res;
      return 'next';
    },
  },
];

/** «Выложить рейс»: новый — по шагам, «Повторить прошлый» — только день и подтверждение. */
export async function tripCreate(conv: MyConversation, ctx: Context, mode: 'new' | 'repeat' = 'new'): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId);

  const init = await w.ext(async () => {
    const user = await getUserByTg(telegramId);
    const driver = user && (await getDriver(user.id));
    if (!user || !driver) return { error: t('only-drivers') };
    if (driver.status !== 'approved') return { error: t(`drv-cannot-post-${driver.status}`) };
    const set = await loadSettings();
    const dirIds = await driverDirectionIds(user.id);
    const dirs = (await listDirections()).filter((d) => dirIds.includes(d.id));
    return {
      userId: user.id,
      maxSeats: driver.seats,
      priceMin: set.price_min,
      priceMax: set.price_max,
      routes: dirs.flatMap((d) =>
        (['a', 'b'] as const).map((side) => ({ directionId: d.id, fromSide: side, label: routeLabel(d, side) })),
      ),
      days: dayOptions(set.trip_horizon_days),
      last: (await lastTrip(user.id)) ?? null,
    };
  });
  if ('error' in init) {
    await w.say(init.error ?? '');
    return;
  }

  const last = init.last;
  const repeat = mode === 'repeat' && last !== null;
  const s: TripState = { ...init, repeat, reviewed: false, pickupPoints: [], villagesNote: null };
  if (repeat && last) {
    Object.assign(s, {
      directionId: last.directionId,
      fromSide: last.fromSide,
      route: last.route,
      minutes: minutesOfDay(last.departsAt),
      pickupMode: last.pickupMode,
      pickupPoints: last.pickupPoints,
      villages: last.villages,
      villagesNote: last.villagesNote,
      seats: Math.min(last.seatsTotal, init.maxSeats),
      trunk: last.trunk,
      price: last.price,
    } satisfies Partial<TripState>);
  }

  const res = await runSteps(w, steps, s);
  if (res === 'home' || !s.published) {
    await w.say(t('trip-not-published'));
    return;
  }
  const { trip, waitingRequests } = s.published;
  await w.ext(() =>
    send(
      chatId,
      [
        t('trip-published'),
        tripCard(trip, { own: true }),
        waitingRequests > 0 ? t('trip-published-requests', { n: waitingRequests }) : '',
        shareRows(trip).length ? t('share-hint') : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      kb([
        ...shareRows(trip),
        [{ text: t('btn-open-trip'), data: `d:t:${trip.id}` }],
        waitingRequests > 0 ? [{ text: t('menu-requests'), data: 'r:list' }] : [],
      ]),
    ),
  );
}
