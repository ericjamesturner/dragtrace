// Run the actual browser parsers against independently generated Haltech files.
// Optional: node scripts/test-hlgzip.mjs /path/to/PCLog_2025-12-17_0144pm.hlgzip
import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { build } from "esbuild";

globalThis.crypto ??= webcrypto;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: {
    contents: `
      export { parseDatalogBytes, isSupportedLogFile, SUPPORTED_LOG_ACCEPT } from ${JSON.stringify(join(root, "src/lib/datalog-parser.ts"))};
      export { parseHaltechHlg } from ${JSON.stringify(join(root, "src/lib/haltech-hlg-parser.ts"))};
      export { extractHaltechLogs } from ${JSON.stringify(join(root, "src/lib/haltech-container.ts"))};
      export { loadDatalog, prepareLogRecordings, selectLogRecording, getLogRecordings } from ${JSON.stringify(join(root, "src/lib/load-haltech-log.ts"))};
      export { captureSharedViewerWorkspace, configFromSharedViewerWorkspace } from ${JSON.stringify(join(root, "src/lib/shared-viewer-layout.ts"))};
      export { remapConfigToFiles, viewerReducer } from ${JSON.stringify(join(root, "src/lib/viewer-types.ts"))};
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", target: "node22",
  loader: { ".json": "json" }, alias: { "@": join(root, "src") },
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const arrayBuffer = (data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const u16 = (value) => { const data = Buffer.alloc(2); data.writeUInt16BE(value); return data; };
const u32 = (value) => { const data = Buffer.alloc(4); data.writeUInt32BE(value); return data; };
const i32 = (value) => { const data = Buffer.alloc(4); data.writeInt32BE(value); return data; };
const cstr = (value = "") => Buffer.from(`${value}\0`, "latin1");
function section(type, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([type]), u32(payload.length + 5), payload]);
}
function header(number = 42, options = {}) {
  const data = Buffer.alloc(73);
  data[0] = 1; data.writeUInt32BE(data.length, 1);
  data.write(options.magic ?? "HALTECH1", 5, "ascii");
  data.write(options.serial ?? "TEST-ECU", 17, "ascii");
  data.set([13, 44, 47, 0], 49);
  data.writeUInt16BE(2025, 53); data[55] = 12; data[56] = 17;
  data.writeUInt32BE(number, 57); data[65] = options.source ?? 1;
  return data;
}
function groupSections(group, definitions, extended = group > 15) {
  const groupPrefix = extended ? u16(group) : Buffer.alloc(0);
  const ids = section(extended ? 11 : 6 | (group << 4),
    Buffer.concat([groupPrefix, ...definitions.map((def) => u16(def.id))]));
  const descriptors = definitions.map((def) => Buffer.concat([
    u16(def.unit), Buffer.from([def.order ?? 0]), i32(def.min ?? 0), i32(def.max ?? 20000),
    cstr(def.short ?? def.name), cstr(def.name), cstr(def.description),
  ]));
  const metadata = section(extended ? 13 : 9 | (group << 4), Buffer.concat([groupPrefix, ...descriptors]));
  return [ids, metadata];
}
function sample(group, time, values, extended = group > 15) {
  return section(extended ? 12 : 7 | (group << 4), Buffer.concat([
    ...(extended ? [u16(group)] : []), u32(time), ...values.map(i32),
  ]));
}
const rpm = { id: 384, unit: 1, name: "RPM", min: 0, max: 20000 };
const coolant = { id: 229, unit: 5, name: "Coolant Temperature", short: "", min: 2331, max: 4731 };
const pressure = { id: 224, unit: 3, name: "Manifold Pressure", order: 7, min: 13, max: 11013 };
function basicBlock(number = 42, times = [100, 200], options = {}) {
  const defs = options.definitions ?? [rpm];
  return Buffer.concat([
    header(number, options), ...groupSections(0, defs),
    ...times.map((time, index) => sample(0, time, defs.map(() => 1000 * (index + 1)))),
  ]);
}
// Distinct PC recordings deliberately share channel names. Their values, start
// clocks and race lead-ins differ, so selecting an index alone cannot pass.
function raceRecording(number, { rpmBase, raceAt, seconds, hour, extraChannel, stepMs = 1000 }) {
  const recordingHeader = header(number, { source: 0 });
  recordingHeader[49] = hour;
  const definitions = [rpm, { id: 65000, unit: 9, name: "Race Timer" }];
  if (extraChannel) definitions.push({ id: 65001, unit: 0, name: extraChannel });
  return Buffer.concat([
    recordingHeader, ...groupSections(0, definitions),
    ...Array.from({ length: seconds + 1 }, (_, second) => sample(0, second * stepMs,
      [rpmBase + second, second < raceAt ? 0 : second - raceAt + 1,
        ...(extraChannel ? [100 + second] : [])])),
  ]);
}
function groupedLog() {
  return Buffer.concat([
    section(14, Buffer.concat([u32(42)])), Buffer.from([255, 255, 255]), header(),
    ...groupSections(0, [rpm]), ...groupSections(1, [coolant, pressure]),
    ...groupSections(17, [
      { id: 248, unit: 13, name: "Ignition Angle", min: -500, max: 500 },
      { id: 500, unit: 47, name: "Gear" },
      { id: 501, unit: 300, name: "Byte\x80", description: "Unknown unit stays raw" },
    ]),
    sample(0, 100, [1000]), sample(1, 100, [3500, 1013]), sample(17, 100, [-150, 2, 25]),
    sample(0, 150, [1500]),
    section(10, Buffer.concat([u32(175), u16(1), Buffer.alloc(16000)])),
    sample(0, 200, [2000]), sample(1, 200, [-2147483617, 1113]),
    sample(17, 200, [-100, 3, -2147483148]),
    sample(0, 250, [2500]),
    sample(0, 300, [3000]), sample(1, 300, [3540, 1213]), sample(17, 300, [-50, 3, 35]),
  ]);
}

// ZIP members are created with Node's zlib, independently of the import code.
// Extra non-log members model the encrypted tune included by NSP.
function zip(members, comment = "") {
  const localParts = [], directoryParts = [];
  let localOffset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name), data = member.data;
    const method = member.method ?? 0, flags = member.descriptor ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!member.descriptor) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const trailing = Buffer.alloc(member.descriptor ? 16 : 0);
    if (member.descriptor) {
      trailing.writeUInt32LE(0x08074b50); trailing.writeUInt32LE(crc, 4);
      trailing.writeUInt32LE(compressed.length, 8); trailing.writeUInt32LE(data.length, 12);
    }
    localParts.push(local, name, compressed, trailing);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(localOffset, 42);
    directoryParts.push(central, name);
    localOffset += local.length + name.length + compressed.length + trailing.length;
  }
  const directory = Buffer.concat(directoryParts), commentBytes = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(localOffset, 16); end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...localParts, directory, end, commentBytes]);
}
function encrypt(plain) {
  const iv = Buffer.from("5b1eb801db0c374653b6c7f3341e0707", "hex");
  const key = pbkdf2Sync("3EEBEB31F9E48875C92EE99475B60585", "35osnfivndufue", 1000, 32, "sha1");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const prefix = Buffer.alloc(9); prefix.write("HEPS\0", "ascii"); prefix.writeUInt32LE(16, 5);
  return Buffer.concat([prefix, iv, cipher.update(plain), cipher.final()]);
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`); }
function values(log, name, session = 0) { return [...log.sessions[session].channels.get(name)]; }
let passed = 0;
async function check(name, run) {
  await run(); passed++; console.log(`ok ${passed} - ${name}`);
}
const parse = (data, name = "test.hlg") => api.parseDatalogBytes(arrayBuffer(data), name);
const groupData = groupedLog();

