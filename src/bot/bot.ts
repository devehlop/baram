import { autoRetry } from '@grammyjs/auto-retry';
import { conversations, createConversation } from '@grammyjs/conversations';
import { Bot, type ApiClientOptions } from 'grammy';
import { isAdminTg } from '../app.js';
import { t } from '../i18n.js';
import { log } from '../logger.js';
import { maxRouter } from '../max/outgoing.js';
import { noteVisit } from '../services/stats.js';
import { getUserByTg } from '../services/users.js';
import type { MyContext } from './context.js';
import { driverForm, driverPhotos } from './conversations/driverForm.js';
import { prompt } from './conversations/prompt.js';
import { registration } from './conversations/registration.js';
import { search } from './conversations/search.js';
import { tripCreate } from './conversations/tripCreate.js';
import { handlers } from './handlers/index.js';
import { conversationStorage } from './storage.js';
import { noteIncoming, removeIncoming, send } from './tg.js';
import { menuKeyOf } from './ui/menu.js';

export function createBot(token: string, client?: ApiClientOptions): Bot<MyContext> {
  const bot = new Bot<MyContext>(token, { client });
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 20 }));
  // Сообщения людям из MAX уходят в MAX: бот один, платформы две (src/max/outgoing.ts).
  bot.api.config.use(maxRouter());

  bot.catch(async (err) => {
    log.error({ err: err.error, update: err.ctx.update.update_id }, 'Ошибка при обработке сообщения');
    const chatId = err.ctx.chat?.id;
    if (chatId && err.ctx.chat?.type === 'private') await send(chatId, t('error-generic'));
  });

  // Бот работает только в личных чатах. В канале он лишь публикует сводный пост.
  const pm = bot.chatType('private');

  pm.use(async (ctx, next) => {
    // Запоминаем порядок сообщений в чате: по нему «окно» решает, обновиться на месте или прийти заново.
    if (ctx.message) noteIncoming(ctx.chat.id, ctx.message.message_id);
    ctx.isAdmin = isAdminTg(ctx.from?.id);
    // Для статистики: первое касание — это «нажал Старт». Идёт параллельно с загрузкой пользователя,
    // админов не считаем, сбой учёта не мешает человеку.
    const visit =
      ctx.from && !ctx.isAdmin
        ? noteVisit(ctx.from.id, ctx.message?.text).catch((err) => log.warn({ err }, 'Не удалось отметить визит'))
        : undefined;
    [ctx.user] = await Promise.all([ctx.from ? getUserByTg(ctx.from.id) : undefined, visit]);
    if (ctx.user?.restriction === 'blocked' && !ctx.isAdmin) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      await send(ctx.chat.id, t('blocked-message'), { remove_keyboard: true });
      return;
    }
    await next();
  });

  pm.use(conversations({ storage: { type: 'key', version: 1, adapter: conversationStorage } }));

  // Команда или кнопка главного меню всегда прерывает текущий сценарий: это «В начало».
  pm.use(async (ctx, next) => {
    const text = ctx.message?.text;
    const menu = menuKeyOf(text) !== undefined;
    const interrupts = text !== undefined && (text.startsWith('/') || menu);
    if (interrupts) await ctx.conversation.exitAll();
    // Нажатие большой кнопки меню приходит сообщением — убираем его, раздел откроется на месте прошлого экрана.
    if (menu && ctx.message) await removeIncoming(ctx.chat.id, ctx.message.message_id);
    await next();
  });

  pm.use(createConversation(registration, 'registration'));
  pm.use(createConversation(driverForm, 'driverForm'));
  pm.use(createConversation(driverPhotos, 'driverPhotos'));
  pm.use(createConversation(tripCreate, 'tripCreate'));
  pm.use(createConversation(search, 'search'));
  pm.use(createConversation(prompt, 'prompt'));

  pm.use(handlers);
  return bot;
}
