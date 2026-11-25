import { createHash } from 'node:crypto';
import type { Bot } from 'grammy';
import type { MyContext } from '../bot/context.js';
import { log } from '../logger.js';
import type { MaxClient } from './client.js';
import { toTelegramUpdate, type MaxUpdate } from './incoming.js';

/** Какие обновления MAX нужны боту. */
export const MAX_UPDATE_TYPES = ['message_created', 'message_callback', 'bot_started'];

/**
 * Обновления одного человека обрабатываются строго по очереди, как при long polling в Telegram:
 * сценарий (плагин conversations) не должен получить два ответа одновременно.
 */
export class MaxReceiver {
  private chains = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(
    private readonly bot: Bot<MyContext>,
    private readonly client: MaxClient,
  ) {}

  /** Секрет вебхука: MAX присылает его в заголовке X-Max-Bot-Api-Secret. Выводится из токена, отдельно хранить не нужно. */
  get secret(): string {
    return createHash('sha256').update(`baram-max-webhook:${this.client.token}`).digest('hex');
  }

  /** Принять обновление. Промис завершается, когда бот его обработал. */
  push(raw: MaxUpdate): Promise<void> {
    const key = String((raw as any).callback?.user?.user_id ?? (raw as any).message?.sender?.user_id ?? (raw as any).user?.user_id ?? '');
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(async () => {
      try {
        const update = await toTelegramUpdate(raw);
        if (update) await this.bot.handleUpdate(update);
      } catch (err) {
        log.error({ err, type: raw.update_type }, 'MAX: ошибка при обработке обновления');
      }
    });
    this.chains.set(key, run);
    void run.then(() => {
      if (this.chains.get(key) === run) this.chains.delete(key);
    });
    return run;
  }

  /** Вебхук: MAX сам присылает обновления на https-адрес. Так работает бот на сервере. */
  async subscribe(url: string): Promise<void> {
    await this.client.call('POST', '/subscriptions', {}, { url, update_types: MAX_UPDATE_TYPES, secret: this.secret });
    log.info({ url }, 'MAX: вебхук подключён');
  }

  /**
   * Long polling — для разработки на своём компьютере, без домена. MAX предупреждает, что для
   * работающего бота это не годится: нужен вебхук. Одновременно вебхук и long polling не работают,
   * поэтому старые подписки снимаем.
   */
  async poll(): Promise<void> {
    const subs = await this.client.call<{ subscriptions?: { url: string }[] }>('GET', '/subscriptions');
    for (const s of subs.subscriptions ?? []) await this.client.call('DELETE', '/subscriptions', { url: s.url });
    log.warn('MAX: обновления через long polling — только для разработки; на сервере задайте MAX_WEBHOOK_URL');
    let marker: string | undefined;
    while (!this.stopped) {
      try {
        const res = await this.client.call<{ updates: MaxUpdate[]; marker?: string | null }>('GET', '/updates', {
          timeout: 30,
          marker,
          types: MAX_UPDATE_TYPES.join(','),
        });
        if (res.marker !== undefined && res.marker !== null) marker = String(res.marker);
        for (const u of res.updates ?? []) void this.push(u);
      } catch (err) {
        if (this.stopped) break;
        log.warn({ err }, 'MAX: не удалось получить обновления, повтор через 5 с');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
