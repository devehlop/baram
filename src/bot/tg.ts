import { GrammyError, InlineKeyboard, type Keyboard } from 'grammy';
import { app } from '../app.js';
import { log } from '../logger.js';
import { getUser } from '../services/users.js';

export type Markup = InlineKeyboard | Keyboard | { remove_keyboard: true };

export interface Btn {
  text: string;
  data?: string;
  url?: string;
}

/** Собирает инлайн-клавиатуру из рядов кнопок. */
export function kb(rows: (Btn | null | undefined | false)[][]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const row of rows) {
    const items = row.filter((b): b is Btn => !!b);
    if (items.length === 0) continue;
    for (const b of items) {
      if (b.url) k.url(b.text, b.url);
      else k.text(b.text, b.data ?? 'noop');
    }
    k.row();
  }
  return k;
}

function ignorable(e: unknown): boolean {
  if (!(e instanceof GrammyError)) return false;
  // Пользователь остановил бота, чат не найден, сообщение не изменилось или слишком старое.
  return (
    e.error_code === 403 ||
    /chat not found|message is not modified|message to edit not found|message can't be edited|query is too old|message to delete not found/i.test(
      e.description,
    )
  );
}

/** Отправить сообщение. Не бросает ошибок: если человек заблокировал бота, вернёт null. */
export async function send(chatId: number, text: string, markup?: Markup): Promise<number | null> {
  try {
    const m = await app.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
    return m.message_id;
  } catch (e) {
    if (!ignorable(e)) log.error({ err: e, chatId }, 'Не удалось отправить сообщение');
    return null;
  }
}

export async function edit(chatId: number, messageId: number, text: string, markup?: InlineKeyboard): Promise<boolean> {
  try {
    await app.api.editMessageText(chatId, messageId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
    return true;
  } catch (e) {
    if (!ignorable(e)) log.warn({ err: e, chatId }, 'Не удалось изменить сообщение');
    return false;
  }
}

export async function clearKeyboard(chatId: number, messageId: number): Promise<void> {
  try {
    await app.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: undefined });
  } catch (e) {
    if (!ignorable(e)) log.warn({ err: e, chatId }, 'Не удалось убрать кнопки');
  }
}

export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  try {
    await app.api.deleteMessage(chatId, messageId);
  } catch (e) {
    if (!ignorable(e)) log.warn({ err: e, chatId }, 'Не удалось удалить сообщение');
  }
}

export async function answerCb(id: string, text?: string, alert = false): Promise<void> {
  try {
    await app.api.answerCallbackQuery(id, text ? { text, show_alert: alert } : undefined);
  } catch (e) {
    if (!ignorable(e)) log.warn({ err: e }, 'Не удалось ответить на нажатие');
  }
}

export async function sendPhotos(chatId: number, fileIds: string[], caption?: string): Promise<void> {
  if (fileIds.length === 0) return;
  try {
    if (fileIds.length === 1) {
      await app.api.sendPhoto(chatId, fileIds[0]!, { caption });
    } else {
      await app.api.sendMediaGroup(
        chatId,
        fileIds.slice(0, 10).map((id, i) => ({ type: 'photo' as const, media: id, caption: i === 0 ? caption : undefined })),
      );
    }
  } catch (e) {
    if (!ignorable(e)) log.error({ err: e, chatId }, 'Не удалось отправить фото');
  }
}

/** Уведомление пользователю по его id в базе. */
export async function notifyUser(userId: number | null | undefined, text: string, markup?: Markup): Promise<void> {
  if (!userId) return;
  const user = await getUser(userId);
  if (!user || user.restriction === 'blocked') return;
  await send(user.telegramId, text, markup);
}

export async function notifyAdmins(text: string, markup?: Markup): Promise<void> {
  for (const id of app.adminIds) await send(id, text, markup);
}
