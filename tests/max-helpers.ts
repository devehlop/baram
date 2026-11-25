import { app } from '../src/app.js';
import { MaxClient } from '../src/max/client.js';
import { MaxReceiver } from '../src/max/receiver.js';
import type { MaxUpdate } from '../src/max/incoming.js';
import type { Harness } from './helpers.js';

export interface MaxButton {
  type: string;
  text: string;
  payload?: string;
  url?: string;
}

export interface MaxSent {
  userId: string;
  mid: string;
  /** Когда сообщение последний раз появилось или изменилось. */
  seq: number;
  text: string;
  format?: string;
  buttons: MaxButton[][];
  images: string[];
}

export const MAX_TOKEN = 'max-test-token';
export const MAX_BOT_ID = '1000000000000000001';

/** Подмена MAX Bot API: вместо сети запоминает всё, что бот отправил. */
export class FakeMax {
  messages: MaxSent[] = [];
  answers: { callbackId: string; notification?: string }[] = [];
  calls: string[] = [];
  seq = 0;
  private n = 0;

  fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    if (u.host === 'upload.fake') return json(`{"photos":{"a":{"token":"up-${++this.n}"}}}`);
    if (u.host === 'img.fake') return new Response(new TextEncoder().encode(`img:${u.pathname}`), { headers: { 'content-type': 'image/jpeg' } });
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== MAX_TOKEN) return json('{"code":"verify.token","message":"Invalid access_token"}', 401);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    this.calls.push(`${method} ${u.pathname}`);
    const q = u.searchParams;
    switch (`${method} ${u.pathname}`) {
      case 'GET /me':
        return json(`{"user_id":${MAX_BOT_ID},"username":"baram_max_bot","is_bot":true,"first_name":"Барам"}`);
      case 'POST /messages': {
        const mid = `mid.${++this.n}`;
        this.messages.push({ userId: q.get('user_id')!, mid, seq: ++this.seq, text: body.text ?? '', format: body.format, ...parts(body.attachments) });
        // id пользователя — 64-битное число без кавычек, как в настоящем ответе.
        return json(`{"message":{"recipient":{"chat_type":"dialog","user_id":${q.get('user_id')}},"body":{"mid":"${mid}","seq":1,"text":null}}}`);
      }
      case 'PUT /messages': {
        const m = this.messages.find((x) => x.mid === q.get('message_id'));
        if (!m) return json('{"code":"not.found","message":"Message not found"}', 404);
        if (body.text !== undefined) m.text = body.text;
        if (body.attachments !== undefined && body.attachments !== null) Object.assign(m, parts(body.attachments));
        m.seq = ++this.seq;
        return json('{"success":true}');
      }
      case 'DELETE /messages': {
        const before = this.messages.length;
        this.messages = this.messages.filter((x) => x.mid !== q.get('message_id'));
        return before === this.messages.length ? json('{"success":false,"message":"not found"}') : json('{"success":true}');
      }
      case 'POST /answers':
        this.answers.push({ callbackId: q.get('callback_id')!, notification: body.notification });
        return json('{"success":true}');
      case 'POST /uploads':
        return json('{"url":"https://upload.fake/u"}');
      default:
        return json('{"success":true}');
    }
  }) as typeof fetch;

  /** Сообщения бота человеку — в порядке, в котором они последний раз появлялись или менялись. */
  of(userId: string): MaxSent[] {
    return this.messages.filter((m) => m.userId === userId).sort((a, b) => a.seq - b.seq);
  }
}

