import type { InlineKeyboard } from 'grammy';
import { t } from '../../i18n.js';
import { getDriver, type DriverView } from '../../services/drivers.js';
import type { MyContext } from '../context.js';
import { answerCb, dropScreen, edit, isReceipt, send, setScreen } from '../tg.js';

/**
 * Показать экран. По нажатию кнопки — заменить сообщение с этой кнопкой.
 * Из меню — прислать новое, а прошлый открытый экран убрать: в чате остаётся одно «окно».
 */
export async function show(ctx: MyContext, text: string, markup?: InlineKeyboard): Promise<void> {
  const chatId = ctx.chat!.id;
  const cq = ctx.callbackQuery;
  if (cq) {
    await answerCb(cq.id);
    // Квитанцию не трогаем: новый экран открывается отдельным сообщением.
    const msg = cq.message && !isReceipt(chatId, cq.message.message_id) ? cq.message : null;
    if (msg && (await edit(chatId, msg.message_id, text, markup))) return;
  }
  await dropScreen(chatId);
  setScreen(chatId, await send(chatId, text, markup));
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
