/**
 * After an .hlgzip upload: fingerprint its tune, and log a tune change
 * against the car's neighbouring .hlgzip passes in time — the one before
 * and the one after, since old logs can be uploaded late. Only the two
 * neighbours are ever downloaded, and only when their fingerprint differs.
 */
import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { readTune, type Tune } from "./haltech-tune";
import { loadTuneDefs, type UnitChoice } from "./tune-diff";
import { compareTunes, timeFromName, tuneFingerprint } from "./tune-changes";

/** When a pass ran: NSP's stamp in the name, else its event's date and place in the event. */
function passTime(file: Doc<"files">, eventDate: Map<string, string>): number {
  const stamped = timeFromName(file.fileName);
  if (stamped !== null) return stamped;
  const day = Date.parse(`${eventDate.get(file.eventId) ?? "1970-01-01"}T12:00:00`);
  // Stored order is newest-first within an event.
  return day - (file.order ?? 0) * 60_000;
}

/** A stored upload's tune; null when it can't be read, so that pair is skipped, never guessed. */
async function tuneOf(convex: ConvexReactClient, fileId: Id<"files">): Promise<Tune | null> {
  try {
    const url = await convex.query(api.files.getUrl, { fileId });
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await readTune(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function syncTuneChanges({
  convex,
  vehicleId,
  fileId,
  bytes,
  units,
}: {
  convex: ConvexReactClient;
  vehicleId: Id<"vehicles">;
  fileId: Id<"files">;
  bytes: ArrayBuffer;
  units: UnitChoice;
}): Promise<void> {
  let tune: Tune;
  try {
    tune = await readTune(bytes);
  } catch {
    return; // No tune inside (a bare .hlg, or not a Haltech container).
  }
  const hash = await tuneFingerprint(tune);
  await convex.mutation(api.files.setTuneHash, { id: fileId, tuneHash: hash });

  const [files, events, changes] = await Promise.all([
    convex.query(api.files.listByVehicle, { vehicleId }),
    convex.query(api.events.listByVehicle, { vehicleId }),
    convex.query(api.changes.listByVehicle, { vehicleId }),
  ]);
  const eventDate = new Map(events.map((e) => [e._id as string, e.date]));
  const me = files.find((f) => f._id === fileId);
  if (!me) return;
  const mine = { ...me, tuneHash: hash };
  const timeline = files
    .filter((f) => f._id !== fileId && f.tuneHash)
    .concat(mine)
    .sort((a, b) => passTime(a, eventDate) - passTime(b, eventDate));
  const at = timeline.findIndex((f) => f._id === fileId);
  const pairs = [
    [timeline[at - 1], mine],
    [mine, timeline[at + 1]],
  ].filter((p): p is [Doc<"files">, Doc<"files">] => !!p[0] && !!p[1]);

  const defs = await loadTuneDefs(tune.meta);
  for (const [before, after] of pairs) {
    const logged = changes.find((c) => c.source === "tune" && c.toFileId === after._id);
    if (before.tuneHash === after.tuneHash) {
      // Same tune: a change logged into `after` from further back is no longer right.
      if (logged) await convex.mutation(api.changes.remove, { id: logged._id });
      continue;
    }
    const [a, b] = await Promise.all([
      before._id === fileId ? tune : tuneOf(convex, before._id),
      after._id === fileId ? tune : tuneOf(convex, after._id),
    ]);
    if (!a || !b) continue;
    const entry = compareTunes(a, b, defs, units);
    if (!entry) {
      // Only a real comparison may clear an entry; a missing settings list just skips.
      if (logged && defs) await convex.mutation(api.changes.remove, { id: logged._id });
      continue;
    }
    await convex.mutation(api.changes.create, {
      vehicleId,
      date: eventDate.get(after.eventId) ?? new Date().toISOString().slice(0, 10),
      category: entry.category,
      title: entry.title,
      items: entry.items,
      details: entry.details,
      notes: entry.notes,
      source: "tune",
      afterFileId: before._id,
      toFileId: after._id,
    });
  }
}