await check("file selection accepts native logs case-insensitively", () => {
  assert.ok(api.isSupportedLogFile("LOG.HLGZIP")); assert.ok(api.isSupportedLogFile("log.hlg"));
  assert.ok(api.SUPPORTED_LOG_ACCEPT.includes(".hlgzip"));
});
await check("ordinary and extended groups share a complete timestamp grid", async () => {
  const log = await parse(groupData), session = log.sessions[0];
  assert.equal(log.format, "Haltech"); assert.equal(log.channelDefs.length, 6);
  assert.equal(session.rowCount, 5); assert.deepEqual([...session.timestamps], [0, 0.05, 0.1, 0.15, 0.2]);
  assert.deepEqual(values(log, "RPM"), [1000, 1500, 2000, 2500, 3000]);
  assert.deepEqual(values(log, "Gear"), [2, 2, 3, 3, 3]);
  near(values(log, "Ignition Angle")[1], -12.5);
  near(values(log, "Manifold Pressure")[0], 0); near(values(log, "Manifold Pressure")[1], 5);
  near(values(log, "Coolant Temperature")[0], 76.9);
  near(values(log, "Coolant Temperature")[1], 76.9);
  assert.ok(Number.isNaN(values(log, "Coolant Temperature")[2]));
  assert.ok(Number.isNaN(values(log, "Coolant Temperature")[3]));
  near(values(log, "Coolant Temperature")[4], 80.9);
  assert.equal(session.channelStatus.get("Coolant Temperature").dominantCode, 31);
  assert.equal(session.channelStatus.get("Coolant Temperature").dominantLabel, "No Signal");
  assert.equal(session.channelStatus.get("Byte\x80").dominantCode, 500);
  assert.ok(Number.isNaN(values(log, "Byte\x80")[2]));
  assert.ok(Number.isNaN(values(log, "Byte\x80")[3]));
  const cts = log.channelDefs.find((def) => def.id === 229);
  near(cts.displayMin, -40); near(cts.displayMax, 200);
  assert.equal(log.channelDefs.find((def) => def.id === 501).type, "Unit 300");
  assert.equal(log.metadata["ECU Serial"], "TEST-ECU"); assert.equal(log.metadata["Log Source"], "ECU");
});
await check("HALTECH0, empty recordings, padding, and zero-filled ECU tails", async () => {
  const data = Buffer.concat([header(41, { magic: "HALTECH0" }), Buffer.from([255]), basicBlock(), Buffer.alloc(64)]);
  const log = await parse(data);
  assert.equal(log.sessions.length, 1); assert.equal(log.sessions[0].rowCount, 2);
  await assert.rejects(parse(header()), /No log samples/);
  await assert.rejects(parse(Buffer.concat([basicBlock(), Buffer.alloc(5), sample(0, 300, [3000])])), /Invalid Haltech/);
});
await check("compatible continuous ECU blocks merge without losing the boundary", async () => {
  const log = await parse(Buffer.concat([basicBlock(42, [100, 200]), basicBlock(43, [250, 350])]));
  assert.equal(log.sessions.length, 1); assert.equal(log.sessions[0].rowCount, 4);
  assert.deepEqual([...log.sessions[0].timestamps], [0, 0.1, 0.15, 0.25]);
  assert.deepEqual(values(log, "RPM"), [1000, 2000, 1000, 2000]);
  assert.match(log.sessions[0].label, /42.*43/);
});
await check("timestamp resets, long gaps, and different channel schemas stay separate", async () => {
  for (const second of [basicBlock(43, [0, 100]), basicBlock(43, [5000, 5100]),
    basicBlock(43, [250, 350], { definitions: [{ ...rpm, id: 385 }] })]) {
    const log = await parse(Buffer.concat([basicBlock(), second]));
    assert.equal(log.sessions.length, 2); assert.equal(log.sessions[1].rowCount, 2);
    assert.deepEqual([...log.sessions[1].timestamps], [0, 0.1]);
  }
});
await check("PC recordings and unrelated ECU origins or log numbers never merge", async () => {
  const laterOrigin = basicBlock(43, [250, 350]); laterOrigin[49] = 14;
  const pairs = [
    [basicBlock(42, [100, 200], { source: 0 }), basicBlock(43, [250, 350], { source: 0 })],
    [basicBlock(42, [100, 200]), basicBlock(44, [250, 350])],
    [basicBlock(42, [100, 200]), laterOrigin],
  ];
  for (const pair of pairs) assert.equal((await parse(Buffer.concat(pair))).sessions.length, 2);
  const indexed = await parse(Buffer.concat([
    section(14, Buffer.concat([u32(42), u32(43)])),
    basicBlock(0, [100, 200]), basicBlock(0, [250, 350]),
  ]));
  assert.equal(indexed.sessions.length, 1); assert.match(indexed.sessions[0].label, /42.*43/);
});
await check("ECU logs without a clock use an explicit filename or unknown date fallback", async () => {
  const noClock = basicBlock(111, [0, 100], { source: 8 });
  noClock.fill(0, 49, 57);
  noClock.set([0x15, 0x13, 0], 17);
  const memberName = "2026-03-11_0718pm_Logs111to111.hlg";
  const archive = encrypt(zip([{ name: memberName, data: noClock, method: 8 }]));
  for (const log of [await parse(noClock, memberName), await parse(archive, "download.hlgzip")]) {
    const start = log.sessions[0].startTime;
    assert.equal(start.getFullYear(), 2026); assert.equal(start.getMonth(), 2);
    assert.equal(start.getDate(), 11); assert.equal(start.getHours(), 19); assert.equal(start.getMinutes(), 18);
    assert.equal(log.metadata["Recording Date Source"], "filename");
    assert.equal(log.metadata["ECU Serial"], undefined);
    assert.deepEqual(values(log, "RPM"), [1000, 2000]);
  }
  const unknown = await parse(noClock);
  assert.equal(unknown.sessions[0].startTime.getTime(), 0);
  assert.equal(unknown.metadata["Recording Date Source"], "unknown");
  for (const [clock, hour] of [["1200am", 0], ["1200pm", 12]]) {
    assert.equal((await parse(noClock, `2026-03-11_${clock}_Log111.hlg`)).sessions[0].startTime.getHours(), hour);
  }
  assert.equal((await parse(noClock, "2026-02-30_0718pm_Log111.hlg")).sessions[0].startTime.getTime(), 0);
  const badCalendar = basicBlock(); badCalendar[55] = 13;
  assert.equal((await parse(badCalendar)).metadata["Recording Date Source"], "unknown");
  const badDay = basicBlock(); badDay[55] = 2; badDay[56] = 30;
  assert.equal((await parse(badDay)).metadata["Recording Date Source"], "unknown");
  const oldYear = basicBlock(); oldYear.writeUInt16BE(24, 53);
  assert.equal((await parse(oldYear)).sessions[0].startTime.getFullYear(), 24);
  const actualDate = await parse(basicBlock(), memberName);
  assert.equal(actualDate.sessions[0].startTime.getFullYear(), 2025);
  assert.equal(actualDate.metadata["Recording Date Source"], "header");
  const next = basicBlock(112, [150, 250], { source: 8 }); next.fill(0, 49, 57);
  next.set(noClock.subarray(17, 49), 17);
  assert.equal((await parse(Buffer.concat([noClock, next]), memberName)).sessions.length, 2);
});
await check("ZIP extraction supports stored and deflated logs, data descriptors, and encrypted HEPS", async () => {
  const members = [
    { name: "map.nexmap", data: Buffer.from("opaque encrypted tune"), method: 99 },
    { name: "folder/STORED.HLG", data: groupData },
    { name: "deflated.hlg", data: basicBlock(), method: 8, descriptor: true },
  ];
  const plain = zip(members, "comment with misleading PK\x05\x06 bytes");
  for (const data of [plain, encrypt(plain)]) {
    const extracted = await api.extractHaltechLogs(arrayBuffer(data));
    assert.deepEqual(extracted.map((entry) => entry.name), ["STORED.HLG", "deflated.hlg"]);
    assert.deepEqual(Buffer.from(extracted[0].bytes), groupData);
    const parsed = await parse(data, "test.hlgzip");
    assert.equal(parsed.sessions.length, 2); assert.equal(parsed.channelDefs.length, 6);
    assert.equal(parsed.sessions[0].rowCount, 5); assert.equal(parsed.sessions[1].rowCount, 2);
    assert.match(parsed.sessions[0].label, /STORED.HLG/); assert.match(parsed.sessions[1].label, /deflated.hlg/);
  }
});
await check("same channel names with different units survive across ZIP members", async () => {
  const other = basicBlock(43, [0, 100], { definitions: [{ id: 800, unit: 5, name: "RPM" }] });
  const log = await parse(zip([{ name: "rpm.hlg", data: basicBlock() }, { name: "temp.hlg", data: other }]), "test.hlgzip");
  assert.equal(log.channelDefs.length, 2);
  assert.notEqual(log.channelDefs[0].name, log.channelDefs[1].name);
  assert.equal(log.sessions[1].channels.size, 1);
  near([...log.sessions[1].channels.values()][0][0], -173.1);
});
await check("unknown unit types stay distinct across repeated native channel IDs", async () => {
  const data = Buffer.concat([300, 301, 302].map((unit, index) => basicBlock(42 + index, [0, 100], {
    definitions: [{ id: 800, unit, name: "Unknown sensor" }],
  })));
  const log = await parse(data);
  assert.equal(log.sessions.length, 3); assert.equal(log.channelDefs.length, 3);
  assert.deepEqual(log.channelDefs.map((def) => def.type), ["Unit 300", "Unit 301", "Unit 302"]);
  assert.equal(new Set(log.channelDefs.map((def) => def.name)).size, 3);
});
await check("native parser rejects truncated records, bad tables, metadata, and backwards times", async () => {
  const badLength = basicBlock(); badLength.writeUInt32BE(0xffffffff, 1);
  const malformed = [
    groupData.subarray(0, groupData.length - 1), badLength,
    Buffer.concat([header(), section(6, Buffer.from([0]))]),
    Buffer.concat([header(), ...groupSections(0, [rpm]), sample(0, 100, [1, 2])]),
    Buffer.concat([header(), ...groupSections(0, [rpm]), sample(0, 200, [2]), sample(0, 100, [1])]),
    Buffer.concat([header(), section(6, u16(384)), section(9, Buffer.concat([u16(1), Buffer.alloc(9), Buffer.from("unterminated")])), sample(0, 0, [1])]),
    Buffer.concat([header(), section(6, u16(384)), sample(0, 0, [1])]),
    sample(0, 0, [1]),
    Buffer.concat([header(), ...groupSections(0, []), sample(0, 0, [])]),
  ];
  for (const data of malformed) await assert.rejects(parse(data), /Invalid Haltech/);
});
await check("decoded channel arrays respect the import memory budget", () => {
  assert.throws(() => api.parseHaltechHlg(arrayBuffer(groupData), 29), /too large to open/);
  assert.equal(api.parseHaltechHlg(arrayBuffer(groupData), 30).sessions[0].rowCount, 5);
});
await check("container rejects CRC damage, local mismatch, invalid DEFLATE, and archive truncation", async () => {
  const stored = zip([{ name: "test.hlg", data: basicBlock() }]);
  const corrupt = Buffer.from(stored); corrupt[30 + Buffer.byteLength("test.hlg") + 17] ^= 1;
  await assert.rejects(parse(corrupt, "bad.hlgzip"), /checksum/);
  const localMismatch = Buffer.from(stored); localMismatch.writeUInt32LE(123, 22);
  await assert.rejects(parse(localMismatch, "bad.hlgzip"), /inconsistent ZIP/);
  const badDeflate = zip([{ name: "test.hlg", data: basicBlock(), method: 8 }]);
  badDeflate.fill(255, 30 + Buffer.byteLength("test.hlg"), badDeflate.readUInt32LE(badDeflate.length - 6));
  await assert.rejects(parse(badDeflate, "bad.hlgzip"), /decompress/);
  await assert.rejects(parse(stored.subarray(0, stored.length - 1), "bad.hlgzip"), /ZIP directory/);
  await assert.rejects(parse(zip([{ name: "tune.nexmap", data: Buffer.alloc(1) }]), "empty.hlgzip"), /no .hlg/);
  const encrypted = encrypt(stored), badIv = Buffer.from(encrypted); badIv.writeUInt32LE(15, 5);
  await assert.rejects(parse(badIv, "bad.hlgzip"), /initialization vector/);
  await assert.rejects(parse(encrypted.subarray(0, encrypted.length - 1), "bad.hlgzip"), /encrypted data/);
  const badPadding = Buffer.from(encrypted); badPadding[badPadding.length - 17] ^= 1;
  await assert.rejects(parse(badPadding, "bad.hlgzip"), /decrypt/);
});

