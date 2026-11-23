import { Composer } from 'grammy';
import { app } from '../../app.js';
import { t } from '../../i18n.js';
import { cut, esc, money } from '../../lib/format.js';
import { fmtMinutes, fmtTime } from '../../lib/time.js';
import { boardDays, listRoutes, openRequests, openTrips, type PublicRequest } from '../../services/board.js';
import { getDriver } from '../../services/drivers.js';
import { loadSettings } from '../../services/settings.js';
import type { TripView } from '../../services/trips.js';
import { dayOptions } from '../conversations/common.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { kb, type Btn } from '../tg.js';
import { show } from './shared.js';

/**
 * «📋 Доска» — все открытые рейсы водителей и заявки пассажиров на день, одним сообщением.
 * Вкладки, направление и день переключаются кнопками в том же сообщении. Заявки — без личных данных.
 *
 * Кнопки: b:<вкладка t|r>:<номер маршрута>:<день YYYY-MM-DD>[:<страница>].
 */
export const board = new Composer<MyContext>();

type Tab = 't' | 'r';
const MAX_ITEMS = 10;

function tripLine(x: TripView): string {
  const d = x.driver;
  const extra = [
    x.villages && '🏡',
    d.childSeat && '👶',
    x.pickupMode !== 'door' && x.pickupPoints.length > 0 && '📍',
  ].filter(Boolean);
  return [
    `<b>${fmtTime(x.departsAt)}</b> · ${esc(d.name)}${d.badge ? ' ✅' : ''} · ${esc(d.car)}`,
    ` · ${t('trip-seats-free', { n: x.seatsFree })} · ${money(x.price)}${extra.length ? ` · ${extra.join(' ')}` : ''}`,
  ].join('');
}

export function requestWhen(r: Pick<PublicRequest, 'timeKind' | 'exactMinutes'>): string {
  return r.timeKind === 'exact' ? t('time-at', { time: fmtMinutes(r.exactMinutes ?? 0) }) : t(`time-${r.timeKind}`);
}

function requestLine(r: PublicRequest): string {
  const place = (city: string, village: boolean) => (village ? `${esc(city)} (${t('village-mark')})` : esc(city));
  return [
    `<b>${requestWhen(r)}</b> · ${place(r.fromCity, r.fromVillage)} → ${place(r.toCity, r.toVillage)}`,
    ` · ${t('seats-count', { n: r.seats })} · ${t(`card-baggage-${r.baggage}`).toLowerCase()}`,
    r.childSeat !== 'none' ? ' · 👶' : '',
  ].join('');
}

/** Ссылка на тот же экран в Mini App: направление, сторона и день — в адресе. */
function miniappBoardUrl(directionId: number, fromSide: string, day: string): string | null {
  if (!app.miniappUrl) return null;
  try {
    const u = new URL(app.miniappUrl);
    u.searchParams.set('screen', 'board');
    u.searchParams.set('route', `${directionId}-${fromSide}`);
    u.searchParams.set('day', day);
    return u.toString();
  } catch {
    // MINIAPP_URL записан с ошибкой (например, без https://) — доска работает и без кнопки приложения.
    return null;
  }
}

