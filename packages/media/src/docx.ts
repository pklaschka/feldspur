/**
 * Einsatztranskript als .docx für MAXQDA. Zeitmarken im Format #hh:mm:ss-z# (im Test von Zuri erkannt),
 * jede Zeile ein eigener Absatz, Bilder direkt unter ihrer Zeile.
 *
 * Einordnung: Schritt Ausgeben. `exportSession` (`packages/media/src/export.ts`) ruft `sessionTranscriptDocx` auf.
 * Inhalt und Reihenfolge stehen schon fest (`SessionTranscript` aus `packages/media/src/session-transcript.ts`); hier
 * entsteht nur die Word-Datei daraus. Dieselben Zeilen zeigt der Viewer (`packages/media/src/viewer/html.ts`).
 */
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import {
  timestamp,
  type ImageRef,
  type SessionTranscript,
  type SessionTranscriptContext,
  type SessionTranscriptEntry,
} from "./session-transcript.ts";
import type { Still } from "./stills.ts";

export interface DocxOptions {
  /** Dateiname des Montagevideos, auf das sich die Zeitmarken beziehen. */
  mediaFileName: string;
  /** Standbilder je Eintrag (gleiche Reihenfolge wie entry.images); null = nicht darstellbar. */
  stills: Map<SessionTranscriptEntry, (Still | null)[]>;
  /** Standbilder je Kontextstück (gleiche Reihenfolge wie images). */
  contextStills?: Map<SessionTranscriptContext, (Still | null)[]>;
  /** Breite der Bilder im Dokument in px (96 dpi). */
  imageWidth?: number;
}

/**
 * Farben der Überschriften je Art des Eintrags (Hex ohne #). Die Vorschau in der App nimmt dieselben
 * Werte für das helle Design (styles.css, --st-*), ein Test prüft, dass beide gleich bleiben.
 */
export const SESSION_TRANSCRIPT_KIND_COLOR: Partial<Record<SessionTranscriptEntry["kind"], string>> = {
  card: "6B7A80",
  episode: "1D2B33",
  start: "2A52BE",
  photo: "8A4FBF",
  diary: "A8571F",
  sync: "107A5F",
};
/** Farbe der Kopfzeile eines Kontextstücks (wie Episoden: Tinte, neutral). Vorschau: --st-context. */
export const SESSION_TRANSCRIPT_CONTEXT_COLOR = "1D2B33";
/** Farbe der Uhrzeit hinter der Zeitmarke und der Kopfzeilen. */
export const SESSION_TRANSCRIPT_CLOCK_COLOR = "5F6B73";

/** Eine Zeile der Chronologie: Zeitmarke, Uhrzeit, Kopf und Text in einem Absatz, darunter ihre Bilder. */
function entryParagraphs(e: SessionTranscriptEntry, stills: (Still | null)[], width: number): Paragraph[] {
  const runs: TextRun[] = [new TextRun({ text: `${timestamp(e.montageMs)} ` })];
  if (e.clock) runs.push(new TextRun({ text: `Uhrzeit ${e.clock} · `, color: SESSION_TRANSCRIPT_CLOCK_COLOR }));
  if (e.head) {
    runs.push(
      new TextRun({
        text: e.kind === "line" ? `${e.head} · ` : `${e.head}: `,
        bold: e.kind !== "line",
        color: SESSION_TRANSCRIPT_KIND_COLOR[e.kind],
      }),
    );
  }
  // Zeilenumbrüche im Text als Umbruch im selben Absatz: roh in <w:t> lesen Word und MAXQDA sie als
  // Leerzeichen, ein eigener Absatz bekäme eine zweite Zeitmarke.
  e.body
    .split(/\r?\n/)
    .forEach((line, i) =>
      runs.push(new TextRun({ text: line, italics: e.kind === "card", break: i > 0 ? 1 : undefined })),
    );
  const out = [new Paragraph({ children: runs, spacing: { before: e.kind === "episode" ? 240 : 60 } })];
  out.push(...imageParagraphs(e.images, stills, width));
  return out;
}

