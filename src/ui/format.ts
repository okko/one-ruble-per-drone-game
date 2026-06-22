/**
 * Tiny display formatters shared by the shell scenes (Highscores list, Game Over). PURE + clock-free:
 * `shortDate` just slices the stored ISO string (no `Date` parsing → no timezone/locale drift), and
 * `groupThousands` formats without `toLocaleString` so output is identical across environments.
 */

/** Seconds → `m:ss` (e.g. 125 → "2:05"). */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Integer → grouped with thousands commas (e.g. 12500 → "12,500"). */
export function groupThousands(n: number): string {
  const neg = n < 0;
  const digits = Math.abs(Math.trunc(n)).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return neg ? `-${out}` : out;
}

/** ISO timestamp → `YYYY-MM-DD` (string slice; never re-parses through a clock). */
export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}
