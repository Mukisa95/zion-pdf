/** Only embedded fonts that permit editable documents may be used for content editing. */
export type EmbeddingRights = { editable: boolean; maySubset: boolean; reason?: string };

export function embeddingRights(bytes: Uint8Array): EmbeddingRights {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return { editable: false, maySubset: false, reason: "Invalid font file" };
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565)
    return { editable: false, maySubset: false, reason: "Font collections and this font format are not supported yet" };
  const count = view.getUint16(4);
  if (count > 4096 || 12 + count * 16 > bytes.byteLength) return { editable: false, maySubset: false, reason: "Invalid font table directory" };
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    if (view.getUint32(entry) !== 0x4f532f32) continue;
    const offset = view.getUint32(entry + 8), length = view.getUint32(entry + 12);
    if (length < 10 || offset > bytes.byteLength - length) return { editable: false, maySubset: false, reason: "Invalid font permissions" };
    const type = view.getUint16(offset + 8);
    const permission = type & 0x000e;
    if ((type & 0x0200) !== 0) return { editable: false, maySubset: false, reason: "This font only permits bitmap embedding" };
    if (permission !== 0 && permission !== 8) return { editable: false, maySubset: false, reason: "This font does not permit editable embedding" };
    return { editable: true, maySubset: (type & 0x0100) === 0 };
  }
  return { editable: false, maySubset: false, reason: "Font embedding permissions are unavailable" };
}

export interface LocalFontFace {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

/** Must be called from an explicit user action. No font data leaves the device. */
export async function listLocalFonts(): Promise<LocalFontFace[]> {
  const query = (window as Window & { queryLocalFonts?: () => Promise<LocalFontFace[]> }).queryLocalFonts;
  if (!query) throw new Error("Device fonts are unavailable in this environment.");
  const fonts = await query.call(window);
  return fonts.filter(face => face && typeof face.family === "string" && typeof face.style === "string" && typeof face.fullName === "string" && typeof face.postscriptName === "string"
    && typeof face.blob === "function").sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
}

export async function readEditableFont(face: LocalFontFace): Promise<{ bytes: Uint8Array; maySubset: boolean }> {
  const blob = await face.blob();
  if (blob.size > 64 * 1024 * 1024) throw new Error("The selected font is too large.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rights = embeddingRights(bytes);
  if (!rights.editable) throw new Error(rights.reason || "This font cannot be embedded.");
  return { bytes, maySubset: rights.maySubset };
}

/** Check the Unicode cmap rather than assuming that a system font covers Latin text. */
export function hasFontCharacters(bytes: Uint8Array, text: string): boolean {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(4);
    if (count > 4096) return false;
    let cmap = 0, length = 0;
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      if (view.getUint32(entry) === 0x636d6170) { cmap = view.getUint32(entry + 8); length = view.getUint32(entry + 12); break; }
    }
    if (!cmap || length < 4 || cmap + length > bytes.length) return false;
    const tables = view.getUint16(cmap + 2);
    if (tables > 256 || 4 + tables * 8 > length) return false;
    const subtables: number[] = [];
    for (let i = 0; i < tables; i++) {
      const entry = cmap + 4 + i * 8;
      const platform = view.getUint16(entry), encoding = view.getUint16(entry + 2), offset = view.getUint32(entry + 4);
      if ((platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) && offset < length - 2) subtables.push(cmap + offset);
    }
    const covers = (code: number, table: number) => {
      const format = view.getUint16(table);
      if (format === 4 && code <= 0xffff) {
        const size = view.getUint16(table + 2), segCount = view.getUint16(table + 6) / 2;
        if (size < 16 || table + size > cmap + length || !segCount || 16 + 8 * segCount > size) return false;
        const ends = table + 14, starts = ends + 2 * segCount + 2, deltas = starts + 2 * segCount, ranges = deltas + 2 * segCount;
        for (let i = 0; i < segCount; i++) {
          if (code < view.getUint16(starts + 2 * i) || code > view.getUint16(ends + 2 * i)) continue;
          const delta = view.getInt16(deltas + 2 * i), range = view.getUint16(ranges + 2 * i);
          if (!range) return ((code + delta) & 0xffff) !== 0;
          const glyphPtr = ranges + 2 * i + range + 2 * (code - view.getUint16(starts + 2 * i));
          if (glyphPtr + 2 > table + size) return false;
          const glyph = view.getUint16(glyphPtr);
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
      }
      if (format === 12) {
        const size = view.getUint32(table + 4), groups = view.getUint32(table + 12);
        if (size < 16 || table + size > cmap + length || groups > Math.floor((size - 16) / 12)) return false;
        for (let i = 0; i < groups; i++) {
          const pos = table + 16 + i * 12, start = view.getUint32(pos), end = view.getUint32(pos + 4);
          if (code >= start && code <= end) return view.getUint32(pos + 8) + code - start !== 0;
        }
      }
      return false;
    };
    return [...text].every(char => subtables.some(table => covers(char.codePointAt(0)!, table)));
  } catch { return false; }
}

/** PDF subset prefixes and vendor punctuation do not change the installed face name. */
export function matchLocalFont(faces: LocalFontFace[], name = ""): LocalFontFace | undefined {
  const normalize = (value: string) => value.replace(/^[A-Z]{6}\+/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const wanted = normalize(name);
  if (!wanted) return undefined;
  const aliases: Record<string, string[]> = { helvetica: ["Arial", "Liberation Sans", "DejaVu Sans"], timesroman: ["Times New Roman", "Liberation Serif", "DejaVu Serif"], courier: ["Courier New", "Liberation Mono", "DejaVu Sans Mono"] };
  return faces.find(face => [face.postscriptName, face.fullName, `${face.family}${face.style}`].some(value => normalize(value) === wanted))
    ?? faces.find(face => normalize(face.family) === wanted && /regular|normal|book/i.test(face.style))
    ?? aliases[wanted]?.map(family => faces.find(face => normalize(face.family) === normalize(family) && /regular|normal|book/i.test(face.style))).find(Boolean);
}
/** PDF font sizes are multiplied by the text matrix; limits apply to the visible point size. */
export function validFontSize(size:number,scale=1):boolean {
  const points=size*Math.abs(scale);
  return Number.isFinite(size)&&size>0&&Number.isFinite(points)&&points>=1-0.00001&&points<=300+0.00001;
}

