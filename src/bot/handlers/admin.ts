import { Composer } from 'grammy';
import type { PrivilegeKind, Side } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { cut, esc, fmtPhone, money } from '../../lib/format.js';
import { dayStart, fmtDateTime, now, todayKey } from '../../lib/time.js';
import { listPendingAdminBookings } from '../../services/bookings.js';
import { getComplaint, listOpenComplaints, takeComplaint } from '../../services/complaints.js';
import { cityOf, deactivateVillage, getDirection, listDirections, listLocalities } from '../../services/directions.js';
import { getDriver, grantPrivilege, listDriversByStatus, revokePrivilege } from '../../services/drivers.js';
import { lowRatings, ratingOf } from '../../services/ratings.js';
import { candidateDrivers, getRequest, listEscalatedRequests } from '../../services/requests.js';
import { loadSettings, SETTING_KEYS } from '../../services/settings.js';
import { activity, funnel } from '../../services/stats.js';
import { getTrip } from '../../services/trips.js';
import { botLink, CHANNEL_SOURCE, DRIVER_SOURCE_PREFIX } from '../../services/links.js';
import { getUser, setRestriction, sourceStats, userStats, type SourceStat } from '../../services/users.js';
import { adminBookingDecision, closeRequestByAdmin, offerRequest, reviewDriver, showDriverForReview } from '../actions.js';
import type { MyContext } from '../context.js';
import { enter } from '../enter.js';
import { kb, type Btn } from '../tg.js';
import { bookingForDriver, complaintCard, ratingOrNone, requestCard, starsText, timeLabel } from '../ui/cards.js';
import { num, show, toast } from './shared.js';

export const admin = new Composer<MyContext>();

// Раздел только для админов: проверка идёт по Telegram ID на каждое нажатие.
const guarded = admin.filter((ctx) => ctx.isAdmin);

const menuBack = (): Btn[] => [{ text: t('adm-menu-back'), data: 'a:menu' }];

/** Главная админа: сверху то, что требует реакции, с числом. */
export async function adminMenu(ctx: MyContext): Promise<void> {
  if (!ctx.isAdmin) return toast(ctx, t('only-admins'), true);
  const [drivers, requests, complaints, bookings] = await Promise.all([
    listDriversByStatus('pending'),
    listEscalatedRequests(),
    listOpenComplaints(),
    listPendingAdminBookings(),
  ]);
  await show(
    ctx,
    t('adm-menu-title'),
    kb([
      [{ text: t('adm-drivers-n', { n: drivers.length }), data: 'a:drv' }],
      [{ text: t('adm-requests-n', { n: requests.length }), data: 'a:rq' }],
      [{ text: t('adm-complaints-n', { n: complaints.length }), data: 'a:cmp' }],
      [{ text: t('adm-bookings-n', { n: bookings.length }), data: 'a:bk' }],
      [{ text: t('adm-users'), data: 'a:usr' }],
      [{ text: t('adm-stats'), data: 'a:st:7' }, { text: t('adm-sources'), data: 'a:src' }],
      [{ text: t('adm-villages'), data: 'a:vil' }, { text: t('adm-settings'), data: 'a:set' }],
    ]),
  );
}
guarded.callbackQuery('a:menu', adminMenu);

// ——— Статистика ———

/** Срок отчёта: сегодня (с полуночи), N дней или всё время. */
type StatsPeriod = 'd' | '7' | '30' | 'all';

function periodStart(p: StatsPeriod): Date | undefined {
  if (p === 'all') return undefined;
  if (p === 'd') return dayStart(todayKey());
  return new Date(now().getTime() - Number(p) * 86_400_000);
}

function periodLabel(p: StatsPeriod): string {
  if (p === 'all') return t('adm-stats-period-all');
  if (p === 'd') return t('adm-stats-period-today');
  return t('adm-stats-period-days', { days: Number(p) });
}

