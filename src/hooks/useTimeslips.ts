import { useMemo } from "react";
import { useQueries } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

/**
 * Fetch timeslips for every loaded file via Convex `useQueries`
 * (one batched `listByFile` query per file, mirroring useLoadedLogs).
 * Returns a Map keyed by fileId.
 */
export function useTimeslips(fileIds: Id<"files">[]): Map<Id<"files">, Doc<"timeslips">[]> {
  const queries = useMemo(() => {
    const q: Record<string, { query: typeof api.timeslips.listByFile; args: { fileId: Id<"files"> } }> = {};
    for (let i = 0; i < fileIds.length; i++) {
      q[`t${i}`] = { query: api.timeslips.listByFile, args: { fileId: fileIds[i] } };
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(",")]);

  const results = useQueries(queries);

  return useMemo(() => {
    const map = new Map<Id<"files">, Doc<"timeslips">[]>();
    for (let i = 0; i < fileIds.length; i++) {
      const r = results[`t${i}`];
      if (r && !(r instanceof Error)) map.set(fileIds[i], r as Doc<"timeslips">[]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(","), results]);
}
