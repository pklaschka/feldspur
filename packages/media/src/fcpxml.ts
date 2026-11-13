/**
 * Schnittliste für DaVinci Resolve (und Final Cut Pro): dieselbe Montage als FCPXML 1.9.
 * Resolve rechnet dann selbst (mit Grafikkarte). Enthalten sind Videos (gleichzeitige nebeneinander), Ton je Gerät auf eigener Spur, Standbilder
 * und Marker für Episoden, Tafeln, Fotos, Tagebuch und Mitschrift. Die Einblendungen (Uhrzeit,
 * Zeitleisten) fehlen; die Uhrzeit steht in den Markern.
 */
import { pathToFileURL } from "node:url";
import { FPS, H, stillBox, videoTiles, W, type Box } from "./layout.ts";
import type { Piece } from "./montage-video.ts";
import { entryText, type Scaffold } from "./scaffold.ts";

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
/** Rationale Zeit in Bildern der Sequenz. */
const t = (frames: number) => (frames === 0 ? "0s" : `${frames}/${FPS}s`);
const msFrames = (ms: number) => Math.round((ms * FPS) / 1000);
/**
 * Ein Bild in ein Feld setzen: Mitte in FCPXML-Einheiten (Bildhöhe = 100, Ursprung in der Mitte,
 * y nach oben), Maßstab bezogen auf das ganze Bild.
 */
const transform = (b: Box, scale = Math.min(b.w / W, b.h / H)) => {
  const x = (((b.x + b.w / 2 - W / 2) / H) * 100).toFixed(2);
  const y = (((H / 2 - (b.y + b.h / 2)) / H) * 100).toFixed(2);
  return `<adjust-transform position="${x} ${y}" scale="${scale.toFixed(3)} ${scale.toFixed(3)}"/>`;
};

export interface FcpxmlOptions {
  projectName: string;
  /** Bilddateien je Standbild-Datei aus der Montage → Pfad, unter dem Resolve sie findet. */
  stillPath: (file: string) => string;
  /** Ton wie im Montagevideo: alle laufenden Geräte (Standard) oder nur die Hauptquelle. */
  audioMix?: "all" | "main";
}

export function montageFcpxml(sc: Scaffold, pieces: Piece[], opts: FcpxmlOptions): string {
  const assets = new Map<string, { id: string; xml: string }>();
  const asset = (path: string, name: string, kind: "av" | "audio" | "image", durationMs: number | null) => {
    const got = assets.get(path);
    if (got) return got.id;
    const id = `a${assets.size + 2}`;
    const dur = kind === "image" ? "0s" : t(msFrames(durationMs ?? 0));
    const flags =
      kind === "image"
        ? `hasVideo="1" format="r1"`
        : kind === "audio"
          ? `hasAudio="1" audioSources="1" audioChannels="2"`
          : `hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2"`;
    assets.set(path, {
      id,
      xml: `    <asset id="${id}" name="${esc(name)}" start="0s" duration="${dur}" ${flags}>\n      <media-rep kind="original-media" src="${esc(pathToFileURL(path).href)}"/>\n    </asset>`,
    });
    return id;
  };

  // Marker je Zeile des Zeitgerüsts, an die passende Stelle im passenden Stück.
  const markersIn = (p: Piece, localStart: number) =>
    sc.entries
      .filter((e) => e.kind !== "end" && msFrames(e.montageMs) >= p.f0 && msFrames(e.montageMs) < p.f1)
      .map((e) => {
        const at = localStart + msFrames(e.montageMs) - p.f0;
        const kind = e.kind === "episode" || e.kind === "card" ? "chapter-marker" : "marker";
        return `          <${kind} start="${t(at)}" duration="${t(1)}" value="${esc(entryText(e).slice(0, 250))}"/>`;
      });

  const spine: string[] = [];
  for (const p of pieces) {
    const len = p.f1 - p.f0;
    const children: string[] = [];
    const [main, ...more] = p.videos;
    // Verbundene Clips liegen in der Zeit der Hauptspur-Clips: beim Video ab dessen Startstelle.
    const base = main ? msFrames(main.fromMs) : 0;
    const tiles = videoTiles(p.videos.length);
    more.forEach((v, k) => {
      const id = asset(v.source.originalPath, v.source.fileName, "av", v.source.durationMs);
      children.push(
        `          <asset-clip ref="${id}" lane="${k + 1}" offset="${t(base)}" start="${t(msFrames(v.fromMs))}" duration="${t(len)}" srcEnable="video" name="${esc(v.label)}">\n            ${transform(tiles[k + 1]!)}\n          </asset-clip>`,
      );
    });
    // Ton jeder laufenden Quelle auf eigener Spur, damit er sich in Resolve einzeln regeln lässt.
    const sounds = opts.audioMix === "main" ? p.audios.slice(0, 1) : p.audios;
    sounds.forEach((a, k) => {
      const s = a.source;
      const id = asset(s.originalPath, s.fileName, s.kind === "video" ? "av" : "audio", s.durationMs);
      children.push(
        `          <asset-clip ref="${id}" lane="${-(k + 1)}" offset="${t(base)}" start="${t(msFrames(a.fromMs))}" duration="${t(len)}" srcEnable="audio" name="${esc(a.label)}"/>`,
      );
    });
    if (p.still?.file) {
      const id = asset(opts.stillPath(p.still.file), p.still.caption, "image", null);
      const box = stillBox(p.kind, !!p.still.text);
      children.push(
        `          <video ref="${id}" lane="${more.length + 1}" offset="${t(base)}" start="0s" duration="${t(len)}" name="${esc(p.still.caption)}">${
          p.kind === "episode" ? `\n            ${transform(box)}\n          ` : ""
        }</video>`,
      );
    }
    children.push(...markersIn(p, base));
    if (main) {
      const id = asset(main.source.originalPath, main.source.fileName, "av", main.source.durationMs);
      const own = more.length ? [`          ${transform(tiles[0]!)}`] : [];
      spine.push(
        `        <asset-clip ref="${id}" offset="${t(p.f0)}" start="${t(base)}" duration="${t(len)}" name="${esc(`${p.title} · ${main.label}`)}" srcEnable="video">\n${[...own, ...children].join("\n")}\n        </asset-clip>`,
      );
    } else {
      spine.push(
        `        <gap name="${esc(p.title)}" offset="${t(p.f0)}" start="0s" duration="${t(len)}">\n${children.join("\n")}\n        </gap>`,
      );
    }
  }

  const total = pieces.at(-1)?.f1 ?? 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat720p25" frameDuration="1/${FPS}s" width="${W}" height="${H}"/>
${[...assets.values()].map((a) => a.xml).join("\n")}
  </resources>
  <library>
    <event name="Feldspur">
      <project name="${esc(opts.projectName)}">
        <sequence format="r1" duration="${t(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
