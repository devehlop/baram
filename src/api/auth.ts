import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface MaxUser {
  /** id в MAX — 64-битный, поэтому строкой. */
  id: string;
  first_name?: string;
  username?: string;
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function sign(check: string, botToken: string): Buffer {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(check).digest();
}

/**
 * Проверка подписи данных запуска Mini App. Telegram и MAX подписывают их одинаково,
 * каждый — токеном своего бота, поэтому подделать чужой id нельзя.
 * Возвращает поля без hash или null, если подпись неверна либо данные старше maxAgeSec.
 */
function checkSigned(initData: string, botToken: string, maxAgeSec: number, nowMs: number): URLSearchParams | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const expected = sign(dataCheckString(params), botToken);
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > maxAgeSec) return null;
  return params;
}

/** Данные запуска Mini App в Telegram. Возвращает пользователя или null. */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 24 * 3600,
  nowMs = Date.now(),
): TelegramUser | null {
  const params = checkSigned(initData, botToken, maxAgeSec, nowMs);
  if (!params) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TelegramUser | null;
    return user && Number.isSafeInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

/**
 * Данные запуска Mini App в MAX (window.WebApp.initData). Порядок проверки тот же, что в Telegram,
 * ключ — токен бота в MAX. MAX иногда отдаёт строку закодированной целиком («user%3D…%26hash%3D…») —
 * тогда раскодируем её один раз. Срок жизни — как у Telegram, сутки: человек может долго не закрывать приложение.
 */
export function verifyMaxInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600, nowMs = Date.now()): MaxUser | null {
  let raw = initData.trim();
  if (!raw.includes('=') && /%3D/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  const params = checkSigned(raw, botToken, maxAgeSec, nowMs);
  if (!params) return null;
  try {
    // id длиннее 2^53 при обычном разборе потерял бы точность: превращаем его в строку до JSON.parse.
    const json = (params.get('user') ?? 'null').replace(/"id"\s*:\s*(\d+)/, '"id":"$1"');
    const user = JSON.parse(json) as MaxUser | null;
    return user && /^\d+$/.test(String(user.id)) ? { ...user, id: String(user.id) } : null;
  } catch {
    return null;
  }
}

/**
 * Только для тестов и локального просмотра: собрать подписанные данные запуска.
 * user — объект или готовая JSON-строка (для id длиннее 2^53, как в MAX).
 */
export function signInitData(
  user: TelegramUser | Record<string, unknown> | string,
  botToken: string,
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams({ auth_date: String(authDate), user: typeof user === 'string' ? user : JSON.stringify(user) });
  params.set('hash', sign(dataCheckString(params), botToken).toString('hex'));
  return params.toString();
}
