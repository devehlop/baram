import { log } from '../logger.js';

/**
 * Клиент MAX Bot API (https://dev.max.ru/docs-api). Токен идёт в заголовке Authorization.
 *
 * id пользователей, чатов и сообщений в MAX — 64-битные числа: в JavaScript они могут не влезть
 * в number без потери точности. Поэтому такие поля при разборе ответа превращаются в строки.
 */

export const MAX_API_ROOT = 'https://platform-api2.max.ru';

export class MaxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`MAX ${status} ${code}: ${message}`);
  }
}

export interface MaxClientOptions {
  token: string;
  apiRoot?: string;
  /** Подмена сети в тестах. */
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

const BIG_FIELDS = /"(user_id|chat_id|contact_id|marker|photo_id)"\s*:\s*(-?\d+)/g;

/** JSON с 64-битными id: числа в этих полях становятся строками до разбора. */
export function parseMaxJson(text: string): unknown {
  return JSON.parse(text.replace(BIG_FIELDS, '"$1":"$2"'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MaxClient {
  readonly token: string;
  readonly apiRoot: string;
  readonly fetch: typeof fetch;

  constructor(opts: MaxClientOptions) {
    this.token = opts.token;
    this.apiRoot = (opts.apiRoot || MAX_API_ROOT).replace(/\/+$/, '');
    this.fetch = opts.fetch ?? fetch;
  }

  async call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, query: Query = {}, body?: unknown): Promise<T> {
    const url = new URL(this.apiRoot + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        method,
        headers: { Authorization: this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? parseMaxJson(raw) : {};
      } catch {
        data = { message: raw.slice(0, 200) };
      }
      const failed = !res.ok || data?.success === false;
      if (!failed) return data as T;
      const code = String(data?.code ?? res.status);
      // Слишком часто (не больше 2 сообщений в секунду в чат) или фото ещё обрабатывается — подождать и повторить.
      if (res.status === 429 && attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (code === 'attachment.not.ready' && attempt < 5) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new MaxError(res.status, code, String(data?.message ?? raw).slice(0, 300));
    }
  }

  /** Загрузить картинку в MAX. Возвращает токен для вложения { type: 'image', payload: { token } }. */
  async uploadImage(bytes: Uint8Array, type = 'image/jpeg'): Promise<string> {
    const { url } = await this.call<{ url: string }>('POST', '/uploads', { type: 'image' });
    const form = new FormData();
    form.append('data', new Blob([bytes], { type }), type === 'image/png' ? 'photo.png' : 'photo.jpg');
    const res = await this.fetch(url, { method: 'POST', body: form });
    const raw = await res.text();
    if (!res.ok) throw new MaxError(res.status, 'upload.failed', raw.slice(0, 200));
    const data = JSON.parse(raw) as { photos?: Record<string, { token?: string }>; token?: string };
    const token = data.token ?? Object.values(data.photos ?? {})[0]?.token;
    if (!token) {
      log.warn({ raw: raw.slice(0, 200) }, 'MAX: в ответе загрузки нет токена');
      throw new MaxError(res.status, 'upload.no_token', 'нет токена картинки');
    }
    return token;
  }
}
