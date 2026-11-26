import type { Context } from 'grammy';
import type { ParcelSize, ParcelTimeKind, Side } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { cut, esc, fmtPhone, money, normalizePhone } from '../../lib/format.js';
import { fmtDayKey, parseTime } from '../../lib/time.js';
import { listRoutes, type BoardRoute } from '../../services/board.js';
import { listLocalities, type LocalityView } from '../../services/directions.js';
import { parcelWindowExpired, type ParcelView } from '../../services/parcels.js';
import { listAddresses, listPassengers, type SavedAddressView, type SavedPassengerView } from '../../services/saved.js';
import { loadSettings } from '../../services/settings.js';
import { getUserByTg } from '../../services/users.js';
import { submitParcel } from '../actions.js';
import type { MyConversation } from '../context.js';
import { kb } from '../tg.js';
import { parcelCard, parcelPlaceLine, parcelPriceLine, timeLabel } from '../ui/cards.js';
import { column, grid, runSteps, Wizard, type Opt, type Outcome, type Step } from '../wizard.js';
import { dayButtons, dayOptions, lengthBetween, nav, type DayOption } from './common.js';
import { cleanName } from './registration.js';

interface Place {
  localityId: number;
  directionId: number;
  side: Side;
  city: string;
  village: boolean;
  /** null — из рук в руки у водителя: отправитель привезёт сам или получатель сам заберёт. */
  address: string | null;
  lat: number | null;
  lon: number | null;
}

interface Recipient {
  name: string;
  phone: string;
  self: boolean;
}

interface ParcelState {
  userId: number;
  self: { name: string; phone: string };
  routes: BoardRoute[];
  localities: LocalityView[];
  savedAddresses: SavedAddressView[];
  savedPassengers: SavedPassengerView[];
  days: DayOption[];
  priceFrom: number;
  priceTo: number;
  route?: BoardRoute;
  day?: string;
  timeKind?: ParcelTimeKind;
  exactMinutes: number | null;
  size?: ParcelSize;
  contents?: string;
  /** Деньги, карты, ключи, документы или лекарства: такую посылку берут только проверенные водители. */
  valuable?: boolean;
  from?: Place;
  to?: Place;
  recipient?: Recipient;
  /** Цена отправителя; null — «договоримся». priceAsked — на вопрос уже ответили. */
  price: number | null;
  priceAsked: boolean;
  result?: { parcel: ParcelView } | { problem: 'limit'; limit: number };
}

const SIZES: ParcelSize[] = ['small', 'medium', 'large', 'bulky'];
const PRICE_MIN = 50;
const PRICE_MAX = 30_000;

function crumbs(s: ParcelState): string {
  const parts: string[] = [];
  if (s.route) parts.push(`📦 ${esc(s.route.label)}`);
  if (s.day) parts.push((s.timeKind ? timeLabel(s.day, s.timeKind, s.exactMinutes) : (s.days.find((d) => d.day === s.day)?.label ?? fmtDayKey(s.day))).toLowerCase());
  return parts.join(' · ');
}

const head = (s: ParcelState, question: string, note = '') => {
  const c = crumbs(s);
  return `${c ? `<i>${c}</i>\n` : ''}<b>${question}</b>${note ? `\n${note}` : ''}`;
};

/** Место подходит маршруту: «откуда» — со стороны отправления, «куда» — с другой. */
function fits(s: ParcelState, l: { directionId: number; side: Side }, isTo: boolean): boolean {
  const r = s.route!;
  return l.directionId === r.directionId && (l.side === r.fromSide) !== isTo;
}

const placeOf = (l: LocalityView, address: string | null, lat: number | null = null, lon: number | null = null): Place => ({
  localityId: l.id,
  directionId: l.directionId,
  side: l.side,
  city: l.name,
  village: l.kind === 'village',
  address,
  lat,
  lon,
});

