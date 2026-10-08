/**
 * Long channel names that start the same way truncate to the same text in a
 * narrow legend: "Torque Management Driveshaft RPM Target" and "Torque
 * Management Ignition Correction" both become "Torque Managem…". Adjacent
 * channels from the same group are drawn under one heading, each row keeping
 * only the part of its name that tells it apart.
 *
 * The group is the ECU maker's own when the definition data supplies one
 * ("Torque Management"); otherwise it is guessed from shared leading words.
 */

/** Names at or below this length fit the panel, so they are left alone. */
const FITS_CHARS = 18;

export interface LegendLabel {
  /** Heading to draw above this row: set only on the first row of a run. */
  heading: string | null;
  /** Hover text for the heading, e.g. the group's full path. */
  headingTitle?: string;
  /** The text for the row itself. */
  label: string;
  /** Sits under a heading, so the row is indented to show it. */
  grouped: boolean;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const startsWith = (path: string[], prefix: string[]) =>
  prefix.length <= path.length && prefix.every((p, i) => path[i] === p);

/**
 * A channel's name inside its group: "Torque Management Armed" under "Torque
 * Management" reads "Armed". The group's words come off only when all of them
 * lead the name and something is left. Part of a group's name is not enough:
 * under "Vehicle Speed Sensors", "Vehicle Speed Derivative" cut to
 * "Derivative" is indistinguishable from "Driveshaft RPM Derivative".
 */
export function inGroupLabel(name: string, group: string | undefined): string {
  if (!group) return name;
  const n = words(name);
  const g = words(group);
  let shared = 0;
  while (shared < n.length - 1 && shared < g.length && n[shared].toLowerCase() === g[shared].toLowerCase()) {
    shared++;
  }
  return shared === g.length ? n.slice(shared).join(" ") : name;
}

/** Shared leading words of `a` and `b`, leaving at least one word of each. */
function sharedWords(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length) - 1;
  let n = 0;
  while (n < max && a[n].toLowerCase() === b[n].toLowerCase()) n++;
  return n;
}

/** A shared start is only worth a heading when it is a real phrase. */
function usablePrefix(prefix: string[]): boolean {
  return prefix.length >= 2 || (prefix.length === 1 && prefix[0].length >= 8);
}

/** Group by shared leading words, for channels with no group of their own. */
function labelBySharedWords(names: string[], out: LegendLabel[], offset: number) {
  const split = names.map(words);
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
      out[offset + i].heading = split[i].slice(0, prefixLen).join(" ");
      for (let k = i; k < end; k++) {
        out[offset + k].label = split[k].slice(prefixLen).join(" ");
        out[offset + k].grouped = true;
      }
    }
    i = end;
  }
}

/**
 * @param names What each row would show on its own.
 * @param groups Each row's group path from the definition data, outermost
 *   first, or undefined where there is none.
 */
export function legendLabels(
  names: string[],
  groups?: (string[] | undefined)[],
): LegendLabel[] {
  const out: LegendLabel[] = names.map((label) => ({ heading: null, label, grouped: false }));
  const key = (i: number) => groups?.[i]?.join("\u0000");

  let i = 0;
  while (i < names.length) {
    if (key(i) === undefined) {
      // A stretch of rows the definition data says nothing about.
      let end = i + 1;
      while (end < names.length && key(end) === undefined) end++;
      labelBySharedWords(names.slice(i, end), out, i);
      i = end;
      continue;
    }

    // A channel from a subgroup ("Torque Management > Knob Function") joins
    // its parent's run, and the run takes the shallower of the two. A shared
    // top level alone ("Functions") is too broad to head anything.
    let path = groups![i]!;
    let end = i + 1;
    while (end < names.length) {
      const next = groups?.[end];
      if (!next) break;
      if (key(end) === path.join("\u0000")) {
        end++;
      } else if (path.length >= 2 && startsWith(next, path)) {
        end++;
      } else if (next.length >= 2 && startsWith(path, next)) {
        path = next;
        end++;
      } else {
        break;
      }
    }
    // One channel on its own needs no heading — its full name says more.
    if (end - i >= 2) {
      const leaf = path[path.length - 1];
      out[i].heading = leaf;
      out[i].headingTitle = path.join(" › ");
      for (let r = i; r < end; r++) {
        out[r].label = inGroupLabel(names[r], leaf);
        out[r].grouped = true;
      }
    }
    i = end;
  }
  return out;
}
