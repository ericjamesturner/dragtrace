import { useState, useEffect, useRef, useMemo } from "react";
import { useQueries } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CHART_COLORS, type LoadedLog } from "@/lib/viewer-types";
import { loadDatalog } from "@/lib/load-haltech-log";

/**
 * Hook to load multiple log files for the viewer.
 * Uses Convex useQueries for batch file doc loading, then fetches & parses.
 */
export function useLoadedLogs(fileIds: Id<"files">[]) {
  const [logs, setLogs] = useState<LoadedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const cacheRef = useRef<Map<string, LoadedLog>>(new Map());

  // Build stable query objects for file docs
  const fileQueries = useMemo(() => {
    const q: Record<string, { query: typeof api.files.get; args: { id: Id<"files"> } }> = {};
    for (let i = 0; i < fileIds.length; i++) {
      q[`f${i}`] = { query: api.files.get, args: { id: fileIds[i] } };
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(",")]);

  const fileResults = useQueries(fileQueries);

  // Build URL queries from loaded docs
  const urlQueries = useMemo(() => {
    const q: Record<string, { query: typeof api.files.getUrl; args: { fileId: Id<"files"> } }> = {};
    for (let i = 0; i < fileIds.length; i++) {
      const doc = fileResults[`f${i}`];
      if (doc && !(doc instanceof Error) && doc.storageId) {
        q[`u${i}`] = { query: api.files.getUrl, args: { fileId: doc._id } };
      }
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(","), fileIds.map((_, i) => {
    const doc = fileResults[`f${i}`];
    return doc && !(doc instanceof Error) ? doc.storageId : "";
  }).join(",")]);

  const urlResults = useQueries(urlQueries);

  // Check if all data is ready
  const allReady = useMemo(() => {
    for (let i = 0; i < fileIds.length; i++) {
      const doc = fileResults[`f${i}`];
      if (doc === undefined) return false;
      if (doc === null || doc instanceof Error) continue;
      const url = urlResults[`u${i}`];
      if (url === undefined) return false;
    }
    return true;
  }, [fileIds, fileResults, urlResults]);

  useEffect(() => {
    if (!allReady) return;

    let cancelled = false;

    async function loadAll() {
      const cache = cacheRef.current;
      const results: LoadedLog[] = [];
      const errs: string[] = [];

      const toFetch: {
        index: number;
        fileId: Id<"files">;
        fileName: string;
        url: string;
      }[] = [];

      for (let i = 0; i < fileIds.length; i++) {
        const doc = fileResults[`f${i}`];
        if (!doc || doc instanceof Error) continue;
        const url = urlResults[`u${i}`];
        if (!url || url instanceof Error) continue;

        const fileId = fileIds[i];
        const cached = cache.get(fileId);
        if (cached) {
          results[i] = { ...cached, logColor: CHART_COLORS[i % CHART_COLORS.length], logIndex: i };
          continue;
        }

        toFetch.push({ index: i, fileId, fileName: doc.fileName, url: url as string });
      }

      await Promise.all(
        toFetch.map(async ({ index, fileId, fileName, url }) => {
          try {
            const res = await fetch(url);
            const bytes = await res.arrayBuffer();
            if (cancelled) return;

            const log = await loadDatalog({
              bytes,
              fileId,
              fileName,
              index,
            });
            if (cancelled) return;

            cache.set(fileId, log);
            results[index] = log;
          } catch (err) {
            if (!cancelled) {
              errs.push(`${fileName}: ${err instanceof Error ? err.message : "Failed to load"}`);
            }
          }
        })
      );

      if (!cancelled) {
        setLogs(results.filter(Boolean));
        setErrors(errs);
        setLoading(false);
      }
    }

    void loadAll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, fileIds.join(",")]);

  return { logs, loading, errors };
}