/** Где забрать или куда отвезти: сохранённый адрес, город или деревня; затем адрес или «из рук в руки». */
async function askPlace(w: Wizard, s: ParcelState, which: 'from' | 'to'): Promise<Place | 'back' | 'home'> {
  const isTo = which === 'to';
  const ok = (l: { directionId: number; side: Side }) => fits(s, l, isTo);
  for (;;) {
    const saved = s.savedAddresses.filter(ok);
    const cities = s.localities.filter((l) => l.kind === 'city' && ok(l));
    const villages = s.localities.filter((l) => l.kind === 'village' && ok(l));
    const a = await w.ask({
      text: head(s, t(isTo ? 'parcel-ask-to' : 'parcel-ask-from'), t('search-place-note')),
      rows: [
        ...saved.map((x) => [{ text: cut(`${x.label} · ${x.city}, ${x.address}`, 48), data: `s${x.id}` }]),
        ...cities.map((l) => [{ text: l.name, data: `c${l.id}` }]),
        ...(villages.length ? [[{ text: t('btn-village'), data: 'v' }]] : []),
      ],
    });
    if (a.kind !== 'btn') return a.kind === 'home' ? 'home' : 'back';

    if (a.data.startsWith('s')) {
      const x = saved.find((v) => v.id === Number(a.data.slice(1)))!;
      return { localityId: x.localityId, directionId: x.directionId, side: x.side, city: x.city, village: x.village, address: x.address, lat: x.lat, lon: x.lon };
    }
    let locality: LocalityView | undefined;
    if (a.data === 'v') {
      const v = await w.ask({ text: head(s, t('search-ask-village')), rows: grid(villages.map((l) => ({ text: l.name, data: String(l.id) })), 2) });
      if (v.kind === 'home') return 'home';
      if (v.kind !== 'btn') continue;
      locality = villages.find((l) => l.id === Number(v.data));
    } else {
      locality = cities.find((l) => l.id === Number(a.data.slice(1)));
    }
    if (!locality) continue;

    const ad = await w.ask({
      text: head(s, t(isTo ? 'parcel-ask-address-to' : 'parcel-ask-address-from', { city: esc(locality.name) })),
      rows: [[{ text: t(isTo ? 'btn-parcel-to-self' : 'btn-parcel-from-self'), data: 'self' }]],
      acceptText: true,
      acceptLocation: true,
      hint: t('search-address-hint'),
      validate: (v) => (v.length >= 3 && v.length <= 120 ? null : t('search-address-hint')),
    });
    if (ad.kind === 'home') return 'home';
    if (ad.kind === 'btn') return placeOf(locality, null);
    if (ad.kind === 'text') return placeOf(locality, ad.text);
    if (ad.kind === 'location') return placeOf(locality, t('address-geo'), ad.lat, ad.lon);
    // «Назад» — снова к выбору места.
  }
}

