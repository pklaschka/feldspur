/**
 * Schnittliste für DaVinci Resolve (und Final Cut Pro): dieselbe Montage als FCPXML 1.9.
 * Resolve rechnet dann selbst (mit Grafikkarte). Enthalten sind Videos (gleichzeitige nebeneinander),
 * Ton je Gerät auf eigener Spur und Marker für Episoden, Tafeln, Fotos, Tagebuch und Mitschrift.
 * Die Einblendungen (Uhrzeit, Herkunft) fehlen; die Uhrzeit steht in den Markern.
 *
 * Einordnung: Schritt Ausgeben, nur mit der Option „Schnittliste für Resolve“. `exportSession`
 * (`packages/media/src/export.ts`) ruft `montageFcpxml` mit denselben Stücken auf, aus denen auch das Montagevideo
 * entsteht (`planPieces`, `packages/media/src/montage-video.ts`). Die Datei verweist auf die Originaldateien an
 * ihrem jetzigen Ort; sie enthält selbst kein Material.
 */
import { pathToFileURL } from "node:url";
import { DEFAULT_FORMAT, montageLayout, videoTiles, type Box, type MontageFormat } from "./layout.ts";
import type { Piece } from "./montage-video.ts";
import { entryText, type SessionTranscript } from "./session-transcript.ts";
import { xmlEscape } from "./xml.ts";

/**
 * Name des Formats, wie Final Cut Pro und Resolve ihn kennen. Nur für die Formate, die es dort unter einem Namen gibt;
 * die übrigen (640 × 360, 960 × 540, 10 und 15 Bilder/s) beschreiben Maße und Bilddauer allein.
 */
const formatName = (f: MontageFormat) =>
  (f.height === 720 || f.height === 1080) && (f.fps === 25 || f.fps === 30)
    ? ` name="FFVideoFormat${f.height}p${f.fps}"`
    : "";

export interface FcpxmlOptions {
  projectName: string;
  /** Ton wie im Montagevideo: alle laufenden Geräte (Standard) oder nur die Hauptquelle. */
  audioMix?: "all" | "main";
  /** Auflösung und Bildrate der Sequenz, wie beim Montagevideo; `pieces` müssen mit derselben Bildrate geplant sein. */
  format?: MontageFormat;
}

/**
 * FCPXML-Text der Montage. Je Stück (`Piece`) ein Clip auf der Hauptspur: das erste Video oder, ohne Video, eine
 * Lücke (`gap`). Weitere Videos liegen auf Spuren darüber (lane 1, 2, …), der Ton auf Spuren darunter (lane −1, …).
 */
