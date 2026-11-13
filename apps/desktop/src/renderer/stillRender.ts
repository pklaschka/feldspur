/**
 * Foto oder Scan-Ausschnitt (auch PDF-Seiten) als Bild: für die Montage in der App und für die
 * Ausgabe, weil ffmpeg keine PDFs lesen kann. Ein Rahmen (relative Koordinaten) schneidet aus.
 */
import type { ImageRef } from "@feldspur/media";
import { mediaUrl } from "../shared/api.ts";
import { loadPdf } from "./pdf.tsx";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild nicht lesbar"));
    img.src = url;
  });
}

/** Zeichnet den Ausschnitt höchstens maxW breit in eine neue Leinwand. */
export async function renderImageRef(ref: ImageRef, pdf: boolean, maxW = 1000): Promise<HTMLCanvasElement> {
  const r = ref.region ?? { page: 0, x: 0, y: 0, w: 1, h: 1 };
  let src: CanvasImageSource;
  let sw: number;
  let sh: number;
  if (pdf) {
    const doc = await loadPdf(ref.sourceId);
    const page = await doc.getPage(Math.min(doc.numPages, (r.page ?? 0) + 1));
    const base = page.getViewport({ scale: 1 });
    // So groß rendern, dass der Ausschnitt maxW Bildpunkte breit wird (höchstens 4-fach).
    const scale = Math.min(4, Math.max(1, maxW / (base.width * r.w)));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvas: c, viewport: vp }).promise;
    src = c;
    sw = c.width;
    sh = c.height;
  } else {
    const img = await loadImage(mediaUrl(ref.sourceId));
    src = img;
    sw = img.naturalWidth;
    sh = img.naturalHeight;
  }
  const cw = sw * r.w;
  const ch = sh * r.h;
  const k = Math.min(1, maxW / cw);
  const out = document.createElement("canvas");
  out.width = Math.max(2, Math.round((cw * k) / 2) * 2);
  out.height = Math.max(2, Math.round((ch * k) / 2) * 2);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, sw * r.x, sh * r.y, cw, ch, 0, 0, out.width, out.height);
  return out;
}

/** Als JPEG für die Ausgabe. */
export async function renderImageRefJpeg(ref: ImageRef, pdf: boolean, maxW = 1000): Promise<Uint8Array> {
  const c = await renderImageRef(ref, pdf, maxW);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.88));
  if (!blob) throw new Error("JPEG nicht erzeugt");
  return new Uint8Array(await blob.arrayBuffer());
}
