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
