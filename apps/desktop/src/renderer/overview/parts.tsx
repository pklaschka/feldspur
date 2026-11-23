/** Bausteine, die Kopfzeile, Tage und Legende des Feldkalenders teilen: das Zeilenraster und die Zeichen der Arten. */
import type { CSSProperties } from "react";
import type { CalendarKind } from "@feldspur/media/field-calendar";
import { cx } from "../ui.tsx";

/** Raster jeder Zeile des Feldkalenders: Häkchen, Tag, Spur, Fakten; schmal stehen Spur und Fakten unter dem Tag. */
export const ROW =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 @[1150px]:grid-cols-[auto_14rem_minmax(0,1fr)_27rem] @[1500px]:grid-cols-[auto_18rem_minmax(0,1fr)_27rem]";

const KIND_BG: Record<CalendarKind, string> = {
  audio: "bg-k-audio",
  video: "bg-k-video",
  photo: "bg-k-photo",
  diary: "bg-k-diary",
};

/** Zeichen einer Art: Balken für Ton und Video, Raute für Fotos, Strich für Tagebuch. */
export function Mark({ kind, legend, style }: { kind: CalendarKind; legend?: boolean; style?: CSSProperties }) {
  const shape =
    kind === "photo"
      ? "size-[7px] rotate-45"
      : kind === "diary"
        ? "h-[9px] w-[2px]"
        : legend
          ? "h-[6px] w-4 rounded-full"
          : "h-[6px] rounded-full";
  return <span aria-hidden className={cx(legend ? "inline-block" : "absolute", shape, KIND_BG[kind])} style={style} />;
}
