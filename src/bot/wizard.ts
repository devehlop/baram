import type { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { normalizePhone } from '../lib/format.js';
import { t } from '../i18n.js';
import type { MyConversation } from './context.js';
import { answerCb, clearKeyboard, edit, kb, send, type Markup } from './tg.js';

/** Кнопка варианта ответа. data — короткий код, без префикса. */
export interface Opt {
  text: string;
  data: string;
}

export interface AskOptions {
  text: string;
  /** Варианты — по одной кнопке в ряд (так крупнее и понятнее), если не задано иначе. */
  rows?: Opt[][];
  back?: boolean;
  home?: boolean;
  acceptText?: boolean;
  acceptContact?: boolean;
  acceptPhoto?: boolean;
  acceptLocation?: boolean;
  /** Показать большую кнопку «Поделиться номером» (только свой контакт). */
  shareContactButton?: string;
  /** Что ответить, если прислали не то. */
  hint?: string;
  /** Проверка набранного текста. Вернуть текст подсказки, если ввод не подходит. */
  validate?: (text: string) => string | null;
}

export type Answer =
  | { kind: 'btn'; data: string }
  | { kind: 'text'; text: string }
  | { kind: 'contact'; phone: string; name: string; own: boolean }
  | { kind: 'photo'; fileId: string }
  | { kind: 'location'; lat: number; lon: number }
  | { kind: 'back' }
  | { kind: 'home' };

const PREFIX = 'w:';

/**
 * Обёртка над сценарием: задаёт вопрос, ждёт ответ кнопкой или сообщением,
 * добавляет «Назад» и «В начало».
 *
 * Плагин conversations при каждом новом сообщении проигрывает функцию сценария заново,
 * поэтому всё, что ходит в базу или в Telegram, идёт через ext(): результат запоминается
 * и при повторном проигрывании не выполняется второй раз.
 */
export class Wizard {
  constructor(
    public readonly conv: MyConversation,
    public readonly chatId: number,
  ) {}

  /** Выполнить один раз и запомнить результат. Результат должен быть простыми данными (без Date). */
  async ext<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.conv.external(async () => {
      const v = await fn();
      return (v === undefined ? null : JSON.parse(JSON.stringify(v))) as T;
    });
  }

  async say(text: string, markup?: Markup): Promise<void> {
    await this.ext(async () => {
      await send(this.chatId, text, markup);
    });
  }

  async ask(o: AskOptions): Promise<Answer> {
    const rows: Opt[][] = [...(o.rows ?? [])];
    const nav: Opt[] = [];
    if (o.back !== false) nav.push({ text: t('btn-back'), data: 'back' });
    if (o.home !== false) nav.push({ text: t('btn-home'), data: 'home' });
    if (nav.length) rows.push(nav);
    const labels = new Map<string, string>();
    for (const row of rows) for (const b of row) labels.set(b.data, b.text);

    const markup: Markup | undefined = o.shareContactButton
      ? new Keyboard().requestContact(o.shareContactButton).resized().oneTime()
      : rows.length
        ? kb(rows.map((r) => r.map((b) => ({ text: b.text, data: PREFIX + b.data }))))
        : undefined;
    const hasInline = !o.shareContactButton && rows.length > 0;
    const msgId = await this.ext(() => send(this.chatId, o.text, markup));

    for (;;) {
      const c: Context = await this.conv.wait();
      const cq = c.callbackQuery;
      if (cq) {
        const data = cq.data ?? '';
        // Чужие кнопки (меню, уведомления) не трогаем: их обработает бот, сценарий остаётся на месте.
        if (!data.startsWith(PREFIX)) await this.conv.skip({ next: true });
        const key = data.slice(PREFIX.length);
        if (cq.message?.message_id !== msgId || !labels.has(key)) {
          await this.ext(() => answerCb(cq.id, t('stale-button')));
          await this.conv.skip();
        }
        await this.ext(async () => {
          await answerCb(cq.id);
          if (msgId) {
            const picked = key === 'back' || key === 'home' ? '' : `\n\n✅ <i>${labels.get(key)}</i>`;
            await edit(this.chatId, msgId, o.text + picked);
          }
        });
        if (key === 'back') return { kind: 'back' };
        if (key === 'home') return { kind: 'home' };
        return { kind: 'btn', data: key };
      }

      const m = c.message;
      if (!m) await this.conv.skip({ next: true });
      const done = async <A extends Answer>(a: A): Promise<A> => {
        if (hasInline && msgId) await this.ext(() => clearKeyboard(this.chatId, msgId));
        return a;
      };
      if (m?.contact && (o.acceptContact || o.shareContactButton)) {
        const phone = normalizePhone(m.contact.phone_number);
        const own = m.contact.user_id === c.from?.id;
        if (phone && (own || !o.shareContactButton)) {
          const name = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ');
          return done({ kind: 'contact', phone, name, own });
        }
      }
      if (m?.photo?.length && o.acceptPhoto) {
        return done({ kind: 'photo', fileId: m.photo[m.photo.length - 1]!.file_id });
      }
      if (m?.location && o.acceptLocation) {
        return done({ kind: 'location', lat: m.location.latitude, lon: m.location.longitude });
      }
      if (m?.text && o.acceptText && !m.text.startsWith('/')) {
        const text = m.text.replace(/\s+/g, ' ').trim();
        const problem = o.validate?.(text) ?? null;
        if (problem) {
          await this.ext(() => send(this.chatId, problem));
          await this.conv.skip();
        }
        return done({ kind: 'text', text });
      }
      await this.ext(() => send(this.chatId, o.hint ?? t('hint-use-buttons')));
      await this.conv.skip();
    }
  }
}

