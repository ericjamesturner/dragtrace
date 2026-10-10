/** What a change to the car can be. Hardware changes are "big": passes either
 *  side of one don't belong in the same comparison. Tune and firmware changes
 *  are read from the logs and come often, so they aren't. */
export const CHANGE_CATEGORIES = [
  { key: "converter", label: "Converter" },
  { key: "engine", label: "Engine" },
  { key: "trans", label: "Trans" },
  { key: "gear", label: "Rear gear" },
  { key: "tires", label: "Tires" },
  { key: "suspension", label: "Suspension" },
  { key: "tune", label: "Tune" },
  { key: "firmware", label: "Firmware" },
  { key: "other", label: "Other" },
] as const;

export function categoryLabel(key: string): string {
  return CHANGE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function isBigChange(change: { category: string }): boolean {
  return change.category !== "tune" && change.category !== "firmware";
}
