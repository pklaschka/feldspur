/** Was die Detailleiste in der App auslösen kann. */
import { type LevelInput, type TimeInput } from "../../shared/api.ts";
import { type ApplyView } from "../Notes.tsx";

export interface InspectorActions {
  diaryNote: (sourceId: string, clock: string) => void;
  addTime: (input: TimeInput) => Promise<boolean>;
  /** Unsichere Lage so bestätigen, wie sie gerade steht. */
  confirm: (sourceId: string, startMs: number) => void;
  /** Uhr eines Geräts als richtig gehend festlegen (Abweichung 0). */
  trustDeviceClock: (deviceId: string) => void;
  /** Gerät als Referenzuhr wählen. */
  setReference: (deviceId: string) => void;
  toggleEvidence: (evidenceId: string, enabled: boolean) => void;
  removeEvidence: (evidenceId: string) => void;
  openDiary: (pageId: string) => void;
  transcribe: (sourceId: string) => void;
  /** Gibt die Zahl übernommener Zeilen zurück, null bei Abbruch oder Fehler. */
  importTranscript: (sourceId: string, mode: "append" | "replace") => Promise<number | null>;
  setLevel: (sourceId: string, input: LevelInput) => void;
  /** Ganze Datei dekodieren und den Sprachpegel messen. */
  measureLevel: (sourceId: string) => Promise<void>;
  /** Änderung ausführen und die neue Ansicht übernehmen (Fehler zeigt die App an). */
  apply: ApplyView;
}
