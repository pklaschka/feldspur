/**
 * Große Vorschau einer Quelle: Bilder (mit allen Bildern derselben Seite), PDF-Seiten,
 * Video und Audio. Bilder lassen sich zwischen „einpassen“ und „Originalgröße“ umschalten.
 */
import { Dialog, VisuallyHidden } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type SessionView, type SourceRow } from "../shared/api.ts";
import { KIND_LABEL } from "./format.ts";
import { PdfPages } from "./pdf.tsx";
import { usePlayback } from "./playback.tsx";
import { Button, Choice, CloseButton, cx, Glyph } from "./ui.tsx";

export function Preview({
  view,
  sourceId,
  onClose,
}: {
  view: SessionView;
  sourceId: string | null;
  onClose: () => void;
}) {
  const row = sourceId ? view.rows.find((r) => r.id === sourceId) : undefined;
  // Bilder einer Seite gemeinsam zeigen: Hauptquelle und weitere Bilder.
  const mainId = row?.partOf ?? row?.id;
  const group = row ? view.rows.filter((r) => r.id === mainId || r.partOf === mainId) : [];
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  useEffect(() => {
    setIndex(
      Math.max(
        0,
        group.findIndex((r) => r.id === sourceId),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);
  const shown = group[index] ?? row;

  return (
    <Dialog.Root open={!!row} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="fixed inset-4 z-40 flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          data-testid="preview"
          aria-describedby={undefined}
        >
          {shown && (
            <>
              <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <Glyph kind={shown.kind} />
                <Dialog.Title className="min-w-0 truncate">
                  <b className="font-mono">{shown.label}</b> · {shown.fileName}
                  <span className="text-muted"> · {KIND_LABEL[shown.kind]}</span>
                </Dialog.Title>
                <span className="flex-1" />
                {group.length > 1 && (
                  <span className="flex items-center gap-1.5 text-[0.85rem]">
                    <Button
                      size="sm"
                      disabled={index === 0}
                      onClick={() => setIndex(index - 1)}
                      aria-label="Voriges Bild"
                    >
                      ‹
                    </Button>
                    Bild {index + 1} von {group.length}
                    <Button
                      size="sm"
                      disabled={index === group.length - 1}
                      onClick={() => setIndex(index + 1)}
                      aria-label="Nächstes Bild"
                    >
                      ›
                    </Button>
                  </span>
                )}
                {shown.previewable && (
                  <Choice
                    label="Größe"
                    value={zoom}
                    onChange={setZoom}
                    options={[
                      { value: "fit", label: "Einpassen" },
                      { value: "full", label: "Originalgröße" },
                    ]}
                  />
                )}
                <CloseButton onClick={onClose} />
              </header>
              <Body row={shown} zoom={zoom} onToggleZoom={() => setZoom(zoom === "fit" ? "full" : "fit")} />
            </>
          )}
          {!shown && (
            <VisuallyHidden.Root>
              <Dialog.Title>Vorschau</Dialog.Title>
            </VisuallyHidden.Root>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({ row, zoom, onToggleZoom }: { row: SourceRow; zoom: "fit" | "full"; onToggleZoom: () => void }) {
  if (row.previewable) {
    return (
      <div
        className={cx(
          "min-h-0 flex-1 bg-sunken",
          zoom === "fit" ? "flex items-center justify-center overflow-hidden p-4" : "overflow-auto",
        )}
      >
        <img
          src={mediaUrl(row.id)}
          alt={row.fileName}
          onClick={onToggleZoom}
          className={cx(
            "block",
            zoom === "fit"
              ? "max-h-full max-w-full min-h-0 cursor-zoom-in object-contain"
              : "max-w-none cursor-zoom-out",
          )}
        />
      </div>
    );
  }
  if (row.isPdf) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-sunken p-4">
        <PdfPages sourceId={row.id} className="mx-auto grid max-w-[900px] gap-4" />
      </div>
    );
  }
  if (row.kind === "audio" || row.kind === "video") return <BigPlayer row={row} />;
  return <p className="p-6 text-muted">Für diese Datei gibt es keine Vorschau.</p>;
}

/** Großer Player; übernimmt die Stelle aus der Detailleiste und gibt sie beim Schließen zurück. */
function BigPlayer({ row }: { row: SourceRow }) {
  const { position, seek } = usePlayback();
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const start = position?.sourceId === row.id ? position.atMs : 0;
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) seek(row.id, Math.round(el.currentTime * 1000));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  const props = {
    ref,
    src: mediaUrl(row.id),
    controls: true,
    autoPlay: false,
    onLoadedMetadata: () => {
      if (ref.current) ref.current.currentTime = start / 1000;
    },
  };
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-black p-4">
      {row.kind === "video" ? (
        <video {...props} className="max-h-full max-w-full" />
      ) : (
        <audio {...props} className="w-[min(640px,90%)]" />
      )}
    </div>
  );
}
