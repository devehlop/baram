// Тонкая обёртка над Telegram Mini Apps SDK (telegram-web-app.js). Вне Telegram всё тихо отключается.

interface BackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface WebApp {
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
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium'): void; notificationOccurred(type: 'success' | 'error'): void };
}

export const tg: WebApp | undefined = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

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

export function haptic(kind: 'tap' | 'success' | 'error' = 'tap'): void {
  try {
    if (kind === 'tap') tg?.HapticFeedback?.impactOccurred('light');
    else tg?.HapticFeedback?.notificationOccurred(kind);
  } catch {
    // не поддерживается — не страшно
  }
}

/** Вернуться в чат с ботом (регистрация и заявки водителя живут там). */
export function closeToBot(): void {
  try {
    tg?.close();
  } catch {
    // вне Telegram закрывать нечего
  }
}

/**
 * С какого экрана открыть приложение. Кнопка «Открыть в приложении» на доске в чате передаёт
 * ?screen=board&route=1-a&day=2026-11-10, а ссылка t.me/<бот>?startapp=board — параметр запуска «board».
 */
export function startScreen(): { screen: string; route?: string; day?: string } | null {
  const q = new URLSearchParams(window.location.search);
  const screen = q.get('screen');
  if (screen) return { screen, route: q.get('route') ?? undefined, day: q.get('day') ?? undefined };
  const param = tg?.initDataUnsafe?.start_param;
  if (!param) return null;
  // board или board_1-a_2026-11-10 (в параметре запуска допустимы только буквы, цифры, _ и -).
  const [name, route, day] = param.split('_');
  return { screen: name!, route, day };
}

/** Открыть чат с ботом сразу на нужном экране (ссылка t.me/<бот>?start=…). */
export function openBot(botUsername: string | null | undefined, start?: string): void {
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
