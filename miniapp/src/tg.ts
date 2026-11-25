// Тонкая обёртка над мессенджером, в котором открыто приложение: Telegram (telegram-web-app.js)
// или MAX (max-web-app.js, объект window.WebApp). Вне мессенджера всё тихо отключается.

interface BackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface Haptic {
  impactOccurred(style: 'light' | 'medium'): unknown;
  notificationOccurred(type: 'success' | 'error'): unknown;
}

interface TelegramApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  openTelegramLink?(url: string): void;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  BackButton?: BackButton;
  HapticFeedback?: Haptic;
}

/** MAX Bridge (https://dev.max.ru/docs/webapps/bridge/): закрытия приложения и цвета шапки в нём нет. */
interface MaxApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  openMaxLink?(url: string): void;
  BackButton?: BackButton;
  HapticFeedback?: Haptic;
}

const MAX_BRIDGE = 'https://st.max.ru/js/max-web-app.js';

const telegram = (window as unknown as { Telegram?: { WebApp?: TelegramApp } }).Telegram?.WebApp;
const maxApp = (): MaxApp | undefined => (window as unknown as { WebApp?: MaxApp }).WebApp;

/**
 * Данные запуска MAX приходят в адресе после «#»: #WebAppData=…&WebAppPlatform=…&WebAppVersion=….
 * Запоминаем их при загрузке: по ним и видно, что приложение открыто в MAX (у Telegram ключ tgWebAppData).
 */
const maxLaunch = new URLSearchParams(window.location.hash.slice(1)).get('WebAppData');

export type Platform = 'tg' | 'max' | 'web';

export const platform: Platform = maxLaunch ? 'max' : telegram?.initData ? 'tg' : 'web';

/** Объект Telegram — только если приложение открыто в Telegram. */
export const tg: TelegramApp | undefined = platform === 'tg' ? telegram : undefined;

function maxInitData(): string {
  return maxApp()?.initData || maxLaunch || '';
}

/** Заголовок с подписанными данными запуска: сервер проверяет его на каждом запросе. */
export function authHeader(): Record<string, string> {
  if (platform === 'tg' && tg?.initData) return { authorization: `tma ${tg.initData}` };
  if (platform === 'max') {
    const data = maxInitData();
    if (data) return { authorization: `max ${data}` };
  }
  return {};
}

/** В MAX подключаем его скрипт: «Назад», вибрация и переход в чат. Без него приложение тоже работает. */
export function loadBridge(): Promise<void> {
  if (platform !== 'max' || maxApp()) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = MAX_BRIDGE;
    s.async = true;
    const done = () => resolve();
    s.onload = done;
    s.onerror = done;
    // Медленная сеть не должна держать пустой экран.
    setTimeout(done, 3000);
    document.head.appendChild(s);
  });
}

const CANVAS = '#F6EFE2';

/** Светлая палитра фиксирована (DESIGN.md §8): шапка, фон и нижняя панель — в цвет холста. */
export function initTelegram(): void {
  if (!tg) return;
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Старые версии Telegram не знают часть методов — это не ошибка.
    }
  };
  safe(() => tg.ready());
  safe(() => tg.expand());
  safe(() => tg.setHeaderColor?.(CANVAS));
  safe(() => tg.setBackgroundColor?.(CANVAS));
  safe(() => tg.setBottomBarColor?.(CANVAS));
}

/** Системная кнопка «Назад» мессенджера. */
export function backButton(): BackButton | undefined {
  return platform === 'max' ? maxApp()?.BackButton : tg?.BackButton;
}

export function haptic(kind: 'tap' | 'success' | 'error' = 'tap'): void {
  const h = platform === 'max' ? maxApp()?.HapticFeedback : tg?.HapticFeedback;
  try {
    // В MAX методы возвращают промис: на компьютере и в вебе вибрации нет, и он отклоняется.
    const r = kind === 'tap' ? h?.impactOccurred('light') : h?.notificationOccurred(kind);
    if (r instanceof Promise) r.catch(() => {});
  } catch {
    // не поддерживается — не страшно
  }
}

/** Имя бота в текущем мессенджере: приходит с сервера в /api/me. */
let botName: string | null = null;

export function setBotUsername(name: string | null | undefined): void {
  botName = name ?? null;
}

/** Вернуться в чат с ботом (регистрация и заявки водителя живут там). */
export function closeToBot(): void {
  // В MAX закрыть приложение нельзя — открываем чат с ботом.
  if (platform === 'max') return openBot(botName);
  try {
    tg?.close();
  } catch {
    // вне Telegram закрывать нечего
  }
}

function startParam(): string | undefined {
  if (platform === 'max') {
    return maxApp()?.initDataUnsafe?.start_param ?? new URLSearchParams(maxInitData()).get('start_param') ?? undefined;
  }
  return tg?.initDataUnsafe?.start_param;
}

/**
 * С какого экрана открыть приложение. Кнопка «Открыть в приложении» на доске в чате передаёт
 * ?screen=board&route=1-a&day=2026-11-10, а ссылка t.me/<бот>?startapp=board (в MAX — кнопка
 * с параметром запуска) — параметр запуска «board».
 */
export function startScreen(): { screen: string; route?: string; day?: string } | null {
  const q = new URLSearchParams(window.location.search);
  const screen = q.get('screen');
  if (screen) return { screen, route: q.get('route') ?? undefined, day: q.get('day') ?? undefined };
  const param = startParam();
  if (!param) return null;
  // board или board_1-a_2026-11-10 (в параметре запуска допустимы только буквы, цифры, _ и -).
  const [name, route, day] = param.split('_');
  return { screen: name!, route, day };
}

/** Открыть чат с ботом сразу на нужном экране (ссылка t.me/<бот>?start=… или max.ru/<бот>?start=…). */
export function openBot(botUsername: string | null | undefined, start?: string): void {
  if (platform === 'max') {
    if (!botUsername) return;
    const url = `https://max.ru/${botUsername}${start ? `?start=${start}` : ''}`;
    try {
      const open = maxApp()?.openMaxLink;
      if (open) return void open.call(maxApp(), url);
    } catch {
      // старый MAX — откроем ссылкой
    }
    window.location.href = url;
    return;
  }
  if (!botUsername) return closeToBot();
  const url = `https://t.me/${botUsername}${start ? `?start=${start}` : ''}`;
  try {
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
      tg.close();
      return;
    }
  } catch {
    // старый Telegram — просто закроем приложение
  }
  window.location.href = url;
}
