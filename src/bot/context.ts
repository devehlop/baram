import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import type { UserRow } from '../db/schema.js';

export type MyContext = ConversationFlavor<Context> & {
  /** Зарегистрированный пользователь; undefined — ещё не проходил регистрацию. */
  user?: UserRow;
  isAdmin: boolean;
};

export type MyConversation = Conversation<MyContext, Context>;
