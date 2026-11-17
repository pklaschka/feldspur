import { useEffect, useEffectEvent, useRef, useState } from "react";
import { mediaUrl, type SourceRow } from "../../shared/api.ts";
import { clock } from "../format.ts";
import { positionText, usePlayback } from "../playback.tsx";
import { LEVEL_MEDIA_PROPS, useLevel } from "../level.ts";

/** Audio/Video abspielen; meldet die Stelle an die Zeitachse und nimmt Spul-Wünsche an. */
export function Player({ row }: { row: SourceRow }) {
  const { report, seekRequest, position } = usePlayback();
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const raf = useRef(0);
  useLevel(ref, row.level);

  const send = () => {
    const el = ref.current;
    if (el) report({ sourceId: row.id, atMs: Math.round(el.currentTime * 1000), playing: !el.paused });
  };
  // Während der Wiedergabe flüssig nachführen, nicht nur bei timeupdate (≈ 4 Hz).
  const loop = () => {
    send();
    if (ref.current && !ref.current.paused) raf.current = requestAnimationFrame(loop);
  };
  const sendNow = useEffectEvent(send);
  useEffect(() => {
    const el = ref.current;
    if (el && seekRequest?.sourceId === row.id) {
      el.currentTime = seekRequest.atMs / 1000;
      sendNow();
    }
  }, [seekRequest, row.id]);
  // Beim Wechsel der Quelle oder Schließen: Nachführen beenden, Stelle abmelden.
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      report(null);
    },
    [row.id, report],
  );

  const here = position?.sourceId === row.id ? position.atMs : null;
  const props = {
    ref,
    src: mediaUrl(row.id),
    ...LEVEL_MEDIA_PROPS,
    controls: true,
    preload: "metadata",
    onLoadedMetadata: () => {
      if (seekRequest?.sourceId === row.id && ref.current) ref.current.currentTime = seekRequest.atMs / 1000;
      send();
    },
    onSeeked: send,
    onPlay: () => {
      raf.current = requestAnimationFrame(loop);
    },
    onPause: send,
    onError: () => setFailed(true),
    "data-testid": "player",
  } as const;
  return (
    <div className="mt-3.5">
      {failed ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[0.85rem] text-warn">
          Diese Datei lässt sich hier nicht abspielen (Format oder Codec). Ins Montagevideo kommt sie trotzdem. Zum
          Abhören und Mitschreiben wandle sie in MP4 (H.264) bzw. WAV oder M4A um; siehe Handbuch, „Formate“.
        </p>
      ) : row.kind === "video" ? (
        <video {...props} className="block max-h-56 w-full rounded-lg bg-black" />
      ) : (
        <audio {...props} className="block w-full" />
      )}
      {here !== null && (
        <div className="mt-1 flex justify-between font-mono text-[0.82rem] text-ink-2" data-testid="player-position">
          <span>{positionText(here)}</span>
          {row.startMs !== null && <span>{clock(row.startMs + here)}</span>}
        </div>
      )}
    </div>
  );
}