const recordingData = Buffer.concat([
  raceRecording(101, { rpmBase: 1000, raceAt: 5, seconds: 8, hour: 13 }),
  raceRecording(102, { rpmBase: 8000, raceAt: 7, seconds: 12, hour: 14,
    extraChannel: "Second recording sensor", stepMs: 900 }),
  raceRecording(103, { rpmBase: 3000, raceAt: 100, seconds: 6, hour: 15 }),
]);
const sessionSnapshot = (session) => ({
  label: session.label, startTime: session.startTime.getTime(), rowCount: session.rowCount,
  timestamps: [...session.timestamps], channels: [...session.channels].map(([name, data]) => [name, [...data]]),
  channelStatus: [...session.channelStatus],
});
const loadRecordingFixture = (fileId = "native-source", index = 0) => api.loadDatalog({
  bytes: arrayBuffer(recordingData), fileName: "three-recordings.hlg", fileId, index,
});

await check("each recording gets its own race start and immutable clipped view", async () => {
  const raw = await parse(recordingData);
  const original = raw.sessions.map(sessionSnapshot);
  const prepared = api.prepareLogRecordings(raw);
  assert.deepEqual(raw.sessions.map(sessionSnapshot), original);
  assert.equal(prepared.sourceSessions.length, 3);
  assert.deepEqual(prepared.sourceSessions.map(sessionSnapshot), original);
  assert.equal(prepared.parsed.sessions[0].rowCount, 6);
  assert.deepEqual([...prepared.parsed.sessions[0].timestamps], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...prepared.parsed.sessions[0].channels.get("RPM")], [1003, 1004, 1005, 1006, 1007, 1008]);
  assert.equal(prepared.parsed.sessions[1].rowCount, 8);
  near(prepared.parsed.sessions[1].timestamps.at(-1), 6.3);
  assert.deepEqual([...prepared.parsed.sessions[1].channels.get("RPM")], [8005, 8006, 8007, 8008, 8009, 8010, 8011, 8012]);
  assert.deepEqual([...prepared.parsed.sessions[1].channels.get("Second recording sensor")], [105, 106, 107, 108, 109, 110, 111, 112]);
  assert.equal(prepared.parsed.sessions[2].rowCount, 7);
  assert.equal(prepared.recordings[0].sourceRowCount, 9);
  assert.equal(prepared.recordings[1].sourceRowCount, 13);
  assert.equal(prepared.recordings[1].channelCount, 3);
  near(prepared.recordings[0].sourceDuration, 8);
  near(prepared.recordings[1].sourceDuration, 10.8);
  near(prepared.recordings[0].clipStartTime, 3);
  near(prepared.recordings[1].clipStartTime, 4.5);
  near(prepared.recordings[0].raceStartTime, 2);
  near(prepared.recordings[1].raceStartTime, 1.8);
  assert.equal(prepared.recordings[2].raceStartTime, null);
  // Math channels are added to prepared maps. A session requiring no clip
  // still needs its own map so those channels cannot modify the original.
  prepared.parsed.sessions[2].channels.set("Custom derived channel", new Float64Array(7));
  assert.equal(prepared.sourceSessions[2].channels.has("Custom derived channel"), false);
  assert.deepEqual(raw.sessions.map(sessionSnapshot), original);
});

