/**
 * Zeitdarstellung in Feldspur.
 *
 * Alle Uhrzeiten auf der Zeitachse sind „Ortszeit des Einsatzes“: die Wanduhrzeit
 * am Ort, ohne Zeitzone. Intern als Millisekunden gespeichert, so gelesen, als wäre
 * die Ortszeit UTC (`LocalMs`). Damit bleibt die Rechnung innerhalb eines Feldtags
 * einfache Addition, auch über eine Sommerzeit-Umstellung hinweg wird nichts
 * verschoben, was das Gerät angezeigt hat.
 */

/** Wanduhrzeit am Einsatzort in ms, gelesen als UTC. */
export type LocalMs = number;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?$/;

export function localMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): LocalMs {
  return Date.UTC(year, month - 1, day, hour, minute, second, ms);
}

/** Prüft, ob die Felder ein echtes Datum ergeben (kein 31. Februar). */
export function isValidLocal(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const d = new Date(localMs(year, month, day, hour, minute, second));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** "2026-09-14T10:15:00" oder "2026-09-14 10:15:00.250" → LocalMs. */
export function parseLocal(text: string): LocalMs {
  const m = LOCAL_RE.exec(text.trim());
  if (!m) throw new Error(`Keine Ortszeit: "${text}"`);
  const [y, mo, d, h, mi, s = "0", frac = "0"] = m.slice(1) as string[];
  const parts = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  if (!isValidLocal(...parts)) throw new Error(`Ungültige Ortszeit: "${text}"`);
  return localMs(...parts, Number(frac.padEnd(3, "0")));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** LocalMs → "2026-09-14T10:15:00" (mit `.sss`, wenn nötig oder gewünscht). */
export function formatLocal(t: LocalMs, opts: { ms?: boolean } = {}): string {
  const d = new Date(t);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const ms = d.getUTCMilliseconds();
  return opts.ms || ms ? `${base}.${pad(ms, 3)}` : base;
}

/** LocalMs → "10:15:00". */
export function formatClock(t: LocalMs): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Dauer in ms → "−2:47" / "+0:04" / "1:02:03". */
export function formatDuration(ms: number, opts: { sign?: boolean } = {}): string {
  const sign = ms < 0 ? "−" : opts.sign ? "+" : "";
  let s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return h ? `${sign}${h}:${pad(m)}:${pad(s)}` : `${sign}${m}:${pad(s)}`;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Echte UTC-Zeit → Wanduhrzeit in der Zeitzone (IANA, z. B. "Europe/Berlin"). */
export function utcToLocal(utcMs: number, timeZone: string): LocalMs {
  const p = Object.fromEntries(
    dtf(timeZone)
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  );
  const whole = localMs(+p.year!, +p.month!, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return whole + (((utcMs % 1000) + 1000) % 1000);
}

/** Wanduhrzeit in der Zeitzone → UTC. Bei doppelten Stunden gewinnt die frühere. */
export function localToUtc(t: LocalMs, timeZone: string): number {
  let guess = t;
  for (let i = 0; i < 3; i++) guess = t - (utcToLocal(guess, timeZone) - guess);
  return guess;
}
