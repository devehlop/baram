import type { Context } from 'grammy';
import { Keyboard, type InlineKeyboard } from 'grammy';
import { normalizePhone } from '../lib/format.js';
import { t } from '../i18n.js';
import { onMax } from './platform.js';
import type { MyConversation } from './context.js';
import {
  answerCb,
  deleteMessage,
  dropScreen,
  edit,
  isLastInChat,
  kb,
  markReceipt,
  removeIncoming,
  screenOf,
  send,
  sendPhotos,
  setScreen,
  type Btn,
  type Markup,
} from './tg.js';

/** Кнопка варианта ответа. data — короткий код, без префикса. */
export interface Opt {
  text: string;
  data: string;
  style?: Btn['style'];
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

/** Как человек ответил на прошлый вопрос: от этого зависит, где обновлять окно. */
type Via = 'start' | 'button' | 'message';

/**
 * Обёртка над сценарием: задаёт вопрос, ждёт ответ кнопкой или сообщением,
 * добавляет «Назад» и «В начало».
 *
 * Весь сценарий идёт в одном «окне» — одном сообщении бота, которое меняется от шага к шагу.
 * Нажал кнопку — окно обновляется на месте. Написал текст или прислал геопозицию — сообщение
 * человека убираем, а окно обновляем (или присылаем заново внизу, если между ними что-то пришло).
 *
 * Плагин conversations при каждом новом сообщении проигрывает функцию сценария заново,
 * поэтому всё, что ходит в базу или в Telegram, идёт через ext(): результат запоминается
 * и при повторном проигрывании не выполняется второй раз.
 */
export class Wizard {
  /** id окна; null — окна ещё нет. Меняется только из результатов ext(), чтобы совпадать при повторном проигрывании. */
  private panel: number | null = null;
  private via: Via = 'start';
  /** Пояснение (say), которое показывается над следующим вопросом. */
  private notice: string | null = null;

  constructor(
    public readonly conv: MyConversation,
    public readonly chatId: number,
    /** Сообщение, кнопкой в котором запустили сценарий: если это открытый экран, окно займёт его место. */
    private readonly entryMessageId?: number,
  ) {}

  /** Выполнить один раз и запомнить результат. Результат должен быть простыми данными (без Date). */
  async ext<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.conv.external(async () => {
      const v = await fn();
      return (v === undefined ? null : JSON.parse(JSON.stringify(v))) as T;
    });
  }

  /** Показать текст в окне. Вызывать только внутри ext(). */
  private async paint(text: string, markup?: InlineKeyboard): Promise<number | null> {
    const chat = this.chatId;
    const id = this.panel ?? (this.entryMessageId && screenOf(chat) === this.entryMessageId ? this.entryMessageId : null);
    if (id) {
      // После нажатия кнопки человек смотрит на окно — меняем его на месте, где бы оно ни было.
      const inPlace = this.via === 'button' || (this.via === 'start' && id === this.entryMessageId) || isLastInChat(chat, id);
      if (inPlace && (await edit(chat, id, text, markup))) {
        setScreen(chat, id);
        return id;
      }
      await deleteMessage(chat, id);
    } else {
      // Новый сценарий: прошлый открытый экран больше не нужен.
      await dropScreen(chat);
    }
    const fresh = await send(chat, text, markup);
    setScreen(chat, fresh);
    return fresh;
  }

  private withNotice(text: string): string {
    const n = this.notice;
    this.notice = null;
    return n ? `${n}\n\n${text}` : text;
  }

  /**
   * Пояснение по ходу сценария. Оно сразу видно в окне и остаётся над следующим вопросом.
   * С клавиатурой (например, убрать кнопку «Поделиться номером») — отдельным сообщением.
   */
  async say(text: string, markup?: Markup): Promise<void> {
    if (markup) {
      await this.ext(async () => {
        await send(this.chatId, text, markup);
      });
      return;
    }
    this.notice = this.notice ? `${this.notice}\n\n${text}` : text;
    const notice = this.notice;
    this.panel = await this.ext(() => this.paint(notice));
  }

  /**
   * Фото отдельными сообщениями. Окно убирается и следующим вопросом приходит заново под фото —
   * чтобы отвечать, не листая чат вверх.
   */
  async photos(fileIds: string[], caption?: string): Promise<void> {
    await this.ext(async () => {
      const id = this.panel;
      if (id) {
        await deleteMessage(this.chatId, id);
        if (screenOf(this.chatId) === id) setScreen(this.chatId, null);
      }
      await sendPhotos(this.chatId, fileIds, caption);
    });
    this.panel = null;
  }

