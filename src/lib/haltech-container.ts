/** Read the HEPS/ZIP envelope used by Haltech NSP log exports. Embedded tune
 * files are intentionally left alone; only the .hlg datalogs are returned. */

const HEPS_MAGIC = [0x48, 0x45, 0x50, 0x53, 0x00];
const MAX_CONTAINER_BYTES = 256 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_LOG_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_LOGS = 128;

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  CRC_TABLE[i] = value;
}

interface ZipLogEntry {
  name: string;
  nameBytes: Uint8Array<ArrayBuffer>;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function requireRange(offset: number, size: number, limit: number, label: string) {
  if (offset < 0 || size < 0 || offset > limit || size > limit - offset) {
    throw new Error(`The Haltech archive is truncated or has an invalid ${label}.`);
  }
}

async function decryptHeps(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Opening .hlgzip files requires browser cryptography. Use a modern browser on HTTPS or localhost.");
  }
  requireRange(0, 9, bytes.byteLength, "HEPS header");
  const view = new DataView(bytes);
  if (view.getUint32(5, true) !== 16) {
    throw new Error("The Haltech archive has an invalid AES initialization vector.");
  }
  requireRange(9, 16, bytes.byteLength, "HEPS initialization vector");
  const ciphertextSize = bytes.byteLength - 25;
  if (ciphertextSize === 0 || ciphertextSize % 16 !== 0) {
    throw new Error("The Haltech archive has truncated or invalid encrypted data.");
  }

  const encoder = new TextEncoder();
  const password = await crypto.subtle.importKey(
    "raw",
    encoder.encode("3EEBEB31F9E48875C92EE99475B60585"),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-1",
      salt: encoder.encode("35osnfivndufue"),
      iterations: 1000,
    },
    password,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    // WebCrypto verifies and removes the PKCS#7 padding itself.
    return await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: bytes.slice(9, 25) },
      key,
      bytes.slice(25),
    );
  } catch {
    throw new Error("Could not decrypt the Haltech archive. It may be damaged or use an unsupported encryption format.");
  }
}

function readZipDirectory(bytes: ArrayBuffer): { entries: ZipLogEntry[]; directoryOffset: number } {
  const view = new DataView(bytes);
  const archive = new Uint8Array(bytes);
  // The end record is followed by at most 65,535 bytes of archive comment.
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 22 - 0xffff); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("The Haltech archive does not contain a complete ZIP directory.");
  }
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("ZIP64 Haltech archives are not supported.");
  }
  if (view.getUint16(endOffset + 4, true) !== 0 ||
      view.getUint16(endOffset + 6, true) !== 0 ||
      view.getUint16(endOffset + 8, true) !== entryCount) {
    throw new Error("Split ZIP Haltech archives are not supported.");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`The Haltech archive contains too many entries (maximum ${MAX_ARCHIVE_ENTRIES}).`);
  }
  requireRange(directoryOffset, directorySize, endOffset, "ZIP directory");

  const directoryEnd = directoryOffset + directorySize;
  const entries: ZipLogEntry[] = [];
  let offset = directoryOffset;
  let totalSize = 0;
  for (let i = 0; i < entryCount; i++) {
    requireRange(offset, 46, directoryEnd, "ZIP entry header");
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The Haltech archive has an invalid ZIP entry header.");
    }
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    requireRange(offset + 46, nameSize + extraSize + commentSize, directoryEnd, "ZIP entry name");
    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameSize);
    // NSP writes ASCII/UTF-8 log names. The extension is ASCII in older ZIPs too.
    const path = new TextDecoder().decode(nameBytes);
    if (/\.hlg$/i.test(path)) {
      const name = path.split(/[\\/]/).pop()!;
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const crc = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (view.getUint16(offset + 34, true) !== 0) {
        throw new Error("Split ZIP Haltech archives are not supported.");
      }
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("ZIP64 Haltech logs are not supported.");
      }
      if (flags & (0x0001 | 0x0040 | 0x2000)) {
        throw new Error(`The log "${name}" has unsupported ZIP encryption.`);
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`The log "${name}" uses unsupported ZIP compression (method ${method}).`);
      }
      if (size > MAX_LOG_BYTES) {
        throw new Error(`The log "${name}" exceeds the 256 MB import limit.`);
      }
      totalSize += size;
      if (totalSize > MAX_TOTAL_LOG_BYTES || entries.length >= MAX_LOGS) {
        throw new Error("The Haltech archive exceeds the import limit of 128 logs or 512 MB of log data.");
      }
      entries.push({ name, nameBytes, flags, method, crc, compressedSize, size, localOffset });
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
  if (offset !== directoryEnd) {
    throw new Error("The Haltech archive has an inconsistent ZIP directory size.");
  }
  if (entries.length === 0) {
    throw new Error("The Haltech archive contains no .hlg datalogs.");
  }
  return { entries, directoryOffset };
}

