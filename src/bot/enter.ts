import type { MyContext } from './context.js';

/** Начать сценарий, завершив предыдущий (одновременно идёт только один). */
export async function enter(ctx: MyContext, name: string, ...args: unknown[]): Promise<void> {
  await ctx.conversation.exitAll();
  await ctx.conversation.enter(name, ...args);
}