await check("recording switches use the selected data and never clip twice", async () => {
  const loaded = await loadRecordingFixture();
  const sourceBefore = loaded.sourceSessions.map(sessionSnapshot);
  const firstBefore = sessionSnapshot(loaded.parsed.sessions[0]);
  assert.equal(loaded.activeSessionIndex, 0); near(loaded.raceStartTime, 2);
  const second = api.selectLogRecording(loaded, 1);
  assert.equal(second.activeSessionIndex, 1); near(second.raceStartTime, 1.8);
  assert.equal(second.parsed.sessions[1].channels.get("RPM")[0], 8005);
  assert.equal(second.parsed.sessions[1].startTime.getHours(), 14);
  assert.equal(api.getLogRecordings(second)[1].sourceRowCount, 13);
  const noRace = api.selectLogRecording(second, 2);
  assert.equal(noRace.raceStartTime, null);
  assert.equal(noRace.parsed.sessions[2].channels.get("RPM")[0], 3000);
  const back = api.selectLogRecording(noRace, 0);
  assert.equal(back.activeSessionIndex, 0); near(back.raceStartTime, 2);
  assert.deepEqual(sessionSnapshot(back.parsed.sessions[0]), firstBefore);
  assert.deepEqual(loaded.sourceSessions.map(sessionSnapshot), sourceBefore);
  assert.equal(loaded.activeSessionIndex, 0);
  for (const invalid of [-1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => api.selectLogRecording(loaded, invalid), RangeError);
  }
});

