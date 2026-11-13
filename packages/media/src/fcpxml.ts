/**
 * Schnittliste für DaVinci Resolve (und Final Cut Pro): dieselbe Montage als FCPXML 1.9.
 * Resolve rechnet dann selbst (mit Grafikkarte). Enthalten sind Video, Hauptton, Standbilder
 * und Marker für Episoden, Tafeln, Fotos, Tagebuch und Mitschrift. Die Einblendungen (Uhrzeit,
 * Zeitleisten) fehlen; die Uhrzeit steht in den Markern.
 */
import { pathToFileURL } from "node:url";
import { FPS, H, LAYOUT, W, type Piece } from "./montage-video.ts";
import { entryText, type Scaffold } from "./scaffold.ts";

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
/** Rationale Zeit in Bildern der Sequenz. */
const t = (frames: number) => (frames === 0 ? "0s" : `${frames}/${FPS}s`);
const msFrames = (ms: number) => Math.round((ms * FPS) / 1000);
/** Mitte der Seitenspalte, in FCPXML-Einheiten (Bildhöhe = 100, Ursprung in der Mitte). */
const SIDE_X = (((LAYOUT.side.x + LAYOUT.side.w / 2 - W / 2) / H) * 100).toFixed(2);

export interface FcpxmlOptions {
  projectName: string;
  /** Bilddateien je Standbild-Datei aus der Montage → Pfad, unter dem Resolve sie findet. */
  stillPath: (file: string) => string;
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
    if (p.video) {
      const v = p.video.source;
      const vid = asset(v.originalPath, v.fileName, "av", v.durationMs);
      const start = msFrames(p.video.fromMs);
      const ownAudio = p.audio?.source.id === v.id;
      if (p.audio && !ownAudio) {
        const a = p.audio.source;
        const aid = asset(a.originalPath, a.fileName, a.kind === "video" ? "av" : "audio", a.durationMs);
        children.push(
          `          <asset-clip ref="${aid}" lane="-1" offset="${t(start)}" start="${t(msFrames(p.audio.fromMs))}" duration="${t(len)}" srcEnable="audio" name="${esc(a.label)}"/>`,
        );
      }
      if (p.still) {
        const sid = asset(opts.stillPath(p.still.file), p.still.caption, "image", null);
        children.push(
          `          <video ref="${sid}" lane="1" offset="${t(start)}" start="0s" duration="${t(len)}" name="${esc(p.still.caption)}">\n            <adjust-transform position="${SIDE_X} 0" scale="0.25 0.25"/>\n          </video>`,
        );
      }
      children.push(...markersIn(p, start));
      spine.push(
        `        <asset-clip ref="${vid}" offset="${t(p.f0)}" start="${t(start)}" duration="${t(len)}" name="${esc(`${p.title} · ${v.label}`)}"${ownAudio || !p.audio ? "" : ` srcEnable="video"`}>\n${children.join("\n")}\n        </asset-clip>`,
      );
      continue;
    }
    // Ohne Video: Lücke, darin Ton und Standbild als verbundene Clips.
    if (p.audio) {
      const a = p.audio.source;
      const aid = asset(a.originalPath, a.fileName, a.kind === "video" ? "av" : "audio", a.durationMs);
      children.push(
        `          <asset-clip ref="${aid}" lane="-1" offset="0s" start="${t(msFrames(p.audio.fromMs))}" duration="${t(len)}" srcEnable="audio" name="${esc(a.label)}"/>`,
      );
    }
    if (p.still) {
      const sid = asset(opts.stillPath(p.still.file), p.still.caption, "image", null);
      const side = p.kind === "episode";
      children.push(
        `          <video ref="${sid}" lane="1" offset="0s" start="0s" duration="${t(len)}" name="${esc(p.still.caption)}">${
          side ? `\n            <adjust-transform position="${SIDE_X} 0" scale="0.25 0.25"/>\n          ` : ""
        }</video>`,
      );
    }
    children.push(...markersIn(p, 0));
    spine.push(
      `        <gap name="${esc(p.title)}" offset="${t(p.f0)}" start="0s" duration="${t(len)}">\n${children.join("\n")}\n        </gap>`,
    );
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
