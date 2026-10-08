/**
 * Short names that tell runs apart when several are on one chart.
 *
 * Racers name runs by round — "BOISE CLASSIC T2 4.15 180.45", "Boise T1
 * 4.368" — so a round token (T1, Q2, E3) is the tag whenever every run has a
 * different one. Otherwise the tag is the first word that differs between
 * them, compared without case: "BOISE" and "Boise" are the same word, and the
 * legend shows tags in capitals. One run, or runs nothing tells apart, keep
 * their names.
 */

/** A round: one or two letters and a number — T1, Q2, E3, R12. */
const ROUND = /^[A-Z]{1,2}\d{1,2}$/i;

const distinct = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase())).size === xs.length;

export function runTags(names: string[]): string[] {
  if (names.length <= 1) return names;
  const tokens = names.map((n) => n.trim().split(/\s+/).filter(Boolean));

  const rounds = tokens.map((t) => t.find((w) => ROUND.test(w)) ?? "");
  if (rounds.every(Boolean) && distinct(rounds)) return rounds.map((r) => r.toUpperCase());

  const depth = Math.min(4, Math.max(0, ...tokens.map((t) => t.length)));
  for (let i = 0; i < depth; i++) {
    const candidate = tokens.map((t) => t[i] ?? "");
    if (candidate.every(Boolean) && distinct(candidate)) return candidate;
  }
  return names;
}

/** An elapsed time as racers write it in a file name: 4.15, 4.368, 7.082. */
const ET = /^\d{1,2}\.\d{2,3}$/;

/**
 * Tags with the run's ET beside them — "T1 - 4.368" — so a legend row says
 * which pass it is without hovering. The ET is read from the name, where
 * racers put it; a name without one keeps the bare tag.
 */
export function runLabels(names: string[]): string[] {
  const tags = runTags(names);
  if (names.length <= 1) return tags;
  return tags.map((tag, i) => {
    const et = names[i].trim().split(/\s+/).find((w) => ET.test(w));
    return et && et !== tag ? `${tag} - ${et}` : tag;
  });
}
