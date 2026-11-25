import { GrammyError, InlineKeyboard, type Keyboard } from 'grammy';
import { app } from '../app.js';
import { log } from '../logger.js';
import { getUser } from '../services/users.js';

export type Markup = InlineKeyboard | Keyboard | { remove_keyboard: true };

export interface Btn {
  text: string;
  data?: string;
  url?: string;
  /** Открыть Mini App по адресу. */
  webApp?: string;
  /** Цвет кнопки (Bot API 9.4): зелёная — главное действие, красная — отмена, синяя — выбранное. */
  style?: 'success' | 'danger' | 'primary';
}

/** Собирает инлайн-клавиатуру из рядов кнопок. */
export function kb(rows: (Btn | null | undefined | false)[][]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const row of rows) {
    const items = row.filter((b): b is Btn => !!b);
    if (items.length === 0) continue;
    for (const b of items) {
      if (b.webApp) k.webApp(b.text, b.webApp);
      else if (b.url) k.url(b.text, b.url);
      else k.text(b.text, b.data ?? 'noop');
      if (b.style) k.style(b.style);
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
    /chat not found|message is not modified|message to edit not found|message can't be edited|query is too old|message to delete not found|message can't be deleted/i.test(
      e.description,
    )
  );
}

/**
 * Последнее сообщение в каждом чате (бота или человека). По нему «окно» решает,
 * можно ли обновить себя на месте или оно уже уехало вверх и его надо прислать заново.
 * Хранится в памяти: после перезапуска бот просто пришлёт окно новым сообщением.
 */
const lastInChat = new Map<number, number>();

export function noteMessage(chatId: number, messageId: number): void {
  if (messageId > (lastInChat.get(chatId) ?? 0)) lastInChat.set(chatId, messageId);
}

/** Что было последним в чате до входящего сообщения человека: нужно, чтобы, удалив его ответ, вернуть «окно» на место. */
const lastBefore = new Map<string, number | undefined>();

/** Входящее сообщение человека. Вызывается до сценариев, для каждого сообщения в личном чате. */
export function noteIncoming(chatId: number, messageId: number): void {
  if (lastBefore.size > 5000) lastBefore.clear();
  lastBefore.set(`${chatId}:${messageId}`, lastInChat.get(chatId));
  noteMessage(chatId, messageId);
}

/**
 * Человек ответил текстом — его сообщение убираем, чтобы в чате осталось одно «окно».
 * Если до ответа окно было последним, оно снова последнее и его можно обновить на месте.
 */
export async function removeIncoming(chatId: number, messageId: number): Promise<void> {
  const key = `${chatId}:${messageId}`;
  const before = lastBefore.get(key);
  lastBefore.delete(key);
  // В MAX бот не может удалить сообщение человека: тогда оно остаётся последним, и окно придёт заново под ним.
  const removed = await deleteMessage(chatId, messageId);
  if (removed && lastInChat.get(chatId) === messageId && before !== undefined) lastInChat.set(chatId, before);
}

/** Сообщение — самое нижнее в чате: после него никто ничего не писал. */
export function isLastInChat(chatId: number, messageId: number): boolean {
  return lastInChat.get(chatId) === messageId;
}

/**
 * Экран, который сейчас открыт у человека (меню раздела или шаг сценария).
 * Открывая новый раздел, старый экран убираем — в чате остаётся одно «окно».
 */
const screens = new Map<number, number>();

export function setScreen(chatId: number, messageId: number | null): void {
  if (messageId) screens.set(chatId, messageId);
  else screens.delete(chatId);
}

export function screenOf(chatId: number): number | undefined {
  return screens.get(chatId);
}

/**
 * Квитанции — итог брони или заявки. Их кнопки открывают новый экран, а сама квитанция остаётся в чате.
 * В памяти: после перезапуска старые квитанции ведут себя как обычные сообщения.
 */
const receipts = new Set<string>();

export function markReceipt(chatId: number, messageId: number): void {
  if (receipts.size > 10_000) receipts.clear();
  receipts.add(`${chatId}:${messageId}`);
}

export function isReceipt(chatId: number, messageId: number): boolean {
  return receipts.has(`${chatId}:${messageId}`);
}

/** Убрать открытый экран, если он есть. Уведомления и итоговые карточки экранами не считаются и остаются. */
export async function dropScreen(chatId: number, except?: number): Promise<void> {
  const id = screens.get(chatId);
  if (!id || id === except) return;
  screens.delete(chatId);
  await deleteMessage(chatId, id);
}

/** Отправить сообщение. Не бросает ошибок: если человек заблокировал бота, вернёт null. */
export async function send(chatId: number, text: string, markup?: Markup): Promise<number | null> {
  try {
    const m = await app.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
    noteMessage(chatId, m.message_id);
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
    // Текст и кнопки уже такие же (нажали выбранную вкладку или «Обновить» без новостей) — сообщение на месте, всё хорошо.
    if (e instanceof GrammyError && /message is not modified/i.test(e.description)) return true;
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

/** Удалить сообщение. false — не получилось (уже удалено, слишком старое, чужое в MAX). */
export async function deleteMessage(chatId: number, messageId: number): Promise<boolean> {
  try {
    await app.api.deleteMessage(chatId, messageId);
    return true;
  } catch (e) {
    if (!ignorable(e)) log.warn({ err: e, chatId }, 'Не удалось удалить сообщение');
    return false;
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
      const m = await app.api.sendPhoto(chatId, fileIds[0]!, { caption });
      noteMessage(chatId, m.message_id);
    } else {
      const ms = await app.api.sendMediaGroup(
        chatId,
        fileIds.slice(0, 10).map((id, i) => ({ type: 'photo' as const, media: id, caption: i === 0 ? caption : undefined })),
      );
      for (const m of ms) noteMessage(chatId, m.message_id);
    }
  } catch (e) {
    if (!ignorable(e)) log.error({ err: e, chatId }, 'Не удалось отправить фото');
  }
}

/**
 * «Живые» уведомления: у каждой темы (например, статус одной брони) в чате одно сообщение.
 * Новое отправляется отдельным сообщением — чтобы пришёл звук и пуш, — а прошлое по той же теме удаляется.
 */
const slots = new Map<string, number>();

/** Уведомление пользователю по его id в базе. slot — тема «живого» уведомления, см. выше. */
export async function notifyUser(userId: number | null | undefined, text: string, markup?: Markup, slot?: string): Promise<void> {
  if (!userId) return;
  const user = await getUser(userId);
  if (!user || user.restriction === 'blocked') return;
  const id = await send(user.telegramId, text, markup);
  if (!slot || !id) return;
  const key = `${user.telegramId}:${slot}`;
  const prev = slots.get(key);
  slots.delete(key);
  slots.set(key, id);
  // Самые старые темы (давно закончившиеся поездки) забываем: их сообщения просто останутся в чате.
  if (slots.size > 10_000) slots.delete(slots.keys().next().value!);
  if (prev) await deleteMessage(user.telegramId, prev);
}

export async function notifyAdmins(text: string, markup?: Markup): Promise<void> {
  for (const id of app.adminIds) await send(id, text, markup);
}
