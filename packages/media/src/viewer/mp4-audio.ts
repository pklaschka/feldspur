/**
 * Tonspuren einer MP4-Datei lesen: Name, Format und wo jedes Tonpaket in der Datei liegt. Damit spielt der Viewer
 * die Gerätespuren einzeln ab (WebCodecs), denn Chrome und Firefox spielen aus einem Video nur die erste Tonspur.
 *
 * Läuft im Browser (eingebettet in den Viewer) und in Node (Tests). Deshalb ganz ohne Importe und ohne Bezüge
 * nach außen: Der Viewer bettet die Funktion über Function#toString ein.
 */

export interface Mp4AudioTrack {
  /** Reihenfolge der Tonspuren in der Datei, ab 0. */
  index: number;
  trackId: number;
  /** Name der Spur (handler_name), z. B. „Mischung aller Geräte“ oder „Audiorekorder ZOOM“. */
  title: string;
  /** z. B. „mp4a.40.2“ (AAC-LC). */
  codec: string;
  /** AudioSpecificConfig aus esds, für AudioDecoder.configure({ description }). */
  config: Uint8Array | null;
  sampleRate: number;
  channels: number;
  /** Je Tonpaket: Lage in der Datei und Beginn in Sekunden Videozeit (Schnittliste schon eingerechnet). */
  offsets: Float64Array;
  sizes: Uint32Array;
  times: Float64Array;
  /** Länge eines Pakets in Sekunden (das letzte reicht bis hierhin). */
  durations: Float64Array;
}

export interface Mp4AudioInfo {
  durationS: number;
  /** Gesamtzahl der Spuren (Bild und Ton). */
  trackCount: number;
  audio: Mp4AudioTrack[];
}

/**
 * Liest den moov-Kasten über `read(offset, length)` (im Browser: File#slice, in Node: Buffer#subarray).
 * Wirft, wenn die Datei kein MP4 ist oder kein moov hat.
 */