/** Карточка перед отправкой: всё одним экраном, плюс что нельзя отправлять. */
function cardText(s: ParcelState): string {
  const r = s.recipient!;
  return [
    `<b>${t('parcel-card-title')}</b>`,
    '',
    `📦 ${esc(s.route!.label)}, ${timeLabel(s.day!, s.timeKind!, s.exactMinutes)}`,
    t(`parcel-size-${s.size!}`),
    `💬 ${esc(s.contents!)}`,
    s.valuable ? `🔒 ${t('parcel-valuable-line')}` : null,
    `${t('label-from')}: ${parcelPlaceLine(s.from!, 'from')}`,
    `${t('label-to')}: ${parcelPlaceLine(s.to!, 'to')}`,
    `${t('parcel-recipient')}: ${r.self ? t('parcel-recipient-self') : `${esc(r.name)}, ${fmtPhone(r.phone)}`}`,
    `💰 ${parcelPriceLine(s)}`,
    '',
    t('parcel-forbidden'),
    '',
    t('card-hint'),
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
}

const steps: Step<ParcelState>[] = [
  {
    id: 'route',
    when: (s) => !s.route,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-route'), t('parcel-intro')),
        rows: column(s.routes.map((r, i) => ({ text: r.label, data: `r${i}` }))),
        back: false,
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      const route = s.routes[Number(a.data.slice(1))]!;
      if (route !== s.route) {
        s.route = route;
        // Маршрут сменился — адреса ему уже не подходят.
        if (s.from && !fits(s, s.from, false)) s.from = undefined;
        if (s.to && !fits(s, s.to, true)) s.to = undefined;
      }
      return 'next';
    },
  },
  {
    id: 'day',
    when: (s) => !s.day,
    run: async (w, s) => {
      const d = await w.ask({ text: head(s, t('parcel-ask-day')), rows: grid(dayButtons(s.days), 2) });
      if (d.kind !== 'btn') return nav(d) ?? 'back';
      s.day = s.days[Number(d.data.slice(1))]!.day;
      s.timeKind = undefined;
      return 'next';
    },
  },
  {
    id: 'time',
    when: (s) => !s.timeKind,
    run: async (w, s) => {
      const p = await w.ask({
        text: head(s, t('parcel-ask-time')),
        rows: column([
          { text: t('time-btn-any'), data: 'any' },
          { text: t('time-btn-morning'), data: 'morning' },
          { text: t('time-btn-day'), data: 'day' },
          { text: t('time-btn-evening'), data: 'evening' },
          { text: t('time-btn-exact'), data: 'exact' },
        ]),
      });
      if (p.kind !== 'btn') return nav(p) ?? 'back';
      const kind = p.data as ParcelTimeKind;
      let exact: number | null = null;
      if (kind === 'exact') {
        const x = await w.ask({
          text: head(s, t('search-ask-exact-time')),
          acceptText: true,
          hint: t('hint-time'),
          validate: (v) => (parseTime(v) === null ? t('hint-time') : null),
        });
        if (x.kind !== 'text') return x.kind === 'home' ? 'home' : { goto: 'time' };
        exact = parseTime(x.text);
      }
      if (await w.ext(() => parcelWindowExpired(s.day!, kind, exact))) {
        await w.say(t('search-time-passed'));
        return { goto: 'time' };
      }
      s.timeKind = kind;
      s.exactMinutes = exact;
      return 'next';
    },
  },
  {
    id: 'size',
    when: (s) => !s.size,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-size')),
        rows: column(SIZES.map((x) => ({ text: t(`parcel-size-btn-${x}`), data: x }))),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.size = a.data as ParcelSize;
      return 'next';
    },
  },
  {
    id: 'contents',
    when: (s) => !s.contents,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-contents'), t(s.size === 'bulky' ? 'parcel-contents-note-bulky' : 'parcel-contents-note')),
        acceptText: true,
        validate: lengthBetween(3, 200),
      });
      if (a.kind !== 'text') return nav(a) ?? 'back';
      s.contents = a.text;
      return 'next';
    },
  },
  {
    // Ценное везут только водители со значком «Проверен» — спрашиваем прямо, одной кнопкой.
    id: 'valuable',
    when: (s) => s.valuable === undefined,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-valuable'), t('parcel-valuable-note')),
        rows: column([
          { text: t('btn-parcel-valuable-no'), data: 'no' },
          { text: t('btn-parcel-valuable-yes'), data: 'yes' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.valuable = a.data === 'yes';
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
    id: 'recipient',
    when: (s) => !s.recipient,
    run: async (w, s): Promise<Outcome> => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-recipient')),
        rows: column([
          ...s.savedPassengers.map((p) => ({ text: `${p.name}, ${fmtPhone(p.phone)}`, data: `p${p.id}` })),
          { text: t('parcel-recipient-other'), data: 'other' },
          { text: t('parcel-recipient-self'), data: 'self' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'self') {
        s.recipient = { ...s.self, self: true };
        return 'next';
      }
      if (a.data.startsWith('p')) {
        const p = s.savedPassengers.find((x) => x.id === Number(a.data.slice(1)))!;
        s.recipient = { name: p.name, phone: p.phone, self: false };
        return 'next';
      }
      const n = await w.ask({ text: head(s, t('parcel-ask-recipient-name')), acceptText: true, validate: (v) => (cleanName(v) ? null : t('reg-name-hint')) });
      if (n.kind !== 'text') return n.kind === 'home' ? 'home' : { goto: 'recipient' };
      const name = cleanName(n.text)!;
      const ph = await w.ask({
        text: head(s, t('parcel-ask-recipient-phone', { name: esc(name) })),
        acceptText: true,
        acceptContact: true,
        hint: t('who-phone-hint'),
        validate: (v) => (normalizePhone(v) ? null : t('who-phone-hint')),
      });
      const phone = ph.kind === 'text' ? normalizePhone(ph.text) : ph.kind === 'contact' ? ph.phone : null;
      if (!phone) return ph.kind === 'home' ? 'home' : { goto: 'recipient' };
      s.recipient = { name, phone, self: false };
      return 'next';
    },
  },
  {
    id: 'price',
    when: (s) => !s.priceAsked,
    run: async (w, s) => {
      const a = await w.ask({
        text: head(s, t('parcel-ask-price'), t('parcel-price-note', { from: money(s.priceFrom), to: money(s.priceTo) })),
        rows: [[{ text: t('btn-parcel-price-deal'), data: 'deal' }]],
        acceptText: true,
        hint: t('parcel-price-hint', { min: PRICE_MIN, max: money(PRICE_MAX) }),
        validate: (v) => {
          const n = Number(v.replace(/[\s₽р.руб]/gi, ''));
          return Number.isInteger(n) && n >= PRICE_MIN && n <= PRICE_MAX ? null : t('parcel-price-hint', { min: PRICE_MIN, max: money(PRICE_MAX) });
        },
      });
      if (a.kind === 'btn') s.price = null;
      else if (a.kind === 'text') s.price = Number(a.text.replace(/[\s₽р.руб]/gi, ''));
      else return nav(a) ?? 'back';
      s.priceAsked = true;
      return 'next';
    },
  },
  {
    id: 'card',
    run: async (w, s): Promise<Outcome> => {
      const btn = (text: string, data: string): Opt => ({ text: cut(text, 32), data });
      const a = await w.ask({
        text: cardText(s),
        rows: [
          [{ text: t('btn-send-parcel'), data: 'ok', style: 'success' }],
          [btn(`🕔 ${t('btn-parcel-edit-time')}`, 'time'), btn(`📦 ${t('btn-parcel-edit-size')}`, 'size')],
          [btn(`💬 ${t('btn-parcel-edit-contents')}`, 'contents'), btn(`💰 ${t('btn-parcel-edit-price')}`, 'price')],
          [btn(`📍 ${t('label-from')}`, 'from'), btn(`🏁 ${t('label-to')}`, 'to')],
          [btn(`👤 ${t('parcel-recipient')}`, 'recipient'), btn(`🔒 ${t('btn-parcel-edit-valuable')}`, 'valuable')],
        ],
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data !== 'ok') return { goto: a.data, returnTo: 'card' };
      const r = s.recipient!;
      const res = await w.ext(() =>
        submitParcel({
          senderId: s.userId,
          directionId: s.route!.directionId,
          fromSide: s.route!.fromSide,
          day: s.day!,
          timeKind: s.timeKind!,
          exactMinutes: s.exactMinutes,
          size: s.size!,
          contents: s.contents!,
          valuable: !!s.valuable,
          from: s.from!,
          to: s.to!,
          recipient: { name: r.name, phone: r.phone },
          price: s.price,
        }),
      );
      if (res.ok) {
        s.result = { parcel: res.parcel };
        return 'next';
      }
      if (res.reason === 'past') {
        await w.say(t('search-time-passed'));
        return { goto: 'time', returnTo: 'card' };
      }
      s.result = { problem: 'limit', limit: await w.ext(async () => (await loadSettings()).parcel_open_limit) };
      return 'next';
    },
  },
];

/**
 * «Отправить посылку»: маршрут → день и время → размер → что внутри → откуда → куда →
 * кому → цена → карточка. Заявка уходит водителям направления, они берут её в свой рейс.
 */
export async function parcel(conv: MyConversation, ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId, ctx.callbackQuery?.message?.message_id);

  const state = await w.ext(async (): Promise<ParcelState | null> => {
    const user = await getUserByTg(telegramId);
    if (!user) return null;
    const set = await loadSettings();
    return {
      userId: user.id,
      self: { name: user.name, phone: user.phone },
      routes: await listRoutes(),
      localities: await listLocalities(),
      savedAddresses: await listAddresses(user.id),
      savedPassengers: await listPassengers(user.id),
      days: dayOptions(set.trip_horizon_days),
      priceFrom: set.parcel_price_from,
      priceTo: set.parcel_price_to,
      exactMinutes: null,
      price: null,
      priceAsked: false,
    };
  });
  if (!state) return;
  const s = state;

  const res = await runSteps(w, steps, s);
  if (res === 'home' || !s.result) {
    await w.say(t('parcel-cancelled'));
    return;
  }
  const result = s.result;
  if ('problem' in result) {
    await w.finish(t('parcel-fail-limit', { n: result.limit }), kb([[{ text: t('menu-my-trips'), data: 'p:trips' }]]));
    return;
  }
  const p = result.parcel;
  await w.finish(
    `${t('parcel-sent')}\n\n${parcelCard(p, { contacts: true })}`,
    kb([
      [{ text: t('btn-cancel-parcel'), data: `p:pcx:${p.id}`, style: 'danger' }],
      [{ text: t('menu-my-trips'), data: 'p:trips' }],
    ]),
  );
}
