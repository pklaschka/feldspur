/**
 * Uhrzeiten aus Dateinamen lesen.
 *
 * Eingebaute Muster decken gängige Handys, Rekorder und Messenger ab. Pro Gerät
 * kann ein eigenes Muster mit Platzhaltern hinterlegt werden:
 * YYYY MM DD hh mm ss (z. B. "REC_YYYYMMDD_hhmm").
 */
import { isValidLocal, localMs, type LocalMs } from "./time.ts";

export interface FilenameTime {
  /** Mitte des möglichen Zeitraums. */
  localMs: LocalMs;
  /** ± halbe Auflösung: Sekunde → 500 ms, Minute → 30 s. */
  uncertaintyMs: number;
  /** Welcher Teil des Namens getroffen wurde. */
  matched: string;
  pattern: string;
}

type Groups = { Y: string; M: string; D: string; h: string; m: string; s?: string | undefined };

interface BuiltinPattern {
  name: string;
  re: RegExp;
}

// Reihenfolge = Priorität. Alle verlangen Datum und mindestens Stunde+Minute.
const BUILTIN: BuiltinPattern[] = [
  // IMG_20260914_104050, VID_20260914_103200, REC_20260914_1032, PXL_20260914_103215123
  {
    name: "YYYYMMDD_hhmm[ss]",
    re: /(?<!\d)(?<Y>20\d{2})(?<M>\d{2})(?<D>\d{2})[_-](?<h>\d{2})(?<m>\d{2})(?<s>\d{2})?(?:\d{3})?(?!\d)/,
  },
  // 2026-09-14 10.32.15, 2026-09-14_10-32-15, signal-2026-09-14-103215, Screenshot 2026-09-14 at 10.32.15
  {
    name: "YYYY-MM-DD hh.mm[.ss]",
    re: /(?<!\d)(?<Y>20\d{2})-(?<M>\d{2})-(?<D>\d{2})(?:[ _T-]|\sat\s|\sum\s)(?<h>\d{2})[.:\-h]?(?<m>\d{2})(?:[.:\-m]?(?<s>\d{2}))?(?!\d)/,
  },
  // 20260914103215, DJI_20260914103215_0001
  {
    name: "YYYYMMDDhhmmss",
    re: /(?<!\d)(?<Y>20\d{2})(?<M>\d{2})(?<D>\d{2})T?(?<h>\d{2})(?<m>\d{2})(?<s>\d{2})(?!\d)/,
  },
];

function toResult(g: Groups, matched: string, pattern: string): FilenameTime | null {
  const [Y, M, D, h, m] = [g.Y, g.M, g.D, g.h, g.m].map(Number) as [number, number, number, number, number];
  const s = g.s === undefined ? undefined : Number(g.s);
  if (!isValidLocal(Y, M, D, h, m, s ?? 0)) return null;
  if (s === undefined) {
    return { localMs: localMs(Y, M, D, h, m, 30), uncertaintyMs: 30_000, matched, pattern };
  }
  return { localMs: localMs(Y, M, D, h, m, s, 500), uncertaintyMs: 500, matched, pattern };
}

const TOKEN: Record<string, string> = {
  YYYY: "(?<Y>\\d{4})",
  MM: "(?<M>\\d{2})",
  DD: "(?<D>\\d{2})",
  hh: "(?<h>\\d{2})",
  mm: "(?<m>\\d{2})",
  ss: "(?<s>\\d{2})",
};

/** Eigenes Muster wie "REC_YYYYMMDD_hhmm" → RegExp. `*` steht für beliebige Zeichen. */
export function compileFilenamePattern(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length;) {
    const tok = Object.keys(TOKEN).find((t) => pattern.startsWith(t, i));
    if (tok) {
      out += TOKEN[tok];
      i += tok.length;
    } else if (pattern[i] === "*") {
      out += ".*?";
      i++;
    } else {
      out += pattern[i]!.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  for (const need of ["YYYY", "MM", "DD", "hh", "mm"]) {
    if (!pattern.includes(need)) throw new Error(`Muster "${pattern}" braucht ${need}`);
  }
  return new RegExp(out);
}

/** Liest eine Uhrzeit aus dem Dateinamen (ohne Ordner). Eigenes Muster hat Vorrang. */
export function timeFromFilename(fileName: string, customPattern?: string | null): FilenameTime | null {
  const base = fileName.replace(/^.*[\\/]/, "");
  const candidates: BuiltinPattern[] = customPattern
    ? [{ name: customPattern, re: compileFilenamePattern(customPattern) }, ...BUILTIN]
    : BUILTIN;
  for (const p of candidates) {
    const m = p.re.exec(base);
    if (m?.groups) {
      const r = toResult(m.groups as unknown as Groups, m[0], p.name);
      if (r) return r;
    }
  }
  return null;
}
