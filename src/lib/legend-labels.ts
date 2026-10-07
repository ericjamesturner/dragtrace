/**
 * Long channel names that start the same way truncate to the same text in a
 * narrow legend: "Torque Management Driveshaft RPM Target" and "Torque
 * Management Ignition Correction" both become "Torque Managem…". For a run of
 * adjacent names like that, the shared start becomes a heading and each row
 * keeps only the part that tells it apart.
 */

/** Names at or below this length fit the panel, so they are left alone. */
const FITS_CHARS = 18;

export interface LegendLabel {
  /** Heading to draw above this row: set only on the first row of a run. */
  heading: string | null;
  /** The text for the row itself. */
  label: string;
  /** Sits under a heading, so the row is indented to show it. */
  grouped: boolean;
}

/** Shared leading words of `a` and `b`, leaving at least one word of each. */
function sharedWords(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length) - 1;
  let n = 0;
  while (n < max && a[n].toLowerCase() === b[n].toLowerCase()) n++;
  return n;
}

/** A shared start is only worth a heading when it is a real phrase. */
function usablePrefix(words: string[]): boolean {
  return words.length >= 2 || (words.length === 1 && words[0].length >= 8);
}

export function legendLabels(names: string[]): LegendLabel[] {
  const out: LegendLabel[] = names.map((label) => ({ heading: null, label, grouped: false }));
  const split = names.map((n) => n.split(/\s+/).filter(Boolean));

  let i = 0;
  while (i < names.length) {
    // Grow the run while the words it shares stay a usable prefix.
    let prefixLen = 0;
    let end = i + 1;
    while (end < names.length) {
      const next = Math.min(
        end === i + 1 ? Infinity : prefixLen,
        sharedWords(split[i], split[end]),
      );
      if (!usablePrefix(split[i].slice(0, next))) break;
      prefixLen = next;
      end++;
    }

    const run = names.slice(i, end);
    if (run.length >= 2 && run.some((n) => n.length > FITS_CHARS)) {
      out[i].heading = split[i].slice(0, prefixLen).join(" ");
      for (let k = i; k < end; k++) {
        out[k].label = split[k].slice(prefixLen).join(" ");
        out[k].grouped = true;
      }
    }
    i = end;
  }
  return out;
}
