/** What a change to the car can be. Every one but a tune change is "big":
 *  passes either side of it don't belong in the same comparison. */
export const CHANGE_CATEGORIES = [
  { key: "converter", label: "Converter" },
  { key: "engine", label: "Engine" },
  { key: "trans", label: "Trans" },
  { key: "gear", label: "Rear gear" },
  { key: "tires", label: "Tires" },
  { key: "suspension", label: "Suspension" },
  { key: "tune", label: "Tune" },
  { key: "other", label: "Other" },
] as const;

export function categoryLabel(key: string): string {
  return CHANGE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function isBigChange(change: { category: string }): boolean {
  return change.category !== "tune";
}
