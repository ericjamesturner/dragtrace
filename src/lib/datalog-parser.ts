import { detectHaltech, parseHaltech } from "./haltech-parser";
import { parseHolleyV6Dl } from "./holley-dl-parser";
import type { ParsedLog } from "./log-types";
import { decodeLogText, detectTextLog, parseTextLog } from "./text-log-parser";

export const TEXT_LOG_EXTENSIONS = new Set(["csv", "log", "txt"]);
export const BINARY_LOG_EXTENSIONS = new Set([
  "mlg", "xrk", "drk", "llg", "llg5", "lg1", "lg2", "dlz", "daq", "dat", "emublog",
]);
export const SUPPORTED_LOG_EXTENSIONS = new Set([...TEXT_LOG_EXTENSIONS, "dl"]);
export const SUPPORTED_LOG_ACCEPT = [...SUPPORTED_LOG_EXTENSIONS].map((extension) => `.${extension}`).join(",");

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedLogFile(fileName: string): boolean {
  return SUPPORTED_LOG_EXTENSIONS.has(fileExtension(fileName));
}

export function parseDatalogBytes(bytes: ArrayBuffer, fileName: string): ParsedLog {
  const extension = fileExtension(fileName);
  if (extension === "dl") return parseHolleyV6Dl(bytes);
  if (BINARY_LOG_EXTENSIONS.has(extension)) {
    throw new Error(`${extension.toUpperCase()} binary logs are not supported yet`);
  }

  const text = decodeLogText(bytes);
  if (detectHaltech(text)) return parseHaltech(text);
  if (detectTextLog(text)) return parseTextLog(text);
  throw new Error("Unsupported ECU log format");
}
