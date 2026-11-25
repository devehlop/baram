import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Update } from 'grammy/types';
import { app } from '../app.js';
import { log } from '../logger.js';
import { rememberMaxImage, MAX_REF } from './files.js';
import { localIdOf } from './ids.js';
import { numOf, phantomNum } from './messages.js';

/**
 * Обновления MAX превращаются в обновления Telegram и уходят в того же бота (bot.handleUpdate).
 * Так сценарии, кнопки и админка одни на обе платформы.
 *
 * - Новое сообщение → message (текст, контакт, фото, геопозиция).
 * - Нажатие инлайн-кнопки → callback_query с id «max:<callback_id>».
 * - Нажатие кнопки, заменяющей большую кнопку меню, → message с её подписью (как в Telegram).
 * - «Начать» в новом диалоге (bot_started) → message «/start <метка>».
 */

/** Кнопка с этим началом payload заменяет обычную кнопку клавиатуры Telegram: нажатие = отправка подписи. */
export const TEXT_BUTTON = 'kb!';

export interface MaxUser {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  is_bot?: boolean;
  name?: string | null;
}

interface MaxAttachment {
  type: string;
  payload?: any;
  latitude?: number;
  longitude?: number;
}

export interface MaxMessage {
  sender?: MaxUser;
  recipient: { chat_id?: string | null; chat_type: string; user_id?: string | null };
  timestamp: number;
  body?: { mid: string; text?: string | null; attachments?: MaxAttachment[] | null } | null;
}

export type MaxUpdate =
  | { update_type: 'message_created'; timestamp: number; message: MaxMessage }
  | {
      update_type: 'message_callback';
      timestamp: number;
      callback: { callback_id: string; payload?: string | null; user: MaxUser; timestamp?: number };
      message?: MaxMessage | null;
    }
  | { update_type: 'bot_started'; timestamp: number; chat_id?: string; user: MaxUser; payload?: string | null }
  | { update_type: string; timestamp?: number };

let updateId = 1;

async function person(u: MaxUser) {
  const id = await localIdOf(String(u.user_id));
  const first = u.first_name || u.name || 'MAX';
  const from = { id, is_bot: false, first_name: first, last_name: u.last_name ?? undefined, username: u.username ?? undefined };
  const chat = { id, type: 'private' as const, first_name: first, last_name: u.last_name ?? undefined, username: u.username ?? undefined };
  return { from, chat };
}

function commandEntities(text: string) {
  return text.startsWith('/') ? [{ type: 'bot_command' as const, offset: 0, length: text.split(/\s/)[0]!.length }] : undefined;
}

/** Строки vCard: MAX иногда присылает переводы строк экранированными. */
function vcardLines(vcf: string): string[] {
  return vcf.replace(/\\r\\n|\\n/g, '\n').split(/\r?\n/);
}

function vcardField(vcf: string, name: string): string | undefined {
  const line = vcardLines(vcf).find((l) => l.toUpperCase().startsWith(name + ':') || l.toUpperCase().startsWith(name + ';'));
  return line?.slice(line.indexOf(':') + 1).trim() || undefined;
}

/**
 * Подпись контакта: MAX подписывает vcf_info токеном бота. Если подпись есть и не сходится —
 * контакт подделан, своим номером его не считаем.
 */
function signedOk(vcf: string, hash: string | null | undefined): boolean {
  if (!hash || !app.max) return true;
  const variants = [vcf, vcf.replace(/\\r\\n/g, '\r\n')];
  for (const v of variants) {
    const mac = createHmac('sha256', app.max.token).update(v).digest();
    for (const given of [Buffer.from(hash, 'hex'), Buffer.from(hash, 'base64')]) {
      if (given.length === mac.length && timingSafeEqual(given, mac)) return true;
    }
  }
  return false;
}

async function contactOf(payload: any, senderId: string) {
  const vcf = String(payload?.vcf_info ?? '');
  const phone = vcardField(vcf, 'TEL') ?? '';
  const fn = vcardField(vcf, 'FN');
  const info = payload?.max_info as MaxUser | undefined;
  const own = info && String(info.user_id) === senderId && signedOk(vcf, payload?.hash);
  if (info && String(info.user_id) === senderId && !own) log.warn('MAX: подпись контакта не сошлась');
  return {
    phone_number: phone,
    first_name: info?.first_name || fn || '',
    last_name: info?.last_name ?? undefined,
    user_id: own ? await localIdOf(senderId) : undefined,
  };
}

/** Обновление MAX в виде обновления Telegram. null — боту это не нужно (группы, каналы, служебное). */
export async function toTelegramUpdate(u: MaxUpdate): Promise<Update | null> {
  const update_id = updateId++;
  const date = Math.floor((u.timestamp ?? Date.now()) / 1000);

  if (u.update_type === 'message_created' && 'message' in u) {
    const m = u.message;
    if (m.recipient?.chat_type !== 'dialog' || !m.sender || m.sender.is_bot || !m.body) return null;
    const { from, chat } = await person(m.sender);
    const message: Record<string, unknown> = { message_id: numOf(m.body.mid, true), date, chat, from };
    const text = m.body.text?.trim();
    if (text) Object.assign(message, { text, entities: commandEntities(text) });
    for (const a of m.body.attachments ?? []) {
      if (a.type === 'contact') message.contact = await contactOf(a.payload, String(m.sender.user_id));
      if (a.type === 'image' && a.payload?.token) {
        rememberMaxImage(a.payload.token, a.payload.url);
        const ref = MAX_REF + a.payload.token;
        message.photo = [{ file_id: ref, file_unique_id: String(a.payload.photo_id ?? a.payload.token), width: 0, height: 0 }];
      }
      if (a.type === 'location') {
        const lat = a.latitude ?? a.payload?.latitude;
        const lon = a.longitude ?? a.payload?.longitude;
        if (typeof lat === 'number' && typeof lon === 'number') message.location = { latitude: lat, longitude: lon };
      }
    }
    return { update_id, message } as unknown as Update;
  }

  if (u.update_type === 'message_callback' && 'callback' in u) {
    const cb = u.callback;
    const { from, chat } = await person(cb.user);
    const data = cb.payload ?? '';
    if (data.startsWith(TEXT_BUTTON)) {
      const text = data.slice(TEXT_BUTTON.length);
      return { update_id, message: { message_id: phantomNum(), date, chat, from, text, entities: commandEntities(text) } } as unknown as Update;
    }
    const mid = u.message?.body?.mid;
    const message = mid ? { message_id: numOf(mid, false), date, chat, text: u.message?.body?.text ?? '' } : undefined;
    return { update_id, callback_query: { id: `max:${cb.callback_id}`, from, chat_instance: 'max', data, message } } as unknown as Update;
  }

  if (u.update_type === 'bot_started' && 'user' in u) {
    const { from, chat } = await person(u.user);
    const text = u.payload ? `/start ${u.payload}` : '/start';
    return { update_id, message: { message_id: phantomNum(), date, chat, from, text, entities: commandEntities(text) } } as unknown as Update;
  }

  return null;
}
