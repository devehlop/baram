import { and, eq } from 'drizzle-orm';
import { GrammyError, InlineKeyboard } from 'grammy';
import { app } from '../app.js';
import { channelPosts } from '../db/schema.js';
import { t } from '../i18n.js';
import { esc, money } from '../lib/format.js';
import { fmtDayKey, fmtTime, now, todayKey } from '../lib/time.js';
import { log } from '../logger.js';
import { getDirection, routeLabel } from './directions.js';
import { tripsOfDay, type TripView } from './trips.js';

function tripLine(trip: TripView): string {
  const seats = trip.seatsFree > 0 ? t('channel-seats', { n: trip.seatsFree }) : t('channel-no-seats');
  const extra = [
    trip.driver.badge && t('badge-verified'),
    trip.villages && t('channel-villages'),
    trip.driver.childSeat && t('channel-child-seat'),
  ].filter(Boolean);
  return [
    `<b>${fmtTime(trip.departsAt)}</b> · ${esc(trip.driver.name)} · ${esc(trip.driver.car)} · ${seats} · ${money(trip.price)}`,
    extra.length ? ` · ${extra.join(' · ')}` : '',
  ].join('');
}

/** Текст сводного поста «Рейсы на <день>»: обе стороны направления в одном сообщении. */
export async function buildDayPost(directionId: number, day: string): Promise<string | null> {
  const dir = await getDirection(directionId);
  if (!dir) return null;
  const trips = await tripsOfDay(directionId, day);
  const parts = [`<b>${t('channel-title', { day: fmtDayKey(day) })}</b>`];
  for (const side of ['a', 'b'] as const) {
    const list = trips.filter((x) => x.fromSide === side);
    if (list.length === 0) continue;
    parts.push(`<b>${esc(routeLabel(dir, side))}</b>\n${list.map(tripLine).join('\n')}`);
  }
  if (trips.length === 0) parts.push(t('channel-empty'));
  parts.push(t('channel-footer'));
  return parts.join('\n\n');
}

/**
 * Публикует или обновляет один сводный пост на день. Отдельных постов на каждый рейс нет —
 * канал не засоряется. Вызывается после любого изменения рейсов и мест.
 */
export async function refreshChannelPost(directionId: number, day: string): Promise<void> {
  const dir = await getDirection(directionId);
  if (!dir?.channelId || day < todayKey()) return;
  const text = await buildDayPost(directionId, day);
  if (!text) return;
  const [post] = await app.db
    .select()
    .from(channelPosts)
    .where(and(eq(channelPosts.directionId, directionId), eq(channelPosts.day, day)));
  if (post?.lastText === text) return;

  const markup = app.botUsername
    ? new InlineKeyboard().url(t('channel-button'), `https://t.me/${app.botUsername}`)
    : undefined;
  const options = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true }, reply_markup: markup };
  try {
    if (post) {
      await app.api.editMessageText(dir.channelId, post.messageId, text, options);
      await app.db.update(channelPosts).set({ lastText: text, updatedAt: now() }).where(eq(channelPosts.id, post.id));
      return;
    }
    // Пустой пост «рейсов нет» заранее не создаём.
    if ((await tripsOfDay(directionId, day)).length === 0) return;
    const msg = await app.api.sendMessage(dir.channelId, text, options);
    await app.db
      .insert(channelPosts)
      .values({ directionId, day, messageId: msg.message_id, lastText: text })
      .onConflictDoUpdate({
        target: [channelPosts.directionId, channelPosts.day],
        set: { messageId: msg.message_id, lastText: text, updatedAt: now() },
      });
  } catch (e) {
    if (e instanceof GrammyError && /message is not modified/i.test(e.description)) return;
    // Канал не должен ломать основную работу: бот мог быть не добавлен в админы канала.
    log.error({ err: e, directionId, day }, 'Не удалось обновить пост в канале');
  }
}