const recordingConfig = (logs) => ({
  pages: [{ id: "page-1", label: "Compare", traces: [{ id: "trace-1", channels: logs.map((log) => ({
    logFileId: log.fileId, channelName: "RPM",
  })) }] }],
  activePageId: "page-1", alignByRaceTime: true,
  selectedRecordings: Object.fromEntries(logs.map((log) => [log.fileId, log.activeSessionIndex])),
  recordingFingerprints: Object.fromEntries(logs.map((log) => [log.fileId, log.contentFingerprint])),
});

await check("shared comparisons preserve recording choices by file slot", async () => {
  const first = api.selectLogRecording(await loadRecordingFixture("private-file-a"), 1);
  const second = api.selectLogRecording(await loadRecordingFixture("private-file-b", 1), 2);
  const config = recordingConfig([first, second]);
  config.selectedRecordings["unshared-private-file"] = 17;
  const serialized = api.captureSharedViewerWorkspace(config, [first, second]);
  assert.ok(serialized);
  const captured = JSON.parse(serialized);
  assert.deepEqual(captured.selectedRecordings, { "shared-workspace-file-0": 1, "shared-workspace-file-1": 2 });
  assert.equal(captured.recordingFingerprints, undefined);
  assert.ok(!serialized.includes("private-file"));
  const publicLogs = [await loadRecordingFixture("public-file-a"), await loadRecordingFixture("public-file-b", 1)];
  const restored = api.configFromSharedViewerWorkspace(serialized, publicLogs);
  assert.ok(restored);
  assert.deepEqual(restored.selectedRecordings, { "public-file-a": 1, "public-file-b": 2 });
  const selected = publicLogs.map((log) => api.selectLogRecording(log, restored.selectedRecordings[log.fileId]));
  assert.equal(selected[0].parsed.sessions[selected[0].activeSessionIndex].channels.get("RPM")[0], 8005);
  assert.equal(selected[1].parsed.sessions[selected[1].activeSessionIndex].channels.get("RPM")[0], 3000);
  assert.equal(selected[1].raceStartTime, null);
  for (const invalid of [-1, 3, 0.5, "1", null]) {
    const tampered = { ...captured, selectedRecordings: { "shared-workspace-file-0": invalid, "shared-workspace-file-1": 2 } };
    const safe = api.configFromSharedViewerWorkspace(JSON.stringify(tampered), publicLogs);
    assert.ok(safe);
    assert.ok(safe.selectedRecordings?.["public-file-a"] === undefined || safe.selectedRecordings["public-file-a"] === 0);
    assert.equal(safe.selectedRecordings?.["public-file-b"], 2);
  }
});

