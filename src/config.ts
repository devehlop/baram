import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN не задан'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL не задан'),
  ADMIN_IDS: z.string().default(''),
  APP_TZ: z.string().default('Europe/Moscow'),
  LOG_LEVEL: z.string().default('info'),
  CHANNEL_ID: z.string().default(''),
});

export interface Config {
  botToken: string;
  databaseUrl: string;
  adminIds: number[];
  tz: string;
  logLevel: string;
  channelId: string;
}

export function parseAdminIds(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Проверьте файл .env — ${problems}`);
  }
  const e = parsed.data;
  return {
    botToken: e.BOT_TOKEN,
    databaseUrl: e.DATABASE_URL,
    adminIds: parseAdminIds(e.ADMIN_IDS),
    tz: e.APP_TZ,
    logLevel: e.LOG_LEVEL,
    channelId: e.CHANNEL_ID.trim(),
  };
}