function readCompressedLog(bytes: ArrayBuffer, entry: ZipLogEntry, directoryOffset: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes);
  const offset = entry.localOffset;
  requireRange(offset, 30, directoryOffset, "ZIP local header");
  if (view.getUint32(offset, true) !== 0x04034b50 ||
      view.getUint16(offset + 6, true) !== entry.flags ||
      view.getUint16(offset + 8, true) !== entry.method) {
    throw new Error(`The log "${entry.name}" has an inconsistent ZIP local header.`);
  }
  const nameSize = view.getUint16(offset + 26, true);
  const extraSize = view.getUint16(offset + 28, true);
  requireRange(offset + 30, nameSize + extraSize, directoryOffset, "ZIP local entry name");
  const archive = new Uint8Array(bytes);
  if (nameSize !== entry.nameBytes.length ||
      entry.nameBytes.some((byte, i) => byte !== archive[offset + 30 + i])) {
    throw new Error(`The log "${entry.name}" has mismatched ZIP entry names.`);
  }
  if (!(entry.flags & 0x0008) &&
      (view.getUint32(offset + 14, true) !== entry.crc ||
       view.getUint32(offset + 18, true) !== entry.compressedSize ||
       view.getUint32(offset + 22, true) !== entry.size)) {
    throw new Error(`The log "${entry.name}" has inconsistent ZIP sizes or checksum.`);
  }
  const dataOffset = offset + 30 + nameSize + extraSize;
  requireRange(dataOffset, entry.compressedSize, directoryOffset, "compressed log data");
  return archive.subarray(dataOffset, dataOffset + entry.compressedSize);
}

async function inflateLog(compressed: Uint8Array<ArrayBuffer>, entry: ZipLogEntry): Promise<ArrayBuffer> {
  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream("deflate-raw");
  } catch {
    throw new Error("Opening compressed Haltech logs requires a browser with raw DEFLATE decompression support. Update your browser and try again.");
  }
  const reader = new Blob([compressed]).stream().pipeThrough(decompressor).getReader();
  const output = new Uint8Array(entry.size);
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > output.length - written) {
        throw new Error("The decompressed data exceeds its declared size.");
      }
      output.set(value, written);
      written += value.byteLength;
    }
    if (written !== entry.size) {
      throw new Error("The decompressed data does not match its declared size.");
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    const detail = error instanceof Error ? error.message : "Invalid compressed data.";
    throw new Error(`Could not decompress the log "${entry.name}": ${detail}`);
  } finally {
    reader.releaseLock();
  }
  return output.buffer;
}

function verifyCrc(bytes: ArrayBuffer, entry: ZipLogEntry) {
  let crc = 0xffffffff;
  for (const byte of new Uint8Array(bytes)) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
    throw new Error(`The log "${entry.name}" failed its ZIP checksum and may be damaged.`);
  }
}

export async function extractHaltechLogs(bytes: ArrayBuffer): Promise<{ name: string; bytes: ArrayBuffer }[]> {
  if (bytes.byteLength > MAX_CONTAINER_BYTES) {
    throw new Error("The Haltech archive exceeds the 256 MB import limit.");
  }
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5));
  const isHeps = HEPS_MAGIC.every((byte, i) => header[i] === byte);
  const archive = isHeps ? await decryptHeps(bytes) : bytes;
  if (archive.byteLength < 4 || new DataView(archive).getUint32(0, true) !== 0x04034b50) {
    // Empty ZIPs still get the specific "no datalogs" error below.
    if (archive.byteLength < 4 || new DataView(archive).getUint32(0, true) !== 0x06054b50) {
      throw new Error("The file is not a supported Haltech .hlgzip archive (expected HEPS or ZIP data).");
    }
  }
  const { entries, directoryOffset } = readZipDirectory(archive);
  const logs: { name: string; bytes: ArrayBuffer }[] = [];
  for (const entry of entries) {
    const compressed = readCompressedLog(archive, entry, directoryOffset);
    let logBytes: ArrayBuffer;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) {
        throw new Error(`The log "${entry.name}" has inconsistent uncompressed ZIP sizes.`);
      }
      logBytes = compressed.slice().buffer;
    } else {
      logBytes = await inflateLog(compressed, entry);
    }
    verifyCrc(logBytes, entry);
    logs.push({ name: entry.name, bytes: logBytes });
  }
  return logs;
}