function json(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

function parts(attachments: any[] | undefined): Pick<MaxSent, 'buttons' | 'images'> {
  const list = attachments ?? [];
  return {
    buttons: list.find((a) => a.type === 'inline_keyboard')?.payload.buttons ?? [],
    images: list.filter((a) => a.type === 'image').map((a) => a.payload.token),
  };
}

/** Человек в MAX: пишет боту, нажимает кнопки, читает ответы. */
export class MaxTestUser {
  private mark = 0;
  private n = 0;

  constructor(
    private readonly max: MaxHarness,
    readonly userId: string,
    readonly firstName = 'Тест',
  ) {}

  get sender() {
    return { user_id: this.userId, first_name: this.firstName, is_bot: false };
  }

  private async push(u: MaxUpdate): Promise<void> {
    this.mark = this.max.fake.seq;
    await this.max.receiver.push(u);
  }

  private async message(body: Record<string, unknown>): Promise<void> {
    await this.push({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: this.sender,
        recipient: { chat_id: '777', chat_type: 'dialog', user_id: MAX_BOT_ID },
        timestamp: Date.now(),
        body: { mid: `in.${this.userId}.${++this.n}`, ...body },
      },
    });
  }

  /** «Начать» в новом диалоге с ботом, в том числе по ссылке max.ru/<бот>?start=<метка>. */
  async start(payload?: string): Promise<void> {
    await this.push({ update_type: 'bot_started', timestamp: Date.now(), chat_id: '777', user: this.sender, payload });
  }

  async text(text: string): Promise<void> {
    await this.message({ text });
  }

  /** Контакт. По умолчанию — свой (кнопка «Поделиться номером»). */
  async contact(phone: string, opts: { own?: boolean } = {}): Promise<void> {
    const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${this.firstName}\r\nTEL;TYPE=cell:${phone}\r\nEND:VCARD`;
    const info = opts.own === false ? { user_id: '555', first_name: 'Другой' } : this.sender;
    await this.message({ text: '', attachments: [{ type: 'contact', payload: { vcf_info: vcf, max_info: info } }] });
  }

  async photo(token: string): Promise<void> {
    await this.message({ text: '', attachments: [{ type: 'image', payload: { photo_id: 1, token, url: `https://img.fake/${token}.jpg` } }] });
  }

  /** Нажать кнопку по подписи (ищется в последних сообщениях бота этому человеку). */
  async press(label: string): Promise<void> {
    const msgs = this.max.fake.of(this.userId);
    for (const match of [(x: string) => x === label, (x: string) => x.includes(label)]) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const btn = msgs[i]!.buttons.flat().find((b) => b.type === 'callback' && match(b.text));
        if (!btn) continue;
        return this.push({
          update_type: 'message_callback',
          timestamp: Date.now(),
          callback: { callback_id: `cb.${++this.n}`, payload: btn.payload, user: this.sender },
          message: {
            recipient: { chat_type: 'dialog', user_id: this.userId },
            timestamp: Date.now(),
            body: { mid: msgs[i]!.mid, text: msgs[i]!.text },
          },
        });
      }
    }
    throw new Error(`Кнопка «${label}» не найдена. Есть: ${this.buttons().join(' | ')}\nПоследнее сообщение: ${this.last()}`);
  }

  last(): string {
    const msgs = this.max.fake.of(this.userId);
    return msgs[msgs.length - 1]?.text ?? '';
  }

  fresh(): string {
    return this.max.fake
      .of(this.userId)
      .filter((m) => m.seq > this.mark)
      .map((m) => m.text)
      .join('\n---\n');
  }

  all(): string {
    return this.max.fake.of(this.userId).map((m) => m.text).join('\n---\n');
  }

  /** Кнопки последнего сообщения с кнопками. */
  buttons(): string[] {
    const msgs = this.max.fake.of(this.userId);
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.buttons.length) return msgs[i]!.buttons.flat().map((b) => b.text);
    return [];
  }

  /** Кнопки последнего сообщения с кнопками — целиком, с типом и payload. */
  rawButtons(): MaxButton[] {
    const msgs = this.max.fake.of(this.userId);
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.buttons.length) return msgs[i]!.buttons.flat();
    return [];
  }
}

export interface MaxHarness {
  fake: FakeMax;
  client: MaxClient;
  receiver: MaxReceiver;
  user(userId: string, name?: string): MaxTestUser;
}

/** Подключить к тестовому боту подменённый MAX. */
export function withMax(h: Harness): MaxHarness {
  const fake = new FakeMax();
  const client = new MaxClient({ token: MAX_TOKEN, apiRoot: 'https://max.fake', fetch: fake.fetch });
  app.max = client;
  app.maxBotUsername = 'baram_max_bot';
  const receiver = new MaxReceiver(h.bot, client);
  const mh: MaxHarness = { fake, client, receiver, user: (id, name) => new MaxTestUser(mh, id, name) };
  return mh;
}