  /**
   * Итог сценария (бронь, заявка): показывается в окне и остаётся в чате.
   * Это уже не экран, а «квитанция» — переход в другой раздел её не удалит.
   */
  async finish(text: string, markup?: InlineKeyboard): Promise<void> {
    const body = this.withNotice(text);
    await this.ext(async () => {
      const id = await this.paint(body, markup);
      if (id && screenOf(this.chatId) === id) setScreen(this.chatId, null);
      if (id) markReceipt(this.chatId, id);
    });
    this.panel = null;
  }

  async ask(o: AskOptions): Promise<Answer> {
    const rows: Opt[][] = [...(o.rows ?? [])];
    const nav: Opt[] = [];
    if (o.back !== false) nav.push({ text: t('btn-back'), data: 'back' });
    if (o.home !== false) nav.push({ text: t('btn-home'), data: 'home' });
    if (nav.length) rows.push(nav);
    const labels = new Map<string, string>();
    for (const row of rows) for (const b of row) labels.set(b.data, b.text);

    const text = this.withNotice(o.text);
    const inline = rows.length
      ? kb(rows.map((r) => r.map((b) => ({ text: b.text, data: PREFIX + b.data, style: b.style }))))
      : undefined;

    let msgId: number | null;
    if (o.shareContactButton) {
      // Кнопку «Поделиться номером» можно показать только в новом сообщении.
      const markup = new Keyboard().requestContact(o.shareContactButton).resized().oneTime();
      msgId = await this.ext(async () => {
        await dropScreen(this.chatId, this.panel ?? undefined);
        if (this.panel) await deleteMessage(this.chatId, this.panel);
        return send(this.chatId, text, markup);
      });
      this.panel = null;
    } else {
      msgId = await this.ext(() => this.paint(text, inline));
      this.panel = msgId;
    }

    /** Подсказка, если ответили не так: в том же окне, под вопросом. */
    const warn = async (hint: string, incoming?: number) => {
      await this.ext(async () => {
        if (incoming) await removeIncoming(this.chatId, incoming);
        if (msgId) await edit(this.chatId, msgId, `${text}\n\n⚠️ ${hint}`, inline);
        else await send(this.chatId, hint);
      });
      await this.conv.skip();
    };

    for (;;) {
      const c: Context = await this.conv.wait();
      const cq = c.callbackQuery;
      if (cq) {
        const data = cq.data ?? '';
        // Чужие кнопки (меню, уведомления) не трогаем: их обработает бот, сценарий остаётся на месте.
        if (!data.startsWith(PREFIX)) await this.conv.skip({ next: true });
        const key = data.slice(PREFIX.length);
        if (cq.message?.message_id !== msgId || !labels.has(key)) {
          await this.ext(() => answerCb(cq.id, t(onMax(this.chatId) ? 'stale-button-max' : 'stale-button')));
          await this.conv.skip();
        }
        await this.ext(() => answerCb(cq.id));
        this.via = 'button';
        if (key === 'back') return { kind: 'back' };
        if (key === 'home') return { kind: 'home' };
        return { kind: 'btn', data: key };
      }

      const m = c.message;
      if (!m) await this.conv.skip({ next: true });
      const incoming = m!.message_id;
      const chosen = async <A extends Answer>(a: A, remove: boolean): Promise<A> => {
        this.via = 'message';
        if (remove) await this.ext(() => removeIncoming(this.chatId, incoming));
        return a;
      };
      if (m?.contact && (o.acceptContact || o.shareContactButton)) {
        const phone = normalizePhone(m.contact.phone_number);
        const own = m.contact.user_id === c.from?.id;
        if (phone && (own || !o.shareContactButton)) {
          const name = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ');
          return chosen({ kind: 'contact', phone, name, own }, false);
        }
      }
      if (m?.photo?.length && o.acceptPhoto) {
        // Фото оставляем в чате: человеку видно, что он уже прислал.
        return chosen({ kind: 'photo', fileId: m.photo[m.photo.length - 1]!.file_id }, false);
      }
      if (m?.location && o.acceptLocation) {
        return chosen({ kind: 'location', lat: m.location.latitude, lon: m.location.longitude }, true);
      }
      if (m?.text && o.acceptText && !m.text.startsWith('/')) {
        const value = m.text.replace(/\s+/g, ' ').trim();
        const problem = o.validate?.(value) ?? null;
        if (problem) await warn(problem, incoming);
        return chosen({ kind: 'text', text: value }, true);
      }
      await warn(o.hint ?? t('hint-use-buttons'), m?.text ? incoming : undefined);
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
