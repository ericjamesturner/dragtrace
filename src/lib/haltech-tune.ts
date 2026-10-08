/**
 * Read the tune out of a Haltech NSP `.hlgzip`.
 *
 * Nesting, outermost first:
 *   .hlgzip   HEPS envelope (AES-256-CBC, key from PBKDF2 of a fixed password)
 *   └ ZIP     holds the .hlg datalog and a .nexmap
 *     └ .nexmap   another ZIP, its entries WinZip-AES-256 encrypted
 *       └ _map    the tune, as XML: <MetaData> plus one <G id=…> per setting
 *
 * Self-contained, and nothing here leaves the browser: the tune is decrypted
 * and read locally. Format notes and the passwords' origin are in the
 * companion haltech project (FORMAT.md, hlgzip.py).
 */

export interface TuneMeta {
  serial: string;
  /** ECU family and model, e.g. 20/3 for a Nexus R5. Selects the definition. */
  product: number;
  variant: number;
  firmware: string;
  /** MD5 of the encrypted definition the tune was built against. */
  hdefMd5: string;
  /** The tune's own name, set in NSP. */
  profileName: string;
}

export interface Tune {
  meta: TuneMeta;
  /** Object id -> raw big-endian payload, as hex. */
  values: Map<number, string>;
}

const SALT = new TextEncoder().encode("35osnfivndufue");
const PASSWORD = {
  container: "3EEBEB31F9E48875C92EE99475B60585",
  map: "F974C0B7F6C02748249C0722B8BCAD10",
};

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-1" }, key, bytes * 8),
  );
}

const isHeps = (b: Uint8Array) => b[0] === 0x48 && b[1] === 0x45 && b[2] === 0x50 && b[3] === 0x53;
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

async function hepsDecrypt(bytes: Uint8Array): Promise<Uint8Array> {
  const ivLength = bytes[5] | (bytes[6] << 8) | (bytes[7] << 16) | (bytes[8] << 24);
  const iv = bytes.slice(9, 9 + ivLength);
  const ciphertext = bytes.slice(9 + ivLength);
  const raw = await pbkdf2(PASSWORD.container, SALT, 32);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext));
}

/**
 * AES-256 block encryption, for the WinZip-AES keystream. WinZip runs AES in
 * CTR mode with a little-endian counter starting at 1, which WebCrypto's
 * AES-CTR (big-endian counter) can't produce, and one WebCrypto call per
 * 16-byte block is far too slow for a megabyte tune. Ported from the
 * companion haltech project's explorer, where it is checked against the
 * FIPS-197 AES-256 vector.
 */
