import { Composer } from 'grammy';
import { t } from '../../i18n.js';
import { cut } from '../../lib/format.js';
import { fmtTime } from '../../lib/time.js';
import { getRequest, listOpenRequestsForDriver, tripsForRequest } from '../../services/requests.js';
import { takeRequestAction } from '../actions.js';
import type { MyContext } from '../context.js';
import { deleteMessage, kb } from '../tg.js';
import { bookingForDriver, requestCard, timeLabel } from '../ui/cards.js';
import { num, requireDriver, show, toast } from './shared.js';

export const requests = new Composer<MyContext>();

/** «Заявки»: пассажиры, которым не нашлось рейса. «Беру» превращает заявку в бронь в своём рейсе. */
export async function requestsList(ctx: MyContext): Promise<void> {
  const d = await requireDriver(ctx);
  if (!d) return;
  if (d.status !== 'approved') return show(ctx, t(`drv-cannot-post-${d.status}`));
  const list = await listOpenRequestsForDriver(d.userId);
  await show(
    ctx,
    list.length
      ? `<b>${t('req-list-title')}</b>\n\n${list.map((r, i) => `${i + 1}. ${requestCard(r)}`).join('\n\n')}`
      : t('req-list-empty'),
    kb(list.map((r, i) => [{ text: cut(`${t('btn-take-request')} ${i + 1}: ${timeLabel(r.day, r.timeKind, r.exactMinutes)}`, 60), data: `r:take:${r.id}` }])),
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
  const res = await takeRequestAction(num(ctx, 1), ctx.user!.id, num(ctx, 2));
  if (!res.ok) return toast(ctx, t(res.reason === 'gone' ? 'req-gone' : 'req-take-failed'), true);
  await show(
    ctx,
    `${t('req-taken-driver')}\n\n${bookingForDriver(res.booking)}`,
    kb([[{ text: t('btn-to-trip'), data: `d:t:${res.booking.tripId}` }]]),
  );
});