await check("saved layouts reuse recording selections only for the same content", async () => {
  const source = api.selectLogRecording(await loadRecordingFixture("original-id"), 1);
  const config = recordingConfig([source]);
  const sameBytes = await loadRecordingFixture("replacement-id");
  const same = api.remapConfigToFiles(config, [sameBytes]);
  assert.equal(same.pages[0].traces[0].channels[0].logFileId, "replacement-id");
  assert.deepEqual(same.selectedRecordings, { "replacement-id": 1 });
  const differentBytes = await api.loadDatalog({
    bytes: arrayBuffer(Buffer.concat([
      raceRecording(201, { rpmBase: 4500, raceAt: 2, seconds: 6, hour: 17 }),
      raceRecording(202, { rpmBase: 6500, raceAt: 3, seconds: 8, hour: 18 }),
    ])), fileName: "unrelated.hlg", fileId: "replacement-id",
  });
  assert.notEqual(differentBytes.contentFingerprint, source.contentFingerprint);
  const unrelated = api.remapConfigToFiles(config, [differentBytes]);
  assert.equal(unrelated.pages[0].traces[0].channels[0].logFileId, "replacement-id");
  assert.equal(unrelated.selectedRecordings?.["replacement-id"], undefined);
  assert.equal(unrelated.selectedRecordings?.["original-id"], undefined);
  assert.equal(api.selectLogRecording(differentBytes, 0).activeSessionIndex, 0);
  const reusedId = { ...differentBytes, fileId: source.fileId };
  assert.equal(api.remapConfigToFiles(config, [reusedId]).selectedRecordings?.[source.fileId], undefined);
  const invalidChoice = { ...config, selectedRecordings: { [source.fileId]: 99 } };
  assert.equal(api.remapConfigToFiles(invalidChoice, [sameBytes]).selectedRecordings?.[sameBytes.fileId], undefined);
});