const AES = (() => {
  const S = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
    S[p] = x ^ 0x63;
  } while (p !== 1);
  S[0] = 0x63;
  const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];
  const xt = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;

  function expand(key: Uint8Array) {
    const nk = key.length / 4;
    const nr = nk + 6;
    const w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    for (let i = nk; i < 4 * (nr + 1); i++) {
      const t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
      if (i % nk === 0) {
        t.push(t.shift()!);
        for (let j = 0; j < 4; j++) t[j] = S[t[j]];
        t[0] ^= RCON[i / nk - 1];
      } else if (nk > 6 && i % nk === 4) {
        for (let j = 0; j < 4; j++) t[j] = S[t[j]];
      }
      for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j] ^ t[j];
    }
    return { w, nr };
  }

  function encryptBlock(input: Uint8Array, out: Uint8Array, ks: { w: Uint8Array; nr: number }) {
    const { w, nr } = ks;
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = input[i] ^ w[i];
    for (let r = 1; r <= nr; r++) {
      for (let i = 0; i < 16; i++) s[i] = S[s[i]];
      // ShiftRows (column-major state: byte index = 4*col + row)
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (r !== nr) {
        for (let c = 0; c < 4; c++) {
          const o = c * 4;
          const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
          const all = a0 ^ a1 ^ a2 ^ a3;
          s[o] = a0 ^ all ^ xt(a0 ^ a1);
          s[o + 1] = a1 ^ all ^ xt(a1 ^ a2);
          s[o + 2] = a2 ^ all ^ xt(a2 ^ a3);
          s[o + 3] = a3 ^ all ^ xt(a3 ^ a0);
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    out.set(s);
  }
  return { expand, encryptBlock };
})();

function winzipAesDecrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const ks = AES.expand(key);
  const counter = new Uint8Array(16);
  const stream = new Uint8Array(16);
  const out = new Uint8Array(data.length);
  let n = 0;
  for (let off = 0; off < data.length; off += 16) {
    n++;
    let v = n;
    for (let i = 0; i < 16; i++) {
      counter[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    AES.encryptBlock(counter, stream, ks);
    const lim = Math.min(16, data.length - off);
    for (let i = 0; i < lim; i++) out[off + i] = data[off + i] ^ stream[i];
  }
  return out;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
}

function readZip(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The archive inside this file is damaged.");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const localOffset = u32(bytes, p + 42);
    const extra = bytes.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
    entries.push({ name, read: () => readEntry(bytes, { method, compressedSize, localOffset, extra }) });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(
  bytes: Uint8Array,
  e: { method: number; compressedSize: number; localOffset: number; extra: Uint8Array },
): Promise<Uint8Array> {
  const start = e.localOffset + 30 + u16(bytes, e.localOffset + 26) + u16(bytes, e.localOffset + 28);
  let data = bytes.subarray(start, start + e.compressedSize);
  let method = e.method;
  if (method === 99) {
    // WinZip AES: the real method and key strength sit in extra field 0x9901.
    let strength = 3;
    let realMethod = 8;
    for (let i = 0; i + 4 <= e.extra.length; ) {
      const id = u16(e.extra, i);
      const size = u16(e.extra, i + 2);
      if (id === 0x9901) {
        strength = e.extra[i + 8];
        realMethod = u16(e.extra, i + 9);
      }
      i += 4 + size;
    }
    const saltLength = [8, 12, 16][strength - 1];
    const keyLength = [16, 24, 32][strength - 1];
    const salt = data.slice(0, saltLength);
    const body = data.subarray(saltLength + 2, data.length - 10);
    const bits = await pbkdf2(PASSWORD.map, salt, keyLength * 2 + 2);
    data = winzipAesDecrypt(body, bits.slice(0, keyLength));
    method = realMethod;
  }
  return method === 0 ? data : inflateRaw(data);
}

function metaField(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1].trim() : "";
}

/** Hex-encoded ASCII, NUL padded -> text. */
function hexText(hex: string): string {
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

export function parseTuneXml(xml: string): Tune {
  const meta: TuneMeta = {
    serial: metaField(xml, "SerialNumber"),
    product: parseInt(metaField(xml, "Framework"), 16) || 0,
    variant: parseInt(metaField(xml, "Variant"), 16) || 0,
    firmware: hexText(metaField(xml, "Version")).split(":")[0],
    hdefMd5: metaField(xml, "HDEF_MD5").toUpperCase(),
    profileName: hexText(metaField(xml, "ProfileName")),
  };
  const values = new Map<number, string>();
  const data = xml.slice(xml.indexOf("<Data"));
  const re = /<G\s+id="(\d+)"(?:\s+attrId="(\d+)")?[^>]*>([^<]*)<\/G>/g;
  for (let m = re.exec(data); m; m = re.exec(data)) {
    // attrId 0 is the value itself; other attributes (limits, lengths) are
    // properties of the definition, not the tune.
    if (m[2] && m[2] !== "0") continue;
    values.set(Number(m[1]), m[3].trim().toUpperCase());
  }
  if (values.size === 0) throw new Error("This file's tune has no settings in it.");
  return { meta, values };
}

/** The tune inside an .hlgzip (or a bare .nexmap, or an extracted _map). */
export async function readTune(input: ArrayBuffer): Promise<Tune> {
  let bytes: Uint8Array = new Uint8Array(input);
  if (isHeps(bytes)) bytes = await hepsDecrypt(bytes);
  if (!isZip(bytes)) return parseTuneXml(new TextDecoder().decode(bytes));

  let entries = readZip(bytes);
  const nexmap = entries.find((e) => e.name.toLowerCase().endsWith(".nexmap"));
  if (nexmap) entries = readZip(await nexmap.read());
  const map = entries.find((e) => e.name === "_map") ?? entries.find((e) => e.name.endsWith("_map"));
  if (!map) throw new Error("This file has no tune in it — NSP saved it without the map.");
  return parseTuneXml(new TextDecoder().decode(await map.read()));
}
