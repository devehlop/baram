import { FluentBundle, FluentNumber, FluentResource, type FluentVariable } from '@fluent/bundle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

/**
 * Тексты бота лежат в locales/<язык>.ftl, в коде текста нет.
 * Чтобы добавить татарский — положить рядом tt.ftl и передавать язык в t().
 */
const bundles = new Map<string, FluentBundle>();

function load(lang: string): FluentBundle {
  const cached = bundles.get(lang);
  if (cached) return cached;
  const file = join(process.cwd(), 'locales', `${lang}.ftl`);
  const bundle = new FluentBundle(lang, { useIsolating: false });
  const errors = bundle.addResource(new FluentResource(readFileSync(file, 'utf8')));
  for (const e of errors) log.error({ err: e, lang }, 'Ошибка в файле текстов');
  bundles.set(lang, bundle);
  return bundle;
}

let strict = false;

/** В тестах: отсутствующий текст или подстановка — ошибка, а не запись в лог. */
export function setStrictTexts(on: boolean): void {
  strict = on;
}

export type TArgs = Record<string, string | number | null | undefined>;

export function t(key: string, args?: TArgs, lang = 'ru'): string {
  const bundle = load(lang);
  const msg = bundle.getMessage(key);
  if (!msg?.value) {
    if (strict) throw new Error(`Нет текста для ключа ${key}`);
    log.error({ key }, 'Нет текста для ключа');
    return key;
  }
  const vars: Record<string, FluentVariable> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    // Числа без разделителей разрядов: «2019», а не «2 019». Склонения при этом работают.
    vars[k] = typeof v === 'number' ? new FluentNumber(v, { useGrouping: false }) : (v ?? '');
  }
  const errors: Error[] = [];
  const out = bundle.formatPattern(msg.value, vars, errors);
  if (errors.length && strict) throw new Error(`Ошибка подстановки в тексте ${key}: ${errors[0]!.message}`);
  if (errors.length) log.error({ key, errors: errors.map((e) => e.message) }, 'Ошибка подстановки в тексте');
  return out;
}

export function hasText(key: string, lang = 'ru'): boolean {
  return load(lang).hasMessage(key);
}
