/**
 * The last tune seen from each ECU, kept in this browser — so a single file
 * can be compared against the one before it. Keyed by the ECU's serial
 * number. Tunes stay on the device: nothing here is uploaded.
 */

import type { Tune, TuneMeta } from "./haltech-tune";

const DB = "dragtrace-tunes";
const STORE = "last-by-serial";

interface Stored {
  serial: string;
  label: string;
  savedAt: number;
  meta: TuneMeta;
  values: [number, string][];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "serial" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The tune last saved for this ECU, or null — including when storage is unavailable. */
export async function loadLastTune(serial: string): Promise<{ label: string; savedAt: number; tune: Tune } | null> {
  try {
    const db = await open();
    const row = await new Promise<Stored | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(serial);
      req.onsuccess = () => resolve(req.result as Stored | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!row) return null;
    return { label: row.label, savedAt: row.savedAt, tune: { meta: row.meta, values: new Map(row.values) } };
  } catch {
    return null;
  }
}

/** Remember this tune as the latest for its ECU. Best effort. */
export async function saveLastTune(label: string, tune: Tune): Promise<void> {
  try {
    const db = await open();
    const row: Stored = {
      serial: tune.meta.serial,
      label,
      savedAt: Date.now(),
      meta: tune.meta,
      values: [...tune.values],
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Private mode or blocked storage: the comparison still works, it just
    // can't be remembered for next time.
  }
}