export async function readMp4Audio(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
): Promise<Mp4AudioInfo> {
  const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
  const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);
  const i32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
  const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

  // Oberste Ebene: nur Kopfzeilen lesen, bis moov gefunden ist (mit +faststart steht es vorn).
  let pos = 0;
  let moov: Uint8Array | null = null;
  while (pos + 8 <= size) {
    const h = await read(pos, Math.min(16, size - pos));
    let len = u32(h, 0);
    let head = 8;
    if (len === 1) {
      len = u64(h, 8);
      head = 16;
    } else if (len === 0) len = size - pos;
    if (len < head) throw new Error("Keine gültige MP4-Datei");
    if (type(h, 4) === "moov") {
      moov = await read(pos + head, len - head);
      break;
    }
    pos += len;
  }
  if (!moov) throw new Error("Keine MP4-Datei (moov fehlt)");

  /** Kinder eines Kastens: [Typ, Beginn des Inhalts, Ende]. */
  const kids = (b: Uint8Array, from: number, to: number): [string, number, number][] => {
    const out: [string, number, number][] = [];
    let p = from;
    while (p + 8 <= to) {
      let len = u32(b, p);
      let head = 8;
      if (len === 1) {
        len = u64(b, p + 8);
        head = 16;
      } else if (len === 0) len = to - p;
      if (len < head || p + len > to) break;
      out.push([type(b, p + 4), p + head, p + len]);
      p += len;
    }
    return out;
  };
  const find = (b: Uint8Array, from: number, to: number, path: string[]): [number, number] | null => {
    let range: [number, number] = [from, to];
    for (const name of path) {
      const k = kids(b, range[0], range[1]).find((x) => x[0] === name);
      if (!k) return null;
      range = [k[1], k[2]];
    }
    return range;
  };

  const m = moov;
  const top = kids(m, 0, m.length);
  const mvhd = top.find((k) => k[0] === "mvhd");
  let movieScale = 1000;
  let durationS = 0;
  if (mvhd) {
    const o = mvhd[1];
    const v = m[o]!;
    movieScale = v === 1 ? u32(m, o + 20) : u32(m, o + 12);
    durationS = (v === 1 ? u64(m, o + 24) : u32(m, o + 16)) / movieScale;
  }

  const traks = top.filter((k) => k[0] === "trak");
  const audio: Mp4AudioTrack[] = [];
  for (const [, from, to] of traks) {
    const hdlr = find(m, from, to, ["mdia", "hdlr"]);
    if (!hdlr || type(m, hdlr[0] + 8) !== "soun") continue;
    // Name: nullterminiert nach 24 Byte (bei QuickTime mit Längenbyte davor).
    let nameBytes = m.subarray(hdlr[0] + 24, hdlr[1]);
    if (nameBytes.length && nameBytes[0] === nameBytes.length - 1) nameBytes = nameBytes.subarray(1);
    const zero = nameBytes.indexOf(0);
    const title = new TextDecoder().decode(zero >= 0 ? nameBytes.subarray(0, zero) : nameBytes).trim();

    const tkhd = find(m, from, to, ["tkhd"]);
    const trackId = tkhd ? u32(m, tkhd[0] + (m[tkhd[0]]! === 1 ? 20 : 12)) : 0;
    const mdhd = find(m, from, to, ["mdia", "mdhd"]);
    if (!mdhd) continue;
    const scale = m[mdhd[0]]! === 1 ? u32(m, mdhd[0] + 20) : u32(m, mdhd[0] + 12);

    // Schnittliste: leere Einträge verschieben nach hinten, media_time schneidet vorn ab (AAC-Vorlauf).
    let delayS = 0;
    let mediaStart = 0;
    const elst = find(m, from, to, ["edts", "elst"]);
    if (elst) {
      const v = m[elst[0]]!;
      const n = u32(m, elst[0] + 4);
      let o = elst[0] + 8;
      for (let i = 0; i < n; i++) {
        const segDur = v === 1 ? u64(m, o) : u32(m, o);
        const mediaTime = v === 1 ? u64(m, o + 8) - (m[o + 8]! & 0x80 ? 2 ** 64 : 0) : i32(m, o + 4);
        o += v === 1 ? 20 : 12;
        if (mediaTime === -1) delayS += segDur / movieScale;
        else {
          mediaStart = mediaTime;
          break;
        }
      }
    }

    const stbl = find(m, from, to, ["mdia", "minf", "stbl"]);
    if (!stbl) continue;
    const box = (name: string): [number, number] | undefined => {
      const k = kids(m, stbl[0], stbl[1]).find((x) => x[0] === name);
      return k ? [k[1], k[2]] : undefined;
    };

    // Format aus stsd: mp4a mit esds → AudioSpecificConfig.
    let codec = "";
    let config: Uint8Array | null = null;
    let sampleRate = 0;
    let channels = 0;
    const stsd = box("stsd");
    if (stsd) {
      const e = stsd[0] + 8;
      const entryEnd = e + u32(m, e);
      const fmt = type(m, e + 4);
      const ver = u16(m, e + 16);
      channels = u16(m, e + 24);
      sampleRate = u32(m, e + 32) >>> 16;
      const childFrom = e + 36 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
      codec = fmt;
      if (fmt === "mp4a") {
        const esds = kids(m, childFrom, entryEnd).find((k) => k[0] === "esds");
        if (esds) {
          let p = esds[1] + 4;
          const len = () => {
            let n = 0;
            for (let i = 0; i < 4; i++) {
              const c = m[p++]!;
              n = (n << 7) | (c & 0x7f);
              if (!(c & 0x80)) break;
            }
            return n;
          };
          let oti = 0;
          while (p < esds[2]) {
            const tag = m[p++]!;
            const l = len();
            if (tag === 0x03) {
              const flags = m[p + 2]!;
              p += 3;
              if (flags & 0x80) p += 2;
              if (flags & 0x40) p += 1 + m[p]!;
              if (flags & 0x20) p += 2;
            } else if (tag === 0x04) {
              oti = m[p]!;
              p += 13;
            } else if (tag === 0x05) {
              config = m.slice(p, p + l);
              break;
            } else p += l;
          }
          const aot = config && config.length ? config[0]! >> 3 : 2;
          codec = `mp4a.${oti.toString(16)}.${aot}`;
        }
      }
    }

    // Lage der Pakete: Größen (stsz), Blöcke (stsc + stco/co64), Zeiten (stts).
    const stsz = box("stsz");
    const stsc = box("stsc");
    const co64 = box("co64");
    const stco = box("stco") ?? co64;
    const stts = box("stts");
    if (!stsz || !stsc || !stco || !stts) continue;
    const fixed = u32(m, stsz[0] + 4);
    const count = u32(m, stsz[0] + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(m, stsz[0] + 12 + 4 * i);

    const wide = stco === co64;
    const chunkCount = u32(m, stco[0] + 4);
    const chunkOffset = (c: number) => (wide ? u64(m, stco[0] + 8 + 8 * c) : u32(m, stco[0] + 8 + 4 * c));
    const runs = u32(m, stsc[0] + 4);
    const offsets = new Float64Array(count);
    let s = 0;
    for (let r = 0; r < runs; r++) {
      const o = stsc[0] + 8 + 12 * r;
      const first = u32(m, o) - 1;
      const per = u32(m, o + 4);
      const last = r + 1 < runs ? u32(m, o + 12) - 1 : chunkCount;
      for (let c = first; c < last && s < count; c++) {
        let at = chunkOffset(c);
        for (let k = 0; k < per && s < count; k++) {
          offsets[s] = at;
          at += sizes[s]!;
          s++;
        }
      }
    }

    const times = new Float64Array(count);
    const durations = new Float64Array(count);
    const entries = u32(m, stts[0] + 4);
    let t = 0;
    s = 0;
    for (let i = 0; i < entries; i++) {
      const n = u32(m, stts[0] + 8 + 8 * i);
      const d = u32(m, stts[0] + 12 + 8 * i);
      for (let k = 0; k < n && s < count; k++) {
        times[s] = delayS + (t - mediaStart) / scale;
        durations[s] = d / scale;
        t += d;
        s++;
      }
    }

    audio.push({
      index: audio.length,
      trackId,
      title,
      codec,
      config,
      sampleRate,
      channels,
      offsets,
      sizes,
      times,
      durations,
    });
  }
  return { durationS, trackCount: traks.length, audio };
}
