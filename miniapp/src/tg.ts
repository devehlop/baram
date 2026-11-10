// Тонкая обёртка над Telegram Mini Apps SDK (telegram-web-app.js). Вне Telegram всё тихо отключается.

interface BackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface WebApp {
  initData: string;
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