/** Je Bild ein Absatz; fehlt das Standbild (null), steht dort ein Hinweis auf die Originaldatei. */
function imageParagraphs(images: ImageRef[], stills: (Still | null)[], width: number): Paragraph[] {
  const out: Paragraph[] = [];
  images.forEach((ref, i) => {
    const s = stills[i];
    if (!s) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[Scan ${ref.region ? `S. ${ref.region.page + 1} ` : ""}nicht eingebettet, siehe Originaldatei]`,
              italics: true,
              color: "6B7A80",
            }),
          ],
        }),
      );
      return;
    }
    const w = Math.min(width, s.width);
    out.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: "jpg",
            data: s.data,
            transformation: { width: w, height: Math.round((s.height / s.width) * w) },
          }),
        ],
      }),
    );
  });
  return out;
}

/** Ein Kontextstück: Kopfzeile ohne Zeitmarke, Bilder, Text mit weichen Zeilenumbrüchen. */
function contextParagraphs(c: SessionTranscriptContext, stills: (Still | null)[], width: number): Paragraph[] {
  const out = [
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: c.head, bold: true, color: SESSION_TRANSCRIPT_CONTEXT_COLOR }),
        ...(c.details ? [new TextRun({ text: c.details, color: SESSION_TRANSCRIPT_CLOCK_COLOR })] : []),
      ],
    }),
    ...imageParagraphs(c.images, stills, width),
  ];
  if (c.body)
    out.push(
      new Paragraph({
        children: c.body.split(/\r?\n/).map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined })),
      }),
    );
  return out;
}

/** Abschnitt „Kontext“ vor der ersten Zeitmarke; ohne Kontext nichts (das Dokument bleibt wie bisher). */
function contextSection(transcript: SessionTranscript, opts: DocxOptions, width: number): Paragraph[] {
  if (!transcript.context.length) return [];
  return [
    new Paragraph({ text: "Kontext", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Diese Stücke gehören nicht in die Chronologie und haben keine Zeitmarke.",
          color: SESSION_TRANSCRIPT_CLOCK_COLOR,
          size: 20,
        }),
      ],
    }),
    ...transcript.context.flatMap((c) => contextParagraphs(c, opts.contextStills?.get(c) ?? [], width)),
    new Paragraph({ text: "" }),
    new Paragraph({ text: "Chronologie", heading: HeadingLevel.HEADING_2 }),
  ];
}

/** Hinweiszeile im Kopf, wenn es Kontext gibt. */
export function contextHeaderLine(count: number | undefined): string {
  if (!count) return "";
  return `Kontext: ${count} ${count === 1 ? "Stück" : "Stücke"} ohne Zeitmarke, vor der Chronologie.`;
}

/** Das ganze Dokument als Bytes: Titel, Kopfangaben, Abschnitt „Kontext“ (falls vorhanden), dann Chronologie. */
export async function sessionTranscriptDocx(transcript: SessionTranscript, opts: DocxOptions): Promise<Buffer> {
  const h = transcript.header;
  const [y, m, d] = h.date.split("-");
  const meta = [
    `Feldtag: ${d}.${m}.${y}${h.place ? `, ${h.place}` : ""}`,
    h.researchers.length ? `Forschende: ${h.researchers.join(", ")}` : "",
    h.reference ? `Referenzuhr: ${h.reference}` : "",
    `Mediendatei: ${opts.mediaFileName} (Montage-ID ${h.montageId}, ${h.modeLabel})`,
    h.sources.length ? `Quellen: ${h.sources.join(", ")}` : "",
    ...Object.entries(h.extra)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v}`),
    ...(h.dataset ?? []).map(([k, v]) => `${k}: ${v}`),
    contextHeaderLine(h.contextCount),
    "Zeitmarken = Stelle im Montagevideo; die Uhrzeit steht jeweils dahinter.",
  ].filter(Boolean);
  const width = opts.imageWidth ?? 420;
  const doc = new Document({
    creator: "Feldspur",
    title: `${h.title} ${h.date}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({ text: `${h.title} · ${d}.${m}.${y}`, heading: HeadingLevel.HEADING_1 }),
          ...meta.map(
            (t) =>
              new Paragraph({
                children: [new TextRun({ text: t, color: SESSION_TRANSCRIPT_CLOCK_COLOR, size: 20 })],
                alignment: AlignmentType.LEFT,
              }),
          ),
          new Paragraph({ text: "" }),
          ...contextSection(transcript, opts, width),
          ...transcript.entries.flatMap((e) => entryParagraphs(e, opts.stills.get(e) ?? [], width)),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
