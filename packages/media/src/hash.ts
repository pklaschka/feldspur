import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** SHA-256 einer Datei, gestreamt (auch für mehrstündige Videos). */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
