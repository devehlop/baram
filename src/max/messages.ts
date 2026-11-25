/**
 * Номера сообщений. В Telegram у сообщения номер — число, и бот сравнивает номера, чтобы понять,
 * какое сообщение в чате ниже (см. isLastInChat в src/bot/tg.ts). В MAX у сообщения строковый id
 * (mid), поэтому каждому сообщению выдаём число по порядку появления.
 *
 * Счёт начинается с текущего времени в миллисекундах: после перезапуска номера продолжают расти
 * и не совпадают со старыми. Соответствия держим в памяти, как и остальное «окно» бота: после
 * перезапуска кнопка под старым сообщением просто получит новый номер.
 */

interface Entry {
  /** id сообщения в MAX; null — такого сообщения в чате нет (нажатие кнопки меню, «Старт»). */
  mid: string | null;
  /** Сообщение человека: удалить его бот в MAX не может. */
  incoming: boolean;
  /** Текст и разметка, с которыми бот отправил сообщение: нужны, чтобы поменять только кнопки. */
  text?: string;
  format?: 'html';
  /**
   * Кнопки, заменяющие клавиатуру внизу экрана Telegram («Поделиться номером», меню).
   * В Telegram правка сообщения их не трогает, поэтому в MAX при правке без новых кнопок они остаются.
   */
  sticky?: object;
}

const LIMIT = 50_000;
let next = Date.now();
const byNum = new Map<number, Entry>();
const byMid = new Map<string, number>();

function add(entry: Entry): number {
  const num = next++;
  byNum.set(num, entry);
  if (entry.mid) byMid.set(entry.mid, num);
  if (byNum.size > LIMIT) {
    const [oldNum, old] = byNum.entries().next().value!;
    byNum.delete(oldNum);
    if (old.mid) byMid.delete(old.mid);
  }
  return num;
}

/** Номер для сообщения из MAX; новое сообщение получает следующий номер. */
export function numOf(mid: string, incoming: boolean): number {
  return byMid.get(mid) ?? add({ mid, incoming });
}

/** Номер для «сообщения», которого в чате нет: нажатие кнопки меню или «Старт» превращаются в текст. */
export function phantomNum(): number {
  return add({ mid: null, incoming: true });
}

export function entryOf(num: number): Entry | undefined {
  return byNum.get(num);
}

/** Запомнить, что сейчас в сообщении бота. */
export function noteContent(num: number, content: Pick<Entry, 'text' | 'format' | 'sticky'>): void {
  const e = byNum.get(num);
  if (e) Object.assign(e, content);
}
