/** Was der Schritt „Ausgeben“ vom Hauptprozess lädt: Stand der letzten Ausgabe, Vorschau, Zahlen der Beleg-Karte. */
import { useEffect, useState } from "react";
import type {
  ExportCard,
  ExportRequestOptions,
  ExportStatus,
  SessionTranscriptPreview,
  SessionView,
} from "../../shared/api.ts";

const api = window.feldspur;

/**
 * Stand der letzten Ausgabe im Vergleich zu Einsatz und Einstellungen; null = noch nie ausgegeben. Lädt neu, wenn
 * sich der Einsatz, die Einstellungen oder `finished` (Ergebnis der eben beendeten Ausgabe) ändern, nicht aber
 * während einer laufenden Ausgabe.
 */
export function useExportStatus(
  view: SessionView,
  settings: ExportRequestOptions,
  busy: boolean,
  finished: unknown,
): ExportStatus | null {
  const sessionId = view.session.id;
  const [status, setStatus] = useState<ExportStatus | null>(null);
  useEffect(() => {
    if (busy) return;
    let live = true;
    void api.exportStatus(sessionId, settings).then(
      (st) => live && setStatus(st),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, settings, busy, finished]);
  return status;
}

/** Vorschau des Einsatztranskripts samt Länge der Montage; null, solange sie berechnet wird. */
export function useTranscriptPreview(view: SessionView, realtime: boolean): SessionTranscriptPreview | null {
  const sessionId = view.session.id;
  const [preview, setPreview] = useState<SessionTranscriptPreview | null>(null);
  useEffect(() => {
    let live = true;
    void api.previewExport(sessionId, realtime).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, realtime]);
  return preview;
}

/**
 * Zahlen für die Beleg-Karte der Ausgabe von `exportedAt`; null, solange sie laden oder wenn es keine aktuelle
 * Ausgabe gibt (`exportedAt` null).
 */
export function useExportCard(
  view: SessionView,
  settings: ExportRequestOptions,
  exportedAt: string | null,
): ExportCard | null {
  const sessionId = view.session.id;
  const [loaded, setLoaded] = useState<{ key: string; card: ExportCard } | null>(null);
  const cardFor = exportedAt === null ? null : `${sessionId}\n${exportedAt}`;
  useEffect(() => {
    if (!cardFor) return;
    let live = true;
    void api.exportCard(sessionId, settings).then(
      (c) => live && setLoaded({ key: cardFor, card: c }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [view, cardFor, sessionId, settings]);
  return loaded && loaded.key === cardFor ? loaded.card : null;
}
