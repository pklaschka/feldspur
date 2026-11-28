/**
 * Der Rahmen des Schritts „Ansehen“ (Issue #131): zeigt die Seite des Viewers in der App und spielt dazu die
 * Originale ab. Einstieg von `watch.html`; die Oberfläche (`Watch.tsx`) bindet die Seite als `<iframe>` ein.
 *
 * Ablauf: Nach dem Laden meldet der Rahmen `ready`, bekommt mit `load` die Seite (`WatchPreview`), baut sie auf, legt
 * die Wiedergabe aus den Originalen an (`player.ts`) und startet dann denselben `viewerMain` wie die ausgegebene
 * HTML-Datei (`packages/media/src/viewer/runtime.ts`). Für einen neuen Stand lädt die Oberfläche den Rahmen neu,
 * denn `viewerMain` hängt sich einmal an das Dokument. Die Nachrichten stehen in `messages.ts`.
 */
import { viewerMain } from "@feldspur/media/viewer-runtime";
import type { FromFrame, ToFrame } from "./messages.ts";
import { createPlayer, type MontagePlayer } from "./player.ts";

/** Was `viewerMain` zum Nachsehen an `window.feldspur` hängt, soweit der Rahmen es braucht. */
interface ViewerHandle {
  S: { t: number; cur: number };
  seek: (t: number, follow?: boolean) => void;
}

const send = (m: FromFrame, transfer: Transferable[] = []) => window.parent.postMessage(m, "*", transfer);
let player: MontagePlayer | null = null;

/** Die Seite aufbauen und den Viewer starten; `m.at` ist die Stelle, an der es weitergeht. */
function load(m: Extract<ToFrame, { type: "load" }>): void {
  const style = document.createElement("style");
  style.textContent = m.preview.css;
  document.head.append(style);
  // Die Seite kommt fertig aus dem Hauptprozess (`viewerParts`), alle Texte sind dort maskiert.
  document.body.innerHTML = m.preview.body;

  player = createPlayer(document.getElementById("vid")!, m.preview.plan, {
    levels: new Map(m.levels),
    tracks: m.preview.tracks,
  });
  // Die Freigabe einer Videodatei gibt es in der App nicht: Die Einzelspuren spielt `player` selbst.
  viewerMain(() => Promise.reject(new Error("In der App gibt es keine Videodatei")), player);
  const viewer = (window as unknown as { feldspur: ViewerHandle }).feldspur;
  if (m.at > 0) viewer.seek(m.at, true);

  // Stelle melden, damit sie ein Neuladen übersteht.
  let told = -1;
  setInterval(() => {
    if (Math.abs(viewer.S.t - told) < 0.25) return;
    told = viewer.S.t;
    send({ type: "at", t: told });
  }, 400);

  // „Bearbeiten“: an der Zeile oder mit E an der aktuellen Zeile.
  const edit = (li: Element | null | undefined) => {
    const index = Number((li as HTMLElement | null)?.dataset.i);
    if (!li?.querySelector(".edit") || !Number.isInteger(index)) return;
    player?.pause();
    send({ type: "at", t: viewer.S.t });
    send({ type: "edit", index });
  };
  document.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest(".edit");
    if (b) edit(b.closest("li"));
  });
  document.addEventListener("keydown", (ev) => {
    const typing = (ev.target as HTMLElement).closest("input:not([type=range]), textarea, select");
    // Kürzel der App (Suche, Rückgängig) gelten auch hier; Strg+F gehört der Suche im Text.
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() !== "f") {
      const { key, ctrlKey, metaKey, shiftKey, altKey } = ev;
      send({ type: "key", key, ctrlKey, metaKey, shiftKey, altKey });
      return;
    }
    if (ev.key.toLowerCase() !== "e" || typing || ev.altKey || document.querySelector("dialog[open]")) return;
    ev.preventDefault();
    edit(document.querySelector('#tr > li[aria-current="true"]'));
  });

  // Bilder erst holen, wenn sie ins Bild kommen: Die Oberfläche rendert sie aus den Originalen (auch PDF-Seiten).
  const seen = new IntersectionObserver(
    (list) => {
      for (const e of list) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        send({ type: "image", n: Number((e.target as HTMLElement).dataset.img) });
      }
    },
    { rootMargin: "400px" },
  );
  document.querySelectorAll("img[data-img]").forEach((img) => seen.observe(img));
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const m = ev.data as ToFrame;
  if (m.type === "load" && !player) load(m);
  else if (m.type === "pause") player?.pause();
  else if (m.type === "image") {
    const img = document.querySelector<HTMLImageElement>(`img[data-img="${m.n}"]`);
    if (!img) return;
    if (m.data) img.src = URL.createObjectURL(new Blob([m.data], { type: "image/jpeg" }));
    else img.closest(".img")?.replaceWith(Object.assign(document.createElement("span"), noImage));
  }
});
/** Platzhalter für ein Bild, das sich in der App nicht zeigen lässt. */
const noImage = { className: "noimg", textContent: "[Bild lässt sich hier nicht zeigen, siehe Originaldatei]" };

send({ type: "ready" });
