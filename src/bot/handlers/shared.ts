import type { InlineKeyboard } from 'grammy';
import { t } from '../../i18n.js';
import { getDriver, type DriverView } from '../../services/drivers.js';
import type { MyContext } from '../context.js';
import { answerCb, edit, send } from '../tg.js';

/** Показать экран: по нажатию кнопки — заменить текущее сообщение, иначе отправить новое. */
export async function show(ctx: MyContext, text: string, markup?: InlineKeyboard): Promise<void> {
  const cq = ctx.callbackQuery;
  if (cq) {
    await answerCb(cq.id);
    if (cq.message && (await edit(cq.message.chat.id, cq.message.message_id, text, markup))) return;
  }
  await send(ctx.chat!.id, text, markup);
}

/** Короткий ответ на нажатие (всплывающая подсказка). */
export async function toast(ctx: MyContext, text: string, alert = false): Promise<void> {
  if (ctx.callbackQuery) await answerCb(ctx.callbackQuery.id, text, alert);
  else await send(ctx.chat!.id, text);
}

/** Число из регулярного выражения обработчика: ctx.match[n]. */
export function num(ctx: MyContext, i = 1): number {
  return Number((ctx.match as RegExpMatchArray)[i]);
}

/** Водитель с одобренной анкетой или сообщение, почему нельзя. */
export async function requireDriver(ctx: MyContext): Promise<DriverView | null> {
  const d = await getDriver(ctx.user!.id);
  if (!d) {
    await toast(ctx, t('only-drivers'), true);
    return null;
  }
  return d;
}