/** « · 67%» от числа нажавших «Старт»; пусто, если делить не на что. */
const pct = (n: number, of: number): string => (of > 0 ? ` · ${Math.round((n / of) * 100)}%` : '');

async function statsScreen(ctx: MyContext, p: StatsPeriod): Promise<void> {
  const since = periodStart(p);
  const [f, a] = await Promise.all([funnel(since), activity(since)]);
  const text = [
    `<b>${t('adm-stats-title', { period: periodLabel(p) })}</b>`,
    t('adm-stats-funnel', {
      started: f.started,
      registered: f.registered,
      registeredPct: pct(f.registered, f.started),
      booked: f.booked,
      bookedPct: pct(f.booked, f.started),
      rode: f.rode,
      rodePct: pct(f.rode, f.started),
      drivers: f.drivers,
      left: f.started - f.registered,
    }),
    t('adm-stats-trips', {
      posted: a.tripsPosted,
      completed: a.tripsCompleted,
      cancelled: a.tripsCancelled,
      bookings: a.bookings,
      bookingsCompleted: a.bookingsCompleted,
      bookingsCancelled: a.bookingsCancelled,
      noShows: a.noShows,
      seats: a.seatsCompleted,
      revenue: money(a.revenue),
      requests: a.requests,
      requestsTaken: a.requestsTaken,
    }),
    t('adm-stats-people', {
      active: a.active,
      usersTotal: a.usersTotal,
      driversApproved: a.driversApproved,
      driversPending: a.driversPending,
      driverForms: a.driverForms,
    }),
    `<i>${t('adm-stats-note')}</i>`,
  ].join('\n\n');
  const tab = (key: StatsPeriod, label: string): Btn => ({ text: key === p ? `· ${label} ·` : label, data: `a:st:${key}` });
  await show(
    ctx,
    text,
    kb([
      [tab('d', t('adm-stats-today')), tab('7', t('adm-stats-7')), tab('30', t('adm-stats-30')), tab('all', t('adm-stats-all'))],
      [{ text: t('adm-sources'), data: 'a:src' }],
      menuBack(),
    ]),
  );
}
guarded.callbackQuery(/^a:st:(d|7|30|all)$/, (ctx) => statsScreen(ctx, ctx.match[1] as StatsPeriod));

// ——— Откуда приходят ———

/** Подпись источника: код друга как есть, рейс водителя — его имя, канал и «без метки» — словами. */
async function sourceLabel(source: string | null): Promise<string> {
  if (source === null) return t('src-none');
  if (source === CHANNEL_SOURCE) return t('src-channel');
  if (source.startsWith(DRIVER_SOURCE_PREFIX)) {
    const driver = await getUser(Number(source.slice(DRIVER_SOURCE_PREFIX.length)));
    return t('src-driver', { name: esc(driver?.name ?? '?') });
  }
  return esc(source);
}

async function sourceLine(x: SourceStat): Promise<string> {
  return t('src-line', { label: await sourceLabel(x.source), users: x.users, bookers: x.bookers, bookings: x.bookings, completed: x.completed });
}

