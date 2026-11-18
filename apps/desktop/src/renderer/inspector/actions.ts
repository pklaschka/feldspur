/** Was die Detailleiste in der App auslösen kann. */
import type { DecideInput, LevelInput, TimeInput } from "../../shared/api.ts";
import type { ApplyView } from "../Notes.tsx";

export interface InspectorActions {
  diaryNote: (sourceId: string, clock: string) => void;
  addTime: (input: TimeInput) => Promise<boolean>;
  /** Unsichere Lage so bestätigen, wie sie gerade steht. */
  confirm: (sourceId: string, startMs: number) => void;
  /** Bei widersprüchlichen Zeitbelegen entscheiden, welche Zeit gilt. */
  decide: (input: DecideInput) => void;
  /** Dieselbe Entscheidung für mehrere Quellen (je Quelle gilt ihr Beleg der Art `kind`). */
  decideMany: (sourceIds: string[], kind: string, reason: string) => void;
  /** Lesart der als UTC markierten Zeitstempel eines Geräts umstellen. */
  setDeviceUtc: (deviceId: string, utc: boolean) => void;
  /** Abweichung der Geräteuhr setzen (Uhr nach einer Angabe richten). */
  setDeviceOffset: (deviceId: string, offsetMs: number) => void;
  /** Zum Schritt „Abgleichen“ wechseln. */
  goSync: () => void;
  /** Uhr eines Geräts als richtig gehend festlegen (Abweichung 0). */
  trustDeviceClock: (deviceId: string) => void;
  /** Gerät als Referenzuhr wählen. */
  setReference: (deviceId: string) => void;
  toggleEvidence: (evidenceId: string, enabled: boolean) => void;
  removeEvidence: (evidenceId: string) => void;
  openDiary: (pageId: string) => void;
  transcribe: (sourceId: string) => void;
  /** Gibt die Zahl übernommener Zeilen zurück, null bei Abbruch oder Fehler. */
  importTranscript: (
    sourceId: string,
    mode: "append" | "replace",
  ) => Promise<{ count: number; dropped: number } | null>;
  setLevel: (sourceId: string, input: LevelInput) => void;
  /** Ganze Datei dekodieren und den Sprachpegel messen. */
  measureLevel: (sourceId: string) => Promise<void>;
  /** Originaldatei für eine Quelle wählen (nur mit passender Prüfsumme übernommen). */
  relinkOriginal: (sourceId: string) => void;
  /** Dialog „Originaldateien“ öffnen (Ordner durchsuchen, alle prüfen). */
  openOriginals: () => void;
  /** Änderung ausführen und die neue Ansicht übernehmen (Fehler zeigt die App an). */
  apply: ApplyView;
}