export type Outcome = 'next' | 'back' | 'home' | { goto: string; returnTo?: string };

export interface Step<S> {
  id: string;
  /** Шаг пропускается, если условие не выполнено (при переходе «Исправить» условие не проверяется). */
  when?: (s: S) => boolean;
  run: (w: Wizard, s: S) => Promise<Outcome>;
}

/**
 * Проходит шаги по порядку. «Назад» возвращает на предыдущий пройденный шаг,
 * «В начало» завершает сценарий. Переход { goto, returnTo } — это «Исправить»:
 * после исправленного шага возвращаемся сразу к итогу.
 */
export async function runSteps<S>(w: Wizard, steps: Step<S>[], s: S, startId?: string): Promise<'done' | 'home'> {
  const indexOf = (id: string) => {
    const i = steps.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`Нет шага ${id}`);
    return i;
  };
  const applicable = (i: number) => !steps[i]!.when || steps[i]!.when!(s);
  const nextFrom = (from: number) => {
    let j = from + 1;
    while (j < steps.length && !applicable(j)) j++;
    return j;
  };

  let i = startId ? indexOf(startId) : nextFrom(-1);
  const history: number[] = [];
  let returnTo: string | null = null;

  while (i < steps.length) {
    const out = await steps[i]!.run(w, s);
    if (out === 'home') return 'home';
    if (out === 'back') {
      const prev = history.pop();
      if (prev === undefined) return 'home';
      i = prev;
      returnTo = null;
      continue;
    }
    if (out === 'next') {
      history.push(i);
      if (returnTo) {
        i = indexOf(returnTo);
        returnTo = null;
      } else {
        i = nextFrom(i);
      }
    } else {
      const j = indexOf(out.goto);
      // Переход на самого себя — это повтор вопроса после ошибки ввода: в историю не пишем.
      if (j !== i) {
        history.push(i);
        returnTo = out.returnTo ?? null;
      }
      i = j;
    }
  }
  return 'done';
}

/** Один ряд — одна кнопка. */
export function column(opts: Opt[]): Opt[][] {
  return opts.map((o) => [o]);
}

/** Кнопки по n в ряд (для коротких подписей: дни, числа, время). */
export function grid(opts: Opt[], perRow: number): Opt[][] {
  const rows: Opt[][] = [];
  for (let i = 0; i < opts.length; i += perRow) rows.push(opts.slice(i, i + perRow));
  return rows;
}
