export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Приводит номер к виду +7XXXXXXXXXX. Возвращает null, если это не похоже на телефон. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10 && d.startsWith('9')) d = '7' + d;
  if (d.length < 11 || d.length > 15) return null;
  return '+' + d;
}

/** +79171234567 → +7 917 123-45-67 */
export function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

export function money(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function cut(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const LATIN_TO_CYR: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
};

/** Госномер: «а123вс 116» → «А123ВС116». Возвращает null, если формат не российский. */
export function normalizePlate(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[A-Z]/g, (ch) => LATIN_TO_CYR[ch] ?? ch);
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(s) ? s : null;
}

/** Ссылка «Навигатор» на Яндекс Карты: по координатам или по тексту адреса. */
export function mapsUrl(place: { city: string; address: string; lat?: number | null; lon?: number | null }): string {
  if (place.lat != null && place.lon != null) {
    return `https://yandex.ru/maps/?pt=${place.lon},${place.lat}&z=17&l=map`;
  }
  return `https://yandex.ru/maps/?text=${encodeURIComponent(`${place.city}, ${place.address}`)}`;
}

/** Делит «ТЦ Мега, Горки; Автовокзал» на список. */
export function splitList(raw: string, max: number): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}