await check("a recording change resets stale chart ranges and retains other log choices", async () => {
  const first = await loadRecordingFixture("file-a"), second = await loadRecordingFixture("file-b");
  const config = { ...recordingConfig([first, second]), zoom: [30, 40], selection: [32, 35] };
  const switched = api.viewerReducer(config, {
    type: "setRecording", logFileId: first.fileId, sessionIndex: 1,
    contentFingerprint: first.contentFingerprint,
  });
  assert.equal(switched.selectedRecordings["file-a"], 1);
  assert.equal(switched.selectedRecordings["file-b"], 0);
  assert.equal(switched.recordingFingerprints["file-a"], first.contentFingerprint);
  assert.equal(switched.zoom, undefined); assert.equal(switched.selection, undefined);
  assert.deepEqual(config.zoom, [30, 40]); assert.deepEqual(config.selection, [32, 35]);
  for (const invalid of [-1, 0.5, Number.NaN]) {
    assert.equal(api.viewerReducer(config, { type: "setRecording", logFileId: first.fileId, sessionIndex: invalid }), config);
  }
});

for (const sampleArg of process.argv.slice(2)) {
  const samplePath = resolve(sampleArg), data = readFileSync(samplePath);
  await check(`real recording ${basename(samplePath)}`, async () => {
    const log = await parse(data, basename(samplePath)), session = log.sessions[0];
    assert.ok(log.channelDefs.length > 0); assert.ok(session.rowCount > 0);
    if (/PCLog_2025-12-17_0144pm\.hlg(?:zip)?$/i.test(samplePath)) {
      assert.equal(log.channelDefs.length, 611); assert.equal(log.sessions.length, 1); assert.equal(session.rowCount, 1281);
      near(session.timestamps.at(-1), 60.519); assert.equal(session.channelStatus.size, 30);
      assert.equal(log.metadata["ECU Serial"], "213000588802"); assert.equal(log.metadata["Log Source"], "PC");
      assert.equal(values(log, "RPM")[0], 1236); assert.equal(values(log, "RPM").at(-1), 1018);
      near(values(log, "Coolant Temperature")[0], 76.4); near(values(log, "Manifold Pressure")[0], -51.4);
      near(values(log, "Diagnostic Battery Voltage")[0], 13.544);
      assert.equal(session.channelStatus.get("Wideband O2 1").samples, 388);
      assert.equal(log.channelDefs.find((def) => def.name === "RPM").id, 384);
      assert.equal(session.startTime.getFullYear(), 2025); assert.equal(session.startTime.getMonth(), 11);
      assert.equal(session.startTime.getDate(), 17); assert.equal(session.startTime.getHours(), 13);
    }
    if (/PAMONA - T2.*2026-03-11_0718pm_Logs111to111\.hlgzip$/i.test(samplePath)) {
      assert.equal(log.channelDefs.length, 59); assert.equal(log.sessions.length, 1);
      assert.equal(session.rowCount, 1816); near(session.timestamps.at(-1), 13.392);
      assert.equal(session.channelStatus.size, 2); assert.equal(session.label, "Log 111");
      assert.equal(log.metadata["Log Source"], "ECU"); assert.equal(log.metadata["Recording Date Source"], "filename");
      assert.equal(session.startTime.getFullYear(), 2026); assert.equal(session.startTime.getMonth(), 2);
      assert.equal(session.startTime.getDate(), 11); assert.equal(session.startTime.getHours(), 19);
      assert.equal(session.startTime.getMinutes(), 18);
    }
    console.log(`  ${log.channelDefs.length} channels, ${session.rowCount} rows, ${session.timestamps.at(-1).toFixed(3)} seconds`);
  });
}
console.log(`Passed ${passed} Haltech import checks.`);
