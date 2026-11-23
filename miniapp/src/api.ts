import { useEffect, useState } from 'react';
import { tg } from './tg';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

/** Запрос к API. Подпись Telegram (initData) уходит в заголовке — сервер проверяет её на каждом запросе. */
export async function api<T>(path: string, body?: unknown, method?: 'GET' | 'POST'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(tg?.initData ? { authorization: `tma ${tg.initData}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // пустой ответ
  }
  if (!res.ok) throw new ApiError((json as { error?: string } | null)?.error ?? 'server_error', res.status);
  return json as T;
}

/**
 * Картинки (фото машины, фото профиля) тоже требуют подписи, а <img src> заголовок не передаёт.
 * Поэтому качаем fetch-ем и показываем как blob:-ссылку. Одна картинка грузится один раз за сессию.
 */
const images = new Map<string, Promise<string | null>>();

export function loadImage(path: string): Promise<string | null> {
  let p = images.get(path);
  if (!p) {
    p = fetch(`/api${path}`, { headers: tg?.initData ? { authorization: `tma ${tg.initData}` } : {} })
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = await res.blob();
        return blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null;
      })
      .catch(() => null);
    images.set(path, p);
  }
  return p;
}

/** Адрес картинки для <img>, когда она загрузилась; до этого и при ошибке — null. */
export function useImage(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let alive = true;
    void loadImage(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
