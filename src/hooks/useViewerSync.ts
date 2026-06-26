import { useRef } from "react";
import uPlot from "uplot";

export function useViewerSync() {
  const syncRef = useRef(uPlot.sync("logviewer-sync"));
  return syncRef.current;
}
