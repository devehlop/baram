import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Bot } from 'grammy';
import { initApp } from '../src/app.js';
import { createBot } from '../src/bot/bot.js';
import type { MyContext } from '../src/bot/context.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { setStrictTexts } from '../src/i18n.js';
import { setNow, setZone } from '../src/lib/time.js';

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SentMessage {
  chatId: number;
  messageId: number;
  text: string;
  inline: InlineButton[][];
  reply: string[][] | null;
  removedKeyboard: boolean;
  photos: number;
}

/** Подмена Telegram: вместо сети запоминает всё, что бот отправил. */
export class FakeTelegram {
  messages: SentMessage[] = [];
  answers: { id: string; text?: string }[] = [];
  private nextId = 1000;

  fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = String(url).split('/').pop()!;
    const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : {};
    return new Response(JSON.stringify({ ok: true, result: this.handle(method, payload) }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  private parseMarkup(rm: unknown): Pick<SentMessage, 'inline' | 'reply' | 'removedKeyboard'> {
    const m = typeof rm === 'string' ? JSON.parse(rm) : (rm ?? {});
    return {
      inline: m.inline_keyboard ?? [],
      reply: m.keyboard ? m.keyboard.map((row: any[]) => row.map((b) => (typeof b === 'string' ? b : b.text))) : null,
      removedKeyboard: !!m.remove_keyboard,
    };
  }

  private handle(method: string, p: Record<string, any>): unknown {
    const chat = { id: Number(p.chat_id), type: Number(p.chat_id) < 0 || typeof p.chat_id === 'string' ? 'channel' : 'private' };
    const date = Math.floor(Date.now() / 1000);
    switch (method) {
      case 'sendMessage': {
        const messageId = this.nextId++;
        this.messages.push({ chatId: chat.id || 0, messageId, text: p.text, photos: 0, ...this.parseMarkup(p.reply_markup) });
        if (Number.isNaN(chat.id)) this.messages[this.messages.length - 1]!.chatId = -1;
        return { message_id: messageId, date, chat, text: p.text };
      }
      case 'sendPhoto': {
        const messageId = this.nextId++;
        this.messages.push({ chatId: chat.id, messageId, text: p.caption ?? '', photos: 1, inline: [], reply: null, removedKeyboard: false });
        return { message_id: messageId, date, chat };
      }
      case 'sendMediaGroup': {
        const media = typeof p.media === 'string' ? JSON.parse(p.media) : p.media;
        const messageId = this.nextId++;
        this.messages.push({ chatId: chat.id, messageId, text: '', photos: media.length, inline: [], reply: null, removedKeyboard: false });
        return media.map((_: unknown, i: number) => ({ message_id: messageId + i, date, chat }));
      }
      case 'editMessageText': {
        const msg = this.messages.find((m) => m.messageId === p.message_id);
        if (msg) {
          msg.text = p.text;
          msg.inline = this.parseMarkup(p.reply_markup).inline;
        }
        return { message_id: p.message_id, date, chat, text: p.text };
      }
      case 'editMessageReplyMarkup': {
        const msg = this.messages.find((m) => m.messageId === p.message_id);
        if (msg) msg.inline = this.parseMarkup(p.reply_markup).inline;
        return { message_id: p.message_id, date, chat };
      }
      case 'deleteMessage': {
        this.messages = this.messages.filter((m) => m.messageId !== p.message_id);
        return true;
      }
      case 'answerCallbackQuery':
        this.answers.push({ id: p.callback_query_id, text: p.text });
        return true;
      default:
        return true;
    }
  }

  of(chatId: number): SentMessage[] {
    return this.messages.filter((m) => m.chatId === chatId);
  }
}

let updateId = 1;
let userMessageId = 1;

/** Человек в тесте: пишет боту, нажимает кнопки, читает ответы. */
export class TestUser {
  private mark = 0;

  constructor(
    private readonly h: Harness,
    readonly id: number,
    readonly firstName = 'Тест',
  ) {}

  private get from() {
    return { id: this.id, is_bot: false, first_name: this.firstName };
  }

  private get chat() {
    return { id: this.id, type: 'private' as const, first_name: this.firstName };
  }

  private async message(extra: Record<string, unknown>): Promise<void> {
    this.mark = this.h.tg.messages.length;
    await this.h.bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: userMessageId++, date: Math.floor(Date.now() / 1000), chat: this.chat, from: this.from, ...extra },
    } as any);
  }

  async text(text: string): Promise<void> {
    const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : undefined;
    await this.message({ text, entities });
  }

  /** Отправить контакт. По умолчанию — свой (кнопка «Поделиться номером»). */
  async contact(phone: string, opts: { own?: boolean; name?: string } = {}): Promise<void> {
    await this.message({
      contact: { phone_number: phone, first_name: opts.name ?? this.firstName, user_id: opts.own === false ? undefined : this.id },
    });
  }

  async photo(fileId = `photo-${userMessageId}`): Promise<void> {
    await this.message({ photo: [{ file_id: fileId + '-s', file_unique_id: 'u', width: 90, height: 90 }, { file_id: fileId, file_unique_id: 'u2', width: 800, height: 600 }] });
  }

  async location(lat: number, lon: number): Promise<void> {
    await this.message({ location: { latitude: lat, longitude: lon } });
  }

  /** Нажать инлайн-кнопку по подписи (ищется в последних сообщениях бота этому человеку). */
  async press(label: string): Promise<void> {
    const msgs = this.h.tg.of(this.id);
    // Сначала точное совпадение подписи, потом — по вхождению. Ищем от последних сообщений к старым.
    for (const match of [(x: string) => x === label, (x: string) => x.includes(label)]) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const btn = msgs[i]!.inline.flat().find((b) => b.callback_data && match(b.text));
        if (btn) return this.pressData(btn.callback_data!, msgs[i]!.messageId);
      }
    }
    throw new Error(`Кнопка «${label}» не найдена. Есть: ${this.buttons().join(' | ')}\nПоследнее сообщение: ${this.last()}`);
  }

  async pressData(data: string, messageId?: number): Promise<void> {
    const msgs = this.h.tg.of(this.id);
    const id = messageId ?? msgs[msgs.length - 1]?.messageId ?? 1;
    this.mark = this.h.tg.messages.length;
    await this.h.bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: String(updateId),
        from: this.from,
        chat_instance: 'x',
        data,
        message: { message_id: id, date: 0, chat: this.chat, text: '' },
      },
    } as any);
  }

  /** Текст последнего сообщения бота этому человеку. */
  last(): string {
    const msgs = this.h.tg.of(this.id);
    return msgs[msgs.length - 1]?.text ?? '';
  }

  /** Все сообщения бота этому человеку после его последнего действия. */
  fresh(): string {
    return this.h.tg.messages
      .slice(this.mark)
      .filter((m) => m.chatId === this.id)
      .map((m) => m.text)
      .join('\n---\n');
  }

  /** Всё, что бот когда-либо писал этому человеку. */
  all(): string {
    return this.h.tg.of(this.id).map((m) => m.text).join('\n---\n');
  }

  /** Инлайн-кнопки последнего сообщения с кнопками. */
  buttons(): string[] {
    const msgs = this.h.tg.of(this.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.inline.length) return msgs[i]!.inline.flat().map((b) => b.text);
    }
    return [];
  }

  /** Большие кнопки меню внизу экрана. */
  menu(): string[] {
    const msgs = this.h.tg.of(this.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.reply) return msgs[i]!.reply!.flat();
      if (msgs[i]!.removedKeyboard) return [];
    }
    return [];
  }
}

