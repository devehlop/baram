import { pino } from 'pino';

/** Поля ошибок базы, где могут оказаться значения из запроса: телефоны, имена, Telegram ID. */
const SENSITIVE = ['params', 'query', 'detail', 'where', 'parameters'];

/** Ошибка без значений запроса: тип, текст и стек остаются, телефоны и имена в лог не попадают. */
function scrub(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.includes(k)) continue;
    out[k] = k === 'cause' ? scrub(v, depth + 1) : v;
  }
  return out;
}

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: (err: unknown) => scrub(pino.stdSerializers.err(err as Error)),
  },
});