export async function boardScreen(ctx: MyContext, tab: Tab = 't', routeIdx = 0, wantDay?: string, wantPage = 0): Promise<void> {
  const routes = await listRoutes();
  const ri = routes[routeIdx] ? routeIdx : 0;
  const route = routes[ri];
  if (!route) return show(ctx, t('board-empty-directions'));
  const s = await loadSettings();
  const days = dayOptions(s.trip_horizon_days);
  const keys = await boardDays();
  const day = wantDay && keys.includes(wantDay) ? wantDay : keys[0]!;
  const di = days.findIndex((d) => d.day === day);
  const label = days[di]?.label ?? day;

  const q = { directionId: route.directionId, fromSide: route.fromSide, day };
  const [trips, reqs] = await Promise.all([openTrips(q), openRequests(q)]);
  const me = ctx.user!;
  const driver = await getDriver(me.id);
  const canTake = driver?.status === 'approved';

  // Длинный список — по страницам, листаются кнопками в том же сообщении.
  const total = tab === 't' ? trips.length : reqs.length;
  const pages = Math.max(1, Math.ceil(total / MAX_ITEMS));
  const page = Math.min(Math.max(0, wantPage), pages - 1);
  const from = page * MAX_ITEMS;
  const pageTrips = trips.slice(from, from + MAX_ITEMS);
  const pageReqs = reqs.slice(from, from + MAX_ITEMS);
  const list =
    tab === 't'
      ? trips.length
        ? pageTrips.map(tripLine).join('\n')
        : t('board-no-trips')
      : reqs.length
        ? pageReqs.map(requestLine).join('\n')
        : t('board-no-requests');
  const more = pages > 1 ? `\n\n${t('board-page', { from: from + 1, to: from + (tab === 't' ? pageTrips : pageReqs).length, total })}` : '';
  const text = [
    `📋 <b>${t('board-title')}</b>`,
    `<i>${esc(route.label)} · ${label}</i>`,
    '',
    `<b>${t(tab === 't' ? 'board-tab-trips-title' : 'board-tab-requests-title')}</b>`,
    list + more,
    tab === 'r' ? `\n${t('board-privacy-note')}` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');

  const go = (tb: Tab, r: number, d: string, p = 0) => `b:${tb}:${r}:${d}${p ? `:${p}` : ''}`;
  const prev = days[di - 1];
  const next = days[di + 1];
  const items: Btn[][] =
    tab === 't'
      ? pageTrips.map((x) =>
          x.driverId === me.id
            ? [{ text: cut(`📋 ${t('board-my-trip')} ${fmtTime(x.departsAt)}`, 60), data: `d:t:${x.id}` }]
            : [{ text: cut(`🚗 ${t('board-ride')} ${fmtTime(x.departsAt)} · ${x.driver.name}`, 60), data: `p:bt:${x.id}` }],
        )
      : canTake
        ? pageReqs.map((r) => [{ text: cut(`✋ ${t('btn-take-request')}: ${requestWhen(r)} · ${t('seats-count', { n: r.seats })}`, 60), data: `r:take:${r.id}` }])
        : [];
  const webApp = miniappBoardUrl(route.directionId, route.fromSide, day);

  await show(
    ctx,
    text,
    kb([
      [
        { text: `🚗 ${t('board-tab-trips')} · ${trips.length}`, data: go('t', ri, day), style: tab === 't' ? 'primary' : undefined },
        { text: `🙋 ${t('board-tab-requests')} · ${reqs.length}`, data: go('r', ri, day), style: tab === 'r' ? 'primary' : undefined },
      ],
      ...(routes.length > 1
        ? (routes.length <= 2 ? [routes] : routes.map((r) => [r])).map((row) =>
            row.map((r) => {
              const i = routes.indexOf(r);
              return { text: r.label, data: go(tab, i, day), style: i === ri ? ('primary' as const) : undefined };
            }),
          )
        : []),
      [prev && { text: `◀ ${prev.label}`, data: go(tab, ri, prev.day) }, next && { text: `${next.label} ▶`, data: go(tab, ri, next.day) }],
      ...items,
      pages > 1
        ? [
            page > 0 && { text: `◀ ${t('board-page-prev')}`, data: go(tab, ri, day, page - 1) },
            page < pages - 1 && { text: `${t('board-page-next')} ▶`, data: go(tab, ri, day, page + 1) },
          ]
        : [],
      tab === 't'
        ? [{ text: t(trips.length ? 'board-find' : 'btn-leave-request'), data: `b:${trips.length ? 'find' : 'req'}:${ri}:${day}` }]
        : [
            { text: t('btn-leave-request'), data: `b:req:${ri}:${day}` },
            canTake && { text: t('menu-post-trip'), data: 'd:post' },
          ],
      [{ text: t('btn-refresh'), data: go(tab, ri, day, page) }, webApp ? { text: t('board-open-app'), webApp } : null],
    ]),
  );
}

board.callbackQuery('b:home', (ctx) => boardScreen(ctx));
board.callbackQuery(/^b:([tr]):(\d+):(\d{4}-\d{2}-\d{2})(?::(\d+))?$/, (ctx) =>
  boardScreen(ctx, ctx.match[1] as Tab, Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4] ?? 0)),
);

// С доски — сразу в поиск или заявку на этот маршрут и день, без вопросов «куда» и «когда».
board.callbackQuery(/^b:(find|req):(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const route = (await listRoutes())[Number(ctx.match[2])];
  if (!route) return boardScreen(ctx);
  await enter(ctx, 'search', { directionId: route.directionId, fromSide: route.fromSide, day: ctx.match[3], request: ctx.match[1] === 'req' });
});