export interface Harness {
  bot: Bot<MyContext>;
  tg: FakeTelegram;
  db: Db;
  user(id: number, name?: string): TestUser;
  close(): Promise<void>;
}

export const ADMIN_ID = 9001;

/** Чистая база в памяти + бот с подменённым Telegram. */
export async function setup(opts: { adminIds?: number[]; now?: string } = {}): Promise<Harness> {
  setStrictTexts(true);
  setZone('Europe/Moscow');
  setNow(opts.now ? () => new Date(opts.now!) : null);
  // По умолчанию — встроенная база в памяти. С TEST_DATABASE_URL тесты идут на настоящем PostgreSQL.
  let db: Db;
  let closeDb: () => Promise<void>;
  if (process.env.TEST_DATABASE_URL) {
    const real = createDb(process.env.TEST_DATABASE_URL);
    await real.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await runMigrations(process.env.TEST_DATABASE_URL);
    db = real.db;
    closeDb = () => real.pool.end();
  } else {
    const pg = new PGlite();
    db = drizzle(pg, { schema }) as unknown as Db;
    await migrate(drizzle(pg), { migrationsFolder: 'drizzle' });
    closeDb = () => pg.close();
  }
  const tg = new FakeTelegram();
  const bot = createBot('1:TEST', { fetch: tg.fetch });
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Барам',
    username: 'baram_test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as any;
  initApp({ db, api: bot.api, adminIds: opts.adminIds ?? [ADMIN_ID], botUsername: 'baram_test_bot' });
  await seed();
  const h: Harness = {
    bot,
    tg,
    db,
    user: (id, name) => new TestUser(h, id, name),
    close: async () => {
      setNow(null);
      await closeDb();
    },
  };
  return h;
}