export function montageFcpxml(transcript: SessionTranscript, pieces: Piece[], opts: FcpxmlOptions): string {
  const format = opts.format ?? DEFAULT_FORMAT;
  const layout = montageLayout(format);
  const { w: W, h: H, fps } = layout;
  /** Rationale Zeit in Bildern der Sequenz. */
  const t = (frames: number) => (frames === 0 ? "0s" : `${frames}/${fps}s`);
  /** Millisekunden → Bilder der Sequenz (gerundet). */
  const msFrames = (ms: number) => Math.round((ms * fps) / 1000);
  /**
   * Ein Bild in ein Feld setzen: Mitte in FCPXML-Einheiten (Bildhöhe = 100, Ursprung in der Mitte,
   * y nach oben), Maßstab bezogen auf das ganze Bild.
   */
  const transform = (b: Box, scale = Math.min(b.w / W, b.h / H)) => {
    const x = (((b.x + b.w / 2 - W / 2) / H) * 100).toFixed(2);
    const y = (((H / 2 - (b.y + b.h / 2)) / H) * 100).toFixed(2);
    return `<adjust-transform position="${x} ${y}" scale="${scale.toFixed(3)} ${scale.toFixed(3)}"/>`;
  };
  const assets = new Map<string, { id: string; xml: string }>();
  // Jede Originaldatei einmal unter <resources>; mehrfach gebrauchte bekommen dieselbe Kennung (r1 ist das Format).
  const asset = (path: string, name: string, kind: "av" | "audio", durationMs: number | null) => {
    const got = assets.get(path);
    if (got) return got.id;
    const id = `a${assets.size + 2}`;
    const dur = t(msFrames(durationMs ?? 0));
    const flags =
      kind === "audio"
        ? `hasAudio="1" audioSources="1" audioChannels="2"`
        : `hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2"`;
    assets.set(path, {
      id,
      xml: `    <asset id="${id}" name="${xmlEscape(name)}" start="0s" duration="${dur}" ${flags}>\n      <media-rep kind="original-media" src="${xmlEscape(pathToFileURL(path).href)}"/>\n    </asset>`,
    });
    return id;
  };

  // Marker je Zeile des Einsatztranskripts, an die passende Stelle im passenden Stück.
  const markersIn = (p: Piece, localStart: number) =>
    transcript.entries
      .filter((e) => e.kind !== "end" && msFrames(e.montageMs) >= p.f0 && msFrames(e.montageMs) < p.f1)
      .map((e) => {
        const at = localStart + msFrames(e.montageMs) - p.f0;
        const kind = e.kind === "episode" || e.kind === "card" ? "chapter-marker" : "marker";
        return `          <${kind} start="${t(at)}" duration="${t(1)}" value="${xmlEscape(entryText(e).slice(0, 250))}"/>`;
      });

  const spine: string[] = [];
  for (const p of pieces) {
    const len = p.f1 - p.f0;
    const children: string[] = [];
    const [main, ...more] = p.videos;
    // Verbundene Clips liegen in der Zeit der Hauptspur-Clips: beim Video ab dessen Startstelle.
    const base = main ? msFrames(main.fromMs) : 0;
    const tiles = videoTiles(p.videos.length, layout);
    more.forEach((v, k) => {
      const id = asset(v.source.originalPath, v.source.fileName, "av", v.source.durationMs);
      children.push(
        `          <asset-clip ref="${id}" lane="${k + 1}" offset="${t(base)}" start="${t(msFrames(v.fromMs))}" duration="${t(len)}" srcEnable="video" name="${xmlEscape(v.label)}">\n            ${transform(tiles[k + 1]!)}\n          </asset-clip>`,
      );
    });
    // Ton jeder laufenden Quelle auf eigener Spur, damit er sich in Resolve einzeln regeln lässt.
    const sounds = opts.audioMix === "main" ? p.audios.slice(0, 1) : p.audios;
    sounds.forEach((a, k) => {
      const s = a.source;
      const id = asset(s.originalPath, s.fileName, s.kind === "video" ? "av" : "audio", s.durationMs);
      children.push(
        `          <asset-clip ref="${id}" lane="${-(k + 1)}" offset="${t(base)}" start="${t(msFrames(a.fromMs))}" duration="${t(len)}" srcEnable="audio" name="${xmlEscape(a.label)}"/>`,
      );
    });
    children.push(...markersIn(p, base));
    if (main) {
      const id = asset(main.source.originalPath, main.source.fileName, "av", main.source.durationMs);
      const own = more.length ? [`          ${transform(tiles[0]!)}`] : [];
      spine.push(
        `        <asset-clip ref="${id}" offset="${t(p.f0)}" start="${t(base)}" duration="${t(len)}" name="${xmlEscape(p.title ? `${p.title} · ${main.label}` : main.label)}" srcEnable="video">\n${[...own, ...children].join("\n")}\n        </asset-clip>`,
      );
    } else {
      spine.push(
        `        <gap name="${xmlEscape(p.title)}" offset="${t(p.f0)}" start="0s" duration="${t(len)}">\n${children.join("\n")}\n        </gap>`,
      );
    }
  }

  const total = pieces.at(-1)?.f1 ?? 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1"${formatName(format)} frameDuration="1/${fps}s" width="${W}" height="${H}"/>
${[...assets.values()].map((a) => a.xml).join("\n")}
  </resources>
  <library>
    <event name="Feldspur">
      <project name="${xmlEscape(opts.projectName)}">
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