async function sourcesScreen(ctx: MyContext, days: number | null): Promise<void> {
  const since = days === null ? undefined : new Date(now().getTime() - days * 86_400_000);
  const stats = await sourceStats(since);
  const example = botLink('s_aigul');
  const text = [
    `<b>${days === null ? t('adm-sources-title-all') : t('adm-sources-title', { days })}</b>`,
    stats.length ? (await Promise.all(stats.map(sourceLine))).join('\n') : t('adm-sources-empty'),
    example ? t('adm-sources-howto', { example: esc(example) }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  await show(
    ctx,
    text,
    kb([
      [
        { text: t('adm-sources-30'), data: 'a:src' },
        { text: t('adm-sources-all'), data: 'a:src:all' },
      ],
      menuBack(),
    ]),
  );
}
guarded.callbackQuery('a:src', (ctx) => sourcesScreen(ctx, 30));
guarded.callbackQuery('a:src:all', (ctx) => sourcesScreen(ctx, null));

// ——— Проверка водителей ———

guarded.callbackQuery('a:drv', async (ctx) => {
  const list = await listDriversByStatus('pending');
  await show(
    ctx,
    list.length ? t('adm-drivers-title') : t('adm-drivers-empty'),
    kb([...list.map((d) => [{ text: cut(`${d.fullName} · ${d.car}`, 60), data: `a:d:${d.userId}` }]), menuBack()]),
  );
});

guarded.callbackQuery(/^a:d:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDriverForReview(ctx.chat!.id, num(ctx));
});

guarded.callbackQuery(/^a:d:ok:(\d+)$/, async (ctx) => {
  const ok = await reviewDriver(num(ctx), ctx.user?.id ?? null, 'approve');
  await show(ctx, t(ok ? 'adm-driver-approved' : 'not-found'), kb([[{ text: t('adm-drivers'), data: 'a:drv' }]]));
});
guarded.callbackQuery(/^a:d:ph:(\d+)$/, async (ctx) => {
  const ok = await reviewDriver(num(ctx), ctx.user?.id ?? null, 'photos');
  await show(ctx, t(ok ? 'adm-driver-photos-requested' : 'not-found'), kb([[{ text: t('adm-drivers'), data: 'a:drv' }]]));
});
guarded.callbackQuery(/^a:d:no:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminReject', id: num(ctx) });
});

// ——— Заявки без водителя ———

guarded.callbackQuery('a:rq', async (ctx) => {
  const list = await listEscalatedRequests();
  await show(
    ctx,
    list.length ? t('adm-requests-title') : t('adm-requests-empty'),
    kb([
      ...list.map((r) => [{ text: cut(`${timeLabel(r.day, r.timeKind, r.exactMinutes)} · ${r.route}`, 60), data: `a:rq:${r.id}` }]),
      menuBack(),
    ]),
  );
});

guarded.callbackQuery(/^a:rq:(\d+)$/, async (ctx) => {
  const r = await getRequest(num(ctx));
  if (!r) return toast(ctx, t('not-found'), true);
  const candidates = r.status === 'open' ? await candidateDrivers(r) : [];
  await show(
    ctx,
    [requestCard(r, { showPhone: true }), `${t('label-status')}: ${t(`request-status-${r.status}`)}`, candidates.length ? t('adm-request-candidates') : ''].filter(Boolean).join('\n\n'),
    kb([
      ...candidates.map((c) => [
        {
          text: cut(`${t('adm-offer-to')} ${c.driver.name}${c.trips.length ? ` · ${t('adm-has-trip')}` : ''} · ${fmtPhone(c.driver.phone)}`, 60),
          data: `a:rq:o:${r.id}:${c.driver.userId}`,
        },
      ]),
      [r.status === 'open' && { text: t('adm-request-close'), data: `a:rq:x:${r.id}` }],
      [{ text: t('adm-requests'), data: 'a:rq' }],
    ]),
  );
});

guarded.callbackQuery(/^a:rq:o:(\d+):(\d+)$/, async (ctx) => {
  const ok = await offerRequest(num(ctx, 1), num(ctx, 2));
  await toast(ctx, t(ok ? 'adm-request-offered' : 'action-not-available'), true);
});
guarded.callbackQuery(/^a:rq:x:(\d+)$/, async (ctx) => {
  const ok = await closeRequestByAdmin(num(ctx));
  await show(ctx, t(ok ? 'adm-request-closed' : 'action-not-available'), kb([[{ text: t('adm-requests'), data: 'a:rq' }]]));
});

// ——— Жалобы ———

guarded.callbackQuery('a:cmp', async (ctx) => {
  const list = await listOpenComplaints();
  await show(
    ctx,
    list.length ? t('adm-complaints-title') : t('adm-complaints-empty'),
    kb([
      ...list.map((c) => [
        { text: cut(`${c.kind === 'wrong_person' ? '🚨 ' : ''}№${c.id} · ${t(`complaint-status-${c.status}`)} · ${c.from.name}`, 60), data: `a:c:${c.id}` },
      ]),
      menuBack(),
    ]),
  );
});

