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
  /** On a heading row: how many rows the heading covers, this one included. */
  run?: number;
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
      out[offset + i].run = end - i;
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
      out[i].run = end - i;
      for (let r = i; r < end; r++) {
        out[r].label = inGroupLabel(names[r], leaf);
        out[r].grouped = true;
      }
    }
    i = end;
  }
  return out;
}

/** Heading for channels the definition data puts in no category. */
const UNCATEGORISED = "Other";

/**
 * The panel listed by category instead of in trace order: every channel under
 * a heading, categories in the order they first appear, channels in trace
 * order within them, and anything without a category last.
 *
 * A category is the channel's group, unless no other channel on the trace
 * shares it — then its parent, so one oil-pressure channel sits under
 * "Sensors" rather than a heading of its own. The top level always stands.
 *
 * @returns `order`: indexes into `names` in display order; `labels`: one per
 *   display position.
 */
export function categoryLabels(
  names: string[],
  groups: (string[] | undefined)[],
): { order: number[]; labels: LegendLabel[] } {
  const key = (path: string[]) => path.join("\u0000");
  const counts = new Map<string, number>();
  for (const g of groups) {
    if (!g) continue;
    for (let depth = 1; depth <= g.length; depth++) {
      const k = key(g.slice(0, depth));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const categories = new Map<string, { path: string[] | null; members: number[] }>();
  names.forEach((_, i) => {
    const g = groups[i];
    let path: string[] | null = null;
    if (g && g.length > 0) {
      let depth = g.length;
      while (depth > 1 && (counts.get(key(g.slice(0, depth))) ?? 0) < 2) depth--;
      path = g.slice(0, depth);
    }
    const k = path ? key(path) : "";
    const cat = categories.get(k) ?? { path, members: [] };
    cat.members.push(i);
    categories.set(k, cat);
  });

  // Uncategorised last, whatever the trace order.
  const ordered = [...categories.values()].sort((a, b) => Number(!a.path) - Number(!b.path));
  const order: number[] = [];
  const labels: LegendLabel[] = [];
  for (const { path, members } of ordered) {
    const leaf = path ? path[path.length - 1] : UNCATEGORISED;
    members.forEach((i, m) => {
      order.push(i);
      labels.push({
        heading: m === 0 ? leaf : null,
        headingTitle: m === 0 && path ? path.join(" › ") : undefined,
        run: m === 0 ? members.length : undefined,
        label: path ? inGroupLabel(names[i], leaf) : names[i],
        grouped: true,
      });
    });
  }
  return { order, labels };
}
