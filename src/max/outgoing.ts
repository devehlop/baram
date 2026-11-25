import { InputFile, type Transformer } from 'grammy';
import { app } from '../app.js';
import { log } from '../logger.js';
import { getImage } from '../services/photos.js';
import { MaxError } from './client.js';
import { isMaxRef, maxImageToken } from './files.js';
import { isMaxId, maxUserIdOf } from './ids.js';
import { TEXT_BUTTON } from './incoming.js';
import { entryOf, noteContent, numOf } from './messages.js';

/**
 * Перехватчик вызовов Bot API. Бот всегда зовёт Telegram API (app.api.sendMessage и т. п.),
 * а здесь вызов для человека из MAX уходит в MAX и возвращается ответом в формате Telegram.
 * Ошибки MAX превращаются в ошибки Telegram с тем же смыслом: «сообщение не найдено»,
 * «бот заблокирован» — их src/bot/tg.ts уже умеет спокойно пропускать.
 *
 * Чего в MAX нет и как это заменено:
 * - Большие кнопки внизу экрана → инлайн-кнопки под сообщением; нажатие приходит боту текстом.
 * - Цвет кнопок → без цвета. Кнопки Mini App → пока не показываются.
 */

type Payload = Record<string, any>;
type TgResult = { ok: true; result: unknown } | { ok: false; error_code: number; description: string };

interface MaxButton {
  type: 'callback' | 'link' | 'request_contact';
  text: string;
  payload?: string;
  url?: string;
}

const fail = (error_code: number, description: string): TgResult => ({ ok: false, error_code, description });

/** Кнопки из reply_markup Telegram (инлайн или обычная клавиатура) в кнопки MAX. */
export function maxKeyboard(markup: any): { type: 'inline_keyboard'; payload: { buttons: MaxButton[][] } } | null {
  if (!markup || typeof markup !== 'object') return null;
  const rows: MaxButton[][] = [];
  const add = (row: MaxButton[]) => {
    // В ряду MAX не больше 7 кнопок, а со ссылками и «Поделиться номером» — не больше 3.
    const per = row.some((b) => b.type !== 'callback') ? 3 : 7;
    for (let i = 0; i < row.length; i += per) rows.push(row.slice(i, i + per));
  };
  for (const row of (markup.inline_keyboard ?? []) as any[][]) {
    const out: MaxButton[] = [];
    for (const b of row) {
      if (typeof b.callback_data === 'string') out.push({ type: 'callback', text: b.text, payload: b.callback_data });
      else if (typeof b.url === 'string') out.push({ type: 'link', text: b.text, url: b.url });
      // web_app (Mini App) и прочее в MAX пока не показываем.
    }
    if (out.length) add(out);
  }
  for (const row of (markup.keyboard ?? []) as any[][]) {
    const out: MaxButton[] = row.map((b) => {
      const text = typeof b === 'string' ? b : String(b.text);
      return typeof b === 'object' && b.request_contact
        ? { type: 'request_contact' as const, text }
        : { type: 'callback' as const, text, payload: TEXT_BUTTON + text };
    });
    if (out.length) add(out);
  }
  return rows.length ? { type: 'inline_keyboard', payload: { buttons: rows } } : null;
}

const format = (p: Payload): 'html' | undefined => (p.parse_mode === 'HTML' ? 'html' : undefined);

async function imageAttachment(ref: unknown): Promise<object | null> {
  if (typeof ref !== 'string') return null;
  const token = await maxImageToken(ref);
  return token ? { type: 'image', payload: { token } } : null;
}

/** Ответ Telegram на отправку: сообщение с нашим номером. */
function sentMessage(chatId: number, num: number, text?: string) {
  return { message_id: num, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: 'private' }, text };
}

async function post(chatId: number, body: { text?: string; format?: 'html'; attachments: object[] }, noPreview: boolean, sticky?: object) {
  const userId = await maxUserIdOf(chatId);
  if (!userId) return null;
  const res = await app.max!.call<{ message?: { body?: { mid?: string } } }>(
    'POST',
    '/messages',
    { user_id: userId, disable_link_preview: noPreview || undefined },
    body,
  );
  const mid = res.message?.body?.mid;
  if (!mid) throw new MaxError(500, 'no.mid', 'в ответе нет id сообщения');
  const num = numOf(mid, false);
  noteContent(num, { text: body.text, format: body.format, sticky });
  return num;
}