/** Передвинуть «сейчас» (для проверки напоминаний и сроков). */
export function setClock(iso: string): void {
  setNow(() => new Date(iso));
}

import { createUser, getUserByTg } from '../src/services/users.js';
import { setDriverStatus, submitDriverForm } from '../src/services/drivers.js';
import { publishTrip } from '../src/bot/actions.js';
import { fromDayMinutes, todayKey, addDays } from '../src/lib/time.js';

/** Готовый пассажир (без прохождения регистрации кнопками). */
export async function passenger(h: Harness, id: number, name: string, phone: string): Promise<TestUser> {
  await createUser({ telegramId: id, name, phone, role: 'passenger' });
  return h.user(id, name);
}

/** Готовый проверенный водитель. */
export async function approvedDriver(h: Harness, id: number, name: string, phone: string, extra: Partial<{ seats: number; childSeat: boolean; plate: string }> = {}): Promise<TestUser> {
  const u = await createUser({ telegramId: id, name, phone, role: 'driver' });
  await submitDriverForm(u.id, {
    fullName: `Галиев ${name} Ринатович`,
    car: 'Lada Largus',
    carYear: 2019,
    carColor: 'Белый',
    plate: extra.plate ?? 'А123ВС116',
    seats: extra.seats ?? 4,
    childSeat: extra.childSeat ?? false,
    carPhotos: ['car1', 'car2'],
    payPhone: phone,
    payBank: 'Сбербанк',
  });
  await setDriverStatus(u.id, 'approved', null);
  return h.user(id, name);
}

export async function dbId(telegramId: number): Promise<number> {
  return (await getUserByTg(telegramId))!.id;
}

/** Рейс напрямую через действие (как если бы водитель прошёл сценарий). dayOffset: 0 — сегодня. */
export async function postTrip(telegramId: number, opts: Partial<{ fromSide: 'a' | 'b'; dayOffset: number; time: string; seats: number; price: number; villages: boolean; pickupMode: 'door' | 'points' | 'mixed'; pickupPoints: string[] }> = {}) {
  const [hh, mm] = (opts.time ?? '17:00').split(':').map(Number);
  const res = await publishTrip({
    driverId: await dbId(telegramId),
    directionId: 1,
    fromSide: opts.fromSide ?? 'a',
    departsAt: fromDayMinutes(addDays(todayKey(), opts.dayOffset ?? 0), hh! * 60 + mm!),
    pickupMode: opts.pickupMode ?? 'door',
    pickupPoints: opts.pickupPoints ?? [],
    villages: opts.villages ?? false,
    villagesNote: null,
    seats: opts.seats ?? 3,
    trunk: 'free',
    price: opts.price ?? 500,
  });
  if (!('trip' in res) || !res.trip) throw new Error(`Рейс не создан: ${JSON.stringify(res)}`);
  return res.trip;
}
