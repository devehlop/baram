import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { visitors } from '../src/db/schema.js';
import { setClock, setup, type Harness } from './helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

async function visitor(tg: number) {
  const [row] = await h.db.select().from(visitors).where(eq(visitors.telegramId, tg));
  return row;
}

describe('кто нажал «Старт»', () => {
  it('первое сообщение записывается до регистрации, метка источника — с первого раза и навсегда', async () => {
    const u = h.user(101);
    await u.text('/start s_Aigul');
    expect(u.last()).not.toContain('Найти поездку'); // ещё не зарегистрирован
    const first = await visitor(101);
    expect(first).toMatchObject({ source: 'aigul', firstSeenAt: new Date(NOW), lastSeenAt: new Date(NOW) });

    setClock('2026-11-11T06:00:00Z');
    await u.text('/start s_other');
    const again = await visitor(101);
    expect(again!.source).toBe('aigul');
    expect(again!.firstSeenAt).toEqual(new Date(NOW));
    expect(again!.lastSeenAt).toEqual(new Date('2026-11-11T06:00:00Z'));
  });
});
