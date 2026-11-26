import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { cut } from '../../lib/format.js';
import { fmtTime } from '../../lib/time.js';
import { listOpenParcelsForDriver } from '../../services/parcels.js';
import { getRequest, listOpenRequestsForDriver, tripsForRequest } from '../../services/requests.js';
import { takeRequestAction } from '../actions.js';
import type { MyContext } from '../context.js';
import { deleteMessage, kb } from '../tg.js';
import { bookingForDriver, parcelCard, requestCard, timeLabel } from '../ui/cards.js';
import { num, requireDriver, show, toast } from './shared.js';

export const requests = new Composer<MyContext>();

/** Сколько символов текста отдаём под карточки: лимит Telegram 4096, остальное — заголовки и запас. */
const LIST_TEXT_LIMIT = 3600;

/**
 * «Заявки»: пассажиры, которым не нашлось рейса, и посылки. «Беру» превращает заявку в бронь
 * в своём рейсе, а посылку кладёт в рейс.
 */
export async function requestsList(ctx: MyContext): Promise<void> {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return show(ctx, t(`drv-cannot-post-${d.status}`));
  // Карточки идут, пока сообщение укладывается в лимит Telegram (4096 символов). Остальные — следующим заходом.
  const budget = { left: LIST_TEXT_LIMIT, hidden: 0 };
  const fit = <T,>(items: T[], card: (x: T, i: number) => string): { item: T; text: string }[] => {
    const out: { item: T; text: string }[] = [];
    for (const [i, item] of items.entries()) {
      const text = card(item, i);
      if (text.length + 2 > budget.left) {
        budget.hidden += items.length - i;
        break;
      }
      budget.left -= text.length + 2;
      out.push({ item, text });
    }
    return out;
  };
  const list = fit(await listOpenRequestsForDriver(d.userId), (r, i) => `${i + 1}. ${requestCard(r)}`);
  const parcels = fit(await listOpenParcelsForDriver(d), (p, i) => `${i + 1}. ${parcelCard(p)}`);
  const parts: string[] = [];
  if (list.length) parts.push(`<b>${t('req-list-title')}</b>\n\n${list.map((x) => x.text).join('\n\n')}`);
  if (parcels.length) parts.push(`<b>${t('parcel-list-title')}</b>\n\n${parcels.map((x) => x.text).join('\n\n')}`);
  if (budget.hidden) parts.push(t('req-list-more', { n: budget.hidden }));
  await show(
    ctx,
    parts.length ? parts.join('\n\n') : t('req-list-empty'),
    kb([
      ...list.map(({ item: r }, i) => [{ text: cut(`${t('btn-take-request')} ${i + 1}: ${timeLabel(r.day, r.timeKind, r.exactMinutes)}`, 60), data: `r:take:${r.id}` }]),
      ...parcels.map(({ item: p }, i) => [{ text: cut(`📦 ${t('btn-take-request')} ${i + 1}: ${timeLabel(p.day, p.timeKind, p.exactMinutes)}`, 60), data: `pc:take:${p.id}` }]),
    ]),
  );
}
requests.callbackQuery('r:list', requestsList);

requests.callbackQuery('r:skip', async (ctx) => {
  await ctx.answerCallbackQuery();
  const m = ctx.callbackQuery.message;
  if (m) await deleteMessage(m.chat.id, m.message_id);
});

requests.callbackQuery(/^r:take:(\d+)$/, async (ctx) => {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return toast(ctx, t(`drv-cannot-post-${d.status}`), true);
  const r = await getRequest(num(ctx));
  if (!r || r.status !== 'open') return toast(ctx, t('req-gone'), true);
  const trips = await tripsForRequest(d.userId, r);
  if (trips.length === 0) {
    return show(
      ctx,
      `${t('req-need-trip')}\n\n${requestCard(r)}`,
      kb([[{ text: t('menu-post-trip'), data: 'd:post' }], [{ text: t('btn-refresh'), data: `r:take:${r.id}` }]]),
    );
  }
  await show(
    ctx,
    `${t('req-choose-trip')}\n\n${requestCard(r)}`,
    kb([
      ...trips.map((x) => [{ text: t('req-into-trip', { time: fmtTime(x.departsAt), free: x.seatsFree }), data: `r:t:${r.id}:${x.id}` }]),
      [{ text: t('btn-cancel'), data: 'r:list' }],
    ]),
  );
});

requests.callbackQuery(/^r:t:(\d+):(\d+)$/, async (ctx) => {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return toast(ctx, t(`drv-cannot-post-${d.status}`), true);
  const res = await takeRequestAction(num(ctx, 1), ctx.user!.id, num(ctx, 2));
  if (!res.ok) return toast(ctx, t(res.reason === 'gone' ? 'req-gone' : 'req-take-failed'), true);
  await show(
    ctx,
    `${t('req-taken-driver')}\n\n${bookingForDriver(res.booking)}`,
    kb([[{ text: t('btn-to-trip'), data: `d:t:${res.booking.tripId}` }]]),
  );
});