async function complaintScreen(ctx: MyContext, id: number): Promise<void> {
  const c = await getComplaint(id);
  if (!c) return toast(ctx, t('not-found'), true);
  const open = c.status !== 'resolved';
  await show(
    ctx,
    complaintCard(c),
    kb([
      [c.status === 'new' && { text: t('adm-complaint-take'), data: `a:c:take:${c.id}` }],
      [open && { text: t('adm-complaint-note'), data: `a:c:note:${c.id}` }],
      [open && { text: t('adm-complaint-resolve'), data: `a:c:res:${c.id}` }],
      [{ text: cut(`${t('complaint-from')}: ${c.from.name}`, 40), data: `a:u:${c.from.id}` }],
      [c.against && { text: cut(`${t('complaint-against')}: ${c.against.name}`, 40), data: `a:u:${c.against.id}` }],
      [{ text: t('adm-complaints'), data: 'a:cmp' }],
    ]),
  );
}
guarded.callbackQuery(/^a:c:(\d+)$/, (ctx) => complaintScreen(ctx, num(ctx)));
guarded.callbackQuery(/^a:c:take:(\d+)$/, async (ctx) => {
  await takeComplaint(num(ctx), ctx.user?.id ?? null);
  await complaintScreen(ctx, num(ctx));
});
guarded.callbackQuery(/^a:c:(note|res):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: ctx.match[1] === 'note' ? 'adminNote' : 'adminResolve', id: num(ctx, 2) });
});

// ——— Брони, которым нужно подтверждение админа ———

guarded.callbackQuery('a:bk', async (ctx) => {
  const list = await listPendingAdminBookings();
  const parts: string[] = [];
  const rows: Btn[][] = [];
  for (const [i, b] of list.entries()) {
    const trip = await getTrip(b.tripId);
    parts.push(`${i + 1}. ${esc(trip?.route ?? '')}, ${trip ? fmtDateTime(trip.departsAt) : ''}\n${bookingForDriver(b)}`);
    rows.push([
      { text: `${i + 1}. ${t('btn-allow')}`, data: `a:bk:ok:${b.id}` },
      { text: `${i + 1}. ${t('btn-reject')}`, data: `a:bk:no:${b.id}` },
    ]);
  }
  await show(ctx, list.length ? `${t('adm-bookings-title')}\n\n${parts.join('\n\n')}` : t('adm-bookings-empty'), kb([...rows, menuBack()]));
});
guarded.callbackQuery(/^a:bk:(ok|no):(\d+)$/, async (ctx) => {
  const ok = await adminBookingDecision(num(ctx, 2), ctx.match[1] === 'ok');
  await show(
    ctx,
    t(!ok ? 'action-not-available' : ctx.match[1] === 'ok' ? 'adm-booking-allowed' : 'adm-booking-rejected'),
    kb([[{ text: t('adm-bookings'), data: 'a:bk' }]]),
  );
});

// ——— Пользователи: блокировки, ограничения, привилегии ———

guarded.callbackQuery('a:usr', async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminFind' });
});