async function callMax(method: string, p: Payload): Promise<TgResult> {
  const chatId = Number(p.chat_id);
  switch (method) {
    case 'sendMessage': {
      const kb = maxKeyboard(p.reply_markup);
      const sticky = kb && p.reply_markup?.keyboard ? kb : undefined;
      const num = await post(chatId, { text: p.text, format: format(p), attachments: kb ? [kb] : [] }, !!p.link_preview_options?.is_disabled, sticky);
      return num ? { ok: true, result: sentMessage(chatId, num, p.text) } : fail(400, 'Bad Request: chat not found');
    }
    case 'editMessageText':
    case 'editMessageReplyMarkup': {
      const e = entryOf(Number(p.message_id));
      if (!e?.mid || e.incoming) return fail(400, 'Bad Request: message to edit not found');
      const kb = maxKeyboard(p.reply_markup) ?? e.sticky;
      const text = method === 'editMessageText' ? p.text : e.text;
      const fmt = method === 'editMessageText' ? format(p) : e.format;
      // Пустой список вложений убирает кнопки — как edit без reply_markup в Telegram.
      await app.max!.call('PUT', '/messages', { message_id: e.mid }, { text, format: fmt, attachments: kb ? [kb] : [] });
      noteContent(Number(p.message_id), { text, format: fmt });
      return { ok: true, result: true };
    }
    case 'deleteMessage': {
      const e = entryOf(Number(p.message_id));
      if (!e) return fail(400, 'Bad Request: message to delete not found');
      // Нажатие кнопки меню — сообщения в чате нет, удалять нечего.
      if (!e.mid) return { ok: true, result: true };
      // Сообщения человека бот в MAX удалить не может.
      if (e.incoming) return fail(400, "Bad Request: message can't be deleted");
      await app.max!.call('DELETE', '/messages', { message_id: e.mid });
      return { ok: true, result: true };
    }
    case 'answerCallbackQuery': {
      const callbackId = String(p.callback_query_id).slice('max:'.length);
      // Пустой ответ в MAX не нужен: кнопка не «крутится», как в Telegram.
      if (p.text) await app.max!.call('POST', '/answers', { callback_id: callbackId }, { notification: p.text });
      return { ok: true, result: true };
    }
    case 'sendPhoto': {
      const img = await imageAttachment(p.photo);
      if (!img) return fail(400, 'Bad Request: wrong file identifier');
      const num = await post(chatId, { text: p.caption ?? '', attachments: [img] }, true);
      return num ? { ok: true, result: sentMessage(chatId, num) } : fail(400, 'Bad Request: chat not found');
    }
    case 'sendMediaGroup': {
      const media = (p.media ?? []) as { media: unknown; caption?: string }[];
      const imgs = (await Promise.all(media.slice(0, 12).map((m) => imageAttachment(m.media)))).filter((x): x is object => !!x);
      if (!imgs.length) return fail(400, 'Bad Request: wrong file identifier');
      // В MAX несколько фото — одно сообщение.
      const num = await post(chatId, { text: media[0]?.caption ?? '', attachments: imgs }, true);
      return num ? { ok: true, result: [sentMessage(chatId, num)] } : fail(400, 'Bad Request: chat not found');
    }
    case 'getUserProfilePhotos':
      // Фото профиля MAX пока не показываем.
      return { ok: true, result: { total_count: 0, photos: [] } };
    default:
      log.warn({ method }, 'MAX: вызов не поддерживается, пропускаем');
      return { ok: true, result: true };
  }
}

/** Фото из MAX человеку в Telegram: Telegram не знает токен MAX, отправляем сам файл. */
async function telegramMedia(ref: unknown): Promise<unknown> {
  if (!isMaxRef(ref)) return ref;
  const img = await getImage(ref);
  return img ? new InputFile(img.bytes, 'photo.jpg') : ref;
}

export function maxRouter(): Transformer {
  return async (prev, method, payload, signal) => {
    const p = (payload ?? {}) as Payload;
    const target = method === 'getUserProfilePhotos' ? p.user_id : p.chat_id;
    const maxCallback = method === 'answerCallbackQuery' && String(p.callback_query_id).startsWith('max:');
    if (maxCallback || isMaxId(target)) {
      // Бот в MAX не подключён — для бота это как человек, остановивший бота.
      if (!app.max) return fail(403, 'Forbidden: MAX is not configured') as any;
      try {
        return (await callMax(method, p)) as any;
      } catch (e) {
        if (e instanceof MaxError) {
          const gone = e.status === 403 || /chat\.denied|blocked|not\.found/i.test(e.code);
          return fail(gone ? 403 : e.status || 400, `${gone ? 'Forbidden' : 'Bad Request'}: ${e.message}`) as any;
        }
        throw e;
      }
    }
    if (method === 'sendPhoto' && isMaxRef(p.photo)) {
      return prev(method, { ...p, photo: await telegramMedia(p.photo) } as any, signal);
    }
    if (method === 'sendMediaGroup' && Array.isArray(p.media) && p.media.some((m: any) => isMaxRef(m.media))) {
      const media = await Promise.all(p.media.map(async (m: any) => ({ ...m, media: await telegramMedia(m.media) })));
      return prev(method, { ...p, media } as any, signal);
    }
    return prev(method, payload, signal);
  };
}
