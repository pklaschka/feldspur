/**
 * Zeitgerüst als .docx für MAXQDA. Zeitmarken im Format #hh:mm:ss-z# (im Test von Zuri erkannt),
 * jede Zeile ein eigener Absatz, Bilder direkt unter ihrer Zeile.
 */
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { timestamp, type Scaffold, type ScaffoldEntry } from "./scaffold.ts";
import type { Still } from "./stills.ts";

export interface DocxOptions {
  /** Dateiname des Montagevideos, auf das sich die Zeitmarken beziehen. */
  mediaFileName: string;
  /** Standbilder je Eintrag (gleiche Reihenfolge wie entry.images); null = nicht darstellbar. */
  stills: Map<ScaffoldEntry, (Still | null)[]>;
  /** Breite der Bilder im Dokument in px (96 dpi). */
  imageWidth?: number;
}

const KIND_COLOR: Partial<Record<ScaffoldEntry["kind"], string>> = {
  card: "6B7A80",
  episode: "1D2B33",
  start: "2A52BE",
  photo: "8A4FBF",
  diary: "A8571F",
  sync: "107A5F",
};

function entryParagraphs(e: ScaffoldEntry, stills: (Still | null)[], width: number): Paragraph[] {
  const runs: TextRun[] = [new TextRun({ text: `${timestamp(e.montageMs)} ` })];
  if (e.clock) runs.push(new TextRun({ text: `Uhrzeit ${e.clock} · `, color: "5F6B73" }));
  if (e.head) {
    runs.push(
      new TextRun({
        text: e.kind === "line" ? `${e.head} · ` : `${e.head}: `,
        bold: e.kind !== "line",
        color: KIND_COLOR[e.kind],
      }),
    );
  }
  runs.push(new TextRun({ text: e.body, italics: e.kind === "card" }));
  const out = [new Paragraph({ children: runs, spacing: { before: e.kind === "episode" ? 240 : 60 } })];
  e.images.forEach((ref, i) => {
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

export async function scaffoldDocx(sc: Scaffold, opts: DocxOptions): Promise<Buffer> {
  const h = sc.header;
  const [y, m, d] = h.date.split("-");
  const meta = [
    `Feldtag: ${d}.${m}.${y}${h.place ? `, ${h.place}` : ""}`,
    h.researchers.length ? `Forschende: ${h.researchers.join(", ")}` : "",
    h.reference ? `Referenzuhr: ${h.reference}` : "",
    `Mediendatei: ${opts.mediaFileName}`,
    h.sources.length ? `Quellen: ${h.sources.join(", ")}` : "",
    ...Object.entries(h.extra)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v}`),
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
                children: [new TextRun({ text: t, color: "5F6B73", size: 20 })],
                alignment: AlignmentType.LEFT,
              }),
          ),
          new Paragraph({ text: "" }),
          ...sc.entries.flatMap((e) => entryParagraphs(e, opts.stills.get(e) ?? [], width)),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