async function userScreen(ctx: MyContext, userId: number): Promise<void> {
  const u = await getUser(userId);
  if (!u) return toast(ctx, t('not-found'), true);
  const d = await getDriver(userId);
  const st = await userStats(userId);
  const asPassenger = await ratingOf(userId, 'passenger');
  const asDriver = d ? await ratingOf(userId, 'driver') : null;
  const bad = d ? await lowRatings(userId, 'driver') : [];
  const text = [
    `<b>${esc(u.name)}</b> · ${fmtPhone(u.phone)}`,
    `Telegram ID: <code>${u.telegramId}</code>${u.username ? ` · @${esc(u.username)}` : ''}`,
    t('adm-user-stats', { completed: st.completed, noShows: st.noShows, lateCancels: st.lateCancels }),
    `${t('label-passenger-rating')}: ${ratingOrNone(asPassenger)}`,
    asDriver && `${t('adm-driver-rating')}: ${ratingOrNone(asDriver)}`,
    bad.length > 0 &&
      `${t('adm-bad-ratings')}:\n${bad
        .map((r) => `${starsText(r.stars)} · ${esc(r.fromName)}, ${fmtDateTime(r.createdAt.toISOString())}${r.comment ? `\n  «${esc(cut(r.comment, 200))}»` : ''}`)
        .join('\n')}`,
    `${t('adm-user-restriction')}: ${t(`restriction-${u.restriction}`)}${u.restrictionReason ? ` (${esc(u.restrictionReason)})` : ''}`,
    d
      ? `\n${t('label-driver')}: ${esc(d.car)}, ${esc(d.plate)} · ${t(`driver-status-${d.status}`)}\n${t('label-privileges')}: ${[d.badge && t('badge-verified'), d.priority && t('priv-priority')].filter(Boolean).join(', ') || t('adm-none')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const rows: (Btn | false)[][] = [];
  if (u.restriction === 'none') {
    rows.push([{ text: t('adm-user-limit'), data: `a:u:lim:${u.id}` }], [{ text: t('adm-user-block'), data: `a:u:blk:${u.id}` }]);
  } else {
    rows.push([{ text: t('adm-user-free'), data: `a:u:free:${u.id}` }]);
  }
  if (d) {
    rows.push([{ text: t(d.badge ? 'adm-badge-revoke' : 'adm-badge-grant'), data: `a:u:pv:${u.id}:verified_badge` }]);
    rows.push([{ text: t(d.priority ? 'adm-priority-revoke' : 'adm-priority-grant'), data: `a:u:pv:${u.id}:priority` }]);
    if (d.status === 'approved') rows.push([{ text: t('adm-driver-suspend'), data: `a:u:sus:${u.id}` }]);
    if (d.status === 'suspended' || d.status === 'rejected') rows.push([{ text: t('adm-driver-restore'), data: `a:d:ok:${u.id}` }]);
    rows.push([{ text: t('adm-driver-form'), data: `a:d:${u.id}` }]);
  }
  rows.push(menuBack());
  await show(ctx, text, kb(rows));
}
guarded.callbackQuery(/^a:u:(\d+)$/, (ctx) => userScreen(ctx, num(ctx)));

guarded.callbackQuery(/^a:u:(lim|free):(\d+)$/, async (ctx) => {
  const id = num(ctx, 2);
  const limit = ctx.match[1] === 'lim';
  await setRestriction(id, limit ? 'admin_approval' : 'none', limit ? t('restriction-by-admin') : null);
  await userScreen(ctx, id);
});
guarded.callbackQuery(/^a:u:blk:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminBlock', id: num(ctx) });
});
guarded.callbackQuery(/^a:u:sus:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminSuspend', id: num(ctx) });
});

// Привилегия: если есть — снять, если нет — спросить срок.
guarded.callbackQuery(/^a:u:pv:(\d+):(verified_badge|priority)$/, async (ctx) => {
  const id = num(ctx);
  const kind = ctx.match[2] as PrivilegeKind;
  const d = await getDriver(id);
  if (!d) return toast(ctx, t('not-found'), true);
  const has = kind === 'verified_badge' ? d.badge : d.priority;
  if (has) {
    await revokePrivilege(id, kind);
    return userScreen(ctx, id);
  }
  await show(
    ctx,
    t('adm-privilege-term'),
    kb([
      [{ text: t('adm-term-30'), data: `a:u:pvg:${id}:${kind}:30` }],
      [{ text: t('adm-term-forever'), data: `a:u:pvg:${id}:${kind}:0` }],
      [{ text: t('btn-back'), data: `a:u:${id}` }],
    ]),
  );
});
guarded.callbackQuery(/^a:u:pvg:(\d+):(verified_badge|priority):(\d+)$/, async (ctx) => {
  const days = num(ctx, 3);
  const until = days > 0 ? new Date(now().getTime() + days * 86_400_000) : null;
  await grantPrivilege(num(ctx), ctx.match[2] as PrivilegeKind, until, ctx.user?.id ?? null);
  await userScreen(ctx, num(ctx));
});

// ——— Настройки: все числа-правила и канал ———

guarded.callbackQuery('a:set', async (ctx) => {
  const s = await loadSettings();
  const dirs = await listDirections();
  await show(
    ctx,
    t('adm-settings-title'),
    kb([
      ...SETTING_KEYS.map((key) => [{ text: cut(`${t(`setting-${key}`)}: ${s[key] === '' ? '—' : s[key]}`, 60), data: `a:set:${key}` }]),
      ...dirs.flatMap((d) => [
        [{ text: cut(`${t('adm-channel-of', { route: `${d.cityA} ⇄ ${d.cityB}` })}: ${d.channelId ?? '—'}`, 60), data: `a:ch:${d.id}` }],
        [{ text: cut(`${t('adm-price-of', { route: `${d.cityA} ⇄ ${d.cityB}` })}: ${money(d.price)}`, 60), data: `a:pr:${d.id}` }],
        [{ text: cut(`${t('adm-travel-of', { route: `${d.cityA} ⇄ ${d.cityB}` })}: ${d.travelMinutes}`, 60), data: `a:tm:${d.id}` }],
      ]),
      menuBack(),
    ]),
  );
});
guarded.callbackQuery(/^a:set:([a-z_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminSetting', key: ctx.match[1] });
});
guarded.callbackQuery(/^a:(ch|tm):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: ctx.match[1] === 'ch' ? 'adminChannel' : 'adminTravel', id: num(ctx, 2) });
});
guarded.callbackQuery(/^a:pr:(\d+)$/, async (ctx) => {
  const d = await getDirection(num(ctx));
  if (!d) return toast(ctx, t('not-found'), true);
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminPrice', id: d.id, route: `${d.cityA} ⇄ ${d.cityB}` });
});

// ——— Деревни ———

async function villagesScreen(ctx: MyContext): Promise<void> {
  const dirs = await listDirections();
  const villages = (await listLocalities()).filter((l) => l.kind === 'village');
  const rows: Btn[][] = [];
  const parts: string[] = [`<b>${t('adm-villages-title')}</b>`];
  for (const d of dirs) {
    for (const side of ['a', 'b'] as Side[]) {
      const list = villages.filter((v) => v.directionId === d.id && v.side === side);
      parts.push(`${t('adm-villages-near', { city: esc(cityOf(d, side)) })}: ${list.map((v) => esc(v.name)).join(', ') || t('adm-none')}`);
      rows.push([{ text: t('adm-village-add', { city: cityOf(d, side) }), data: `a:vil:add:${d.id}:${side}` }]);
      for (const v of list) rows.push([{ text: cut(`✖ ${v.name}`, 40), data: `a:vil:del:${v.id}` }]);
    }
  }
  await show(ctx, parts.join('\n'), kb([...rows, menuBack()]));
}
guarded.callbackQuery('a:vil', villagesScreen);
guarded.callbackQuery(/^a:vil:add:(\d+):([ab])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await enter(ctx, 'prompt', { kind: 'adminVillage', id: num(ctx), side: ctx.match[2] });
});
guarded.callbackQuery(/^a:vil:del:(\d+)$/, async (ctx) => {
  await deactivateVillage(num(ctx));
  await villagesScreen(ctx);
});

// Не админ нажал админскую кнопку (например, из пересланного сообщения).
admin.callbackQuery(/^a:/, (ctx) => toast(ctx, t('only-admins'), true));
