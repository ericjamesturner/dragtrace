import type { ChannelDef } from "./log-types";

// ── Explicit channel → group path(s) mapping ──
// Channels can appear in multiple groups. Path format: "Group" or "Group/Subgroup".

export const CHANNEL_GROUPS: Record<string, string[]> = {
  // ── Engine ──
  "RPM":                              ["Engine"],
  "Unfiltered RPM":                   ["Engine"],
  "Engine Demand":                    ["Engine"],
  "Engine Limiter Max RPM":           ["Engine"],
  "Engine Pressure Ratio":            ["Engine", "Pressures/Engine"],
  "Flat Shift State":                 ["Engine"],
  "Engine Bump Input 1 State":        ["Engine"],
  "Engine Bump Output State":         ["Engine"],
  "Engine Limiting Function":         ["Engine/Protection"],
  "Engine Limiting Method":           ["Engine/Protection"],
  "Engine Protection Severity Level": ["Engine/Protection"],

  // ── Fuel ──
  "Base Fuel Tuning":                                    ["Fuel"],
  "Fuel - Load (MAP)":                                   ["Fuel"],
  "Calculated Air Mass Per Cylinder":                    ["Fuel"],
  "Fuel Composition":                                    ["Fuel"],
  "Fuel Generic 1 Correction (Act Like A Carb)":         ["Fuel"],
  "Fuel Pressure":                                       ["Fuel", "Pressures/Fuel"],
  "Fuel Pressure Expected":                              ["Fuel", "Pressures/Fuel"],
  "Injector 1 On Time":                                  ["Fuel/Injectors"],
  "Injector Pressure Differential":                      ["Fuel/Injectors", "Pressures/Fuel"],
  "Injection Stage 1 Average Injection Time":            ["Fuel/Injectors"],
  "Injection Stage 1 Dead Time":                         ["Fuel/Injectors"],
  "Injection Stage 1 Short Pulse Width Adder":           ["Fuel/Injectors"],
  "Injection Stage 1 Outputs Highest Duty Cycle":        ["Fuel/Injectors"],
  "Short Pulse Width Adder 1 Input Axis":                ["Fuel/Injectors"],
  "Transient Throttle Fuel Peak Synchronous Output":     ["Fuel/Transient Throttle"],
  "Transient Throttle Enrichment Load Derivative":       ["Fuel/Transient Throttle"],
  "Transient Throttle Enrichment Load Derivative Max":   ["Fuel/Transient Throttle"],
  "Transient Throttle Load Derivative":                  ["Fuel/Transient Throttle"],
  "Transient Throttle Enrichment Start Load":            ["Fuel/Transient Throttle"],

  // ── Air & Boost ──
  "Manifold Pressure":                           ["Air & Boost", "Pressures/Engine"],
  "Measured Manifold Pressure":                  ["Air & Boost", "Pressures/Engine"],
  "Predicted Manifold Pressure":                 ["Air & Boost", "Pressures/Engine"],
  "Manifold Pressure Derivative":                ["Air & Boost", "Pressures/Engine"],
  "Boost Control Output":                        ["Air & Boost/Boost Control"],
  "Boost Control Actual Pressure":               ["Air & Boost/Boost Control", "Pressures/Boost"],
  "Boost Control Target Pressure (Corrected)":   ["Air & Boost/Boost Control", "Pressures/Boost"],
  "Boost Control Solenoid Duty Cycle":           ["Air & Boost/Boost Control"],
  "Boost Control Short Term Trim":               ["Air & Boost/Boost Control"],
  "Boost Pressure Error":                        ["Air & Boost/Boost Control", "Pressures/Boost"],

  // ── Ignition ──
  "Ignition Angle":                              ["Ignition"],
  "Ignition 1 Angle":                            ["Ignition"],
  "Ignition - Load (MAP)":                       ["Ignition"],
  "Knock Sensor 1 Knock Signal":                 ["Ignition/Knock"],
  "Knock Sensor 1 Knock Level":                  ["Ignition/Knock"],
  "Knock Sensor 1 Knock Count":                  ["Ignition/Knock"],
  "Cylinders Knocking":                          ["Ignition/Knock"],
  "Knock Control Bank 1 Ignition Correction":    ["Ignition/Knock"],
  "Knock Control Bank 1 Long Term Trim":         ["Ignition/Knock"],

  // ── O2 & Lambda ──
  "Wideband O2 1":                               ["O2 & Lambda"],
  "Wideband O2 Overall":                         ["O2 & Lambda"],
  "Target Lambda":                               ["O2 & Lambda"],
  "O2 Control State":                            ["O2 & Lambda/O2 Control"],
  "O2 Control Bank 1 Output":                    ["O2 & Lambda/O2 Control"],
  "O2 Control Bank 1 Target":                    ["O2 & Lambda/O2 Control"],
  "O2 Control Bank 1 Error":                     ["O2 & Lambda/O2 Control"],
  "O2 Control Bank 1 Short Term Fuel Trim":      ["O2 & Lambda/O2 Control"],

  // ── Throttle & Pedal ──
  "Throttle Position":                           ["Throttle & Pedal"],
  "Throttle Position Derivative":                ["Throttle & Pedal"],
  "Drive By Wire Accelerator Pedal Position":    ["Throttle & Pedal"],
  "Drive By Wire Throttle 1 Target Position":    ["Throttle & Pedal"],
  "Drive By Wire Throttle 1 Status":             ["Throttle & Pedal"],
  "Pedal Position Source":                       ["Throttle & Pedal"],
  "Decel Detected":                              ["Throttle & Pedal"],
  "Decel Cut State":                             ["Throttle & Pedal", "Cuts & Limits"],
  "Idle Control Output":                         ["Throttle & Pedal/Idle Control"],
  "Idle Control RPM error":                      ["Throttle & Pedal/Idle Control"],
  "Idle Control Short Term Trim":                ["Throttle & Pedal/Idle Control"],
  "Idle Control target RPM":                     ["Throttle & Pedal/Idle Control"],
  "Throttle Blip RPM Target":                    ["Throttle & Pedal/Throttle Blip"],
  "Throttle Blip Gear":                          ["Throttle & Pedal/Throttle Blip"],
  "Throttle Blip Duration":                      ["Throttle & Pedal/Throttle Blip"],
  "Throttle Blip Amount":                        ["Throttle & Pedal/Throttle Blip"],

  // ── Drivetrain ──
  "Vehicle Speed":                               ["Drivetrain"],
  "Vehicle Speed Drive Train Sensor":            ["Drivetrain"],
  "Driven Wheel Speed":                          ["Drivetrain"],
  "Undriven Wheel Speed":                        ["Drivetrain"],
  "Driveshaft RPM":                              ["Drivetrain"],
  "Driveshaft RPM Derivative":                   ["Drivetrain"],
  "Driveshaft Pulse Count":                      ["Drivetrain"],
  "Gear":                                        ["Drivetrain"],
  "Gear Ratio":                                  ["Drivetrain"],
  "Odometer":                                    ["Drivetrain"],

  // ── Temperatures ──
  "Coolant Temperature":                         ["Temperatures"],
  "Intake Air Temperature":                      ["Temperatures"],
  "Oil Temperature":                             ["Temperatures"],

  // ── Pressures ──
  "Oil Pressure":                                ["Pressures"],
  "Brake Pressure Front":                        ["Pressures", "Brakes & Clutch"],

  // ── Brakes & Clutch ──
  "Brake Pedal State":                           ["Brakes & Clutch"],
  "Clutch State":                                ["Brakes & Clutch"],
  "Clutch Switch Input State":                   ["Brakes & Clutch"],

  // ── Cam Control ──
  "Cam Control Intake 1 Angle":                  ["Cam Control"],
  "Cam Control Intake Target Angle":             ["Cam Control"],
  "Cam Control Intake Bank 1 Output":            ["Cam Control"],
  "Cam Control Intake Bank 1 Error":             ["Cam Control"],
  "Cam Control Switched Output State Intake":    ["Cam Control"],

  // ── Electrical ──
  "Device Battery Voltage":                      ["Electrical"],
  "Trigger System Errors":                       ["Engine/Trigger"],
  "Trigger System Error Count":                  ["Engine/Trigger"],
  "Trigger Voltage":                             ["Engine/Trigger"],
  "Check Engine Light Output State":             ["Electrical"],
  "Thermofan 1 Output State":                    ["Electrical"],

  // ── Outputs ──
  "Generic Output 1 Out (Secondary Circuits)":   ["Outputs"],
  "Generic Output 2 Out (Wipers)":               ["Outputs"],
  "Generic Output 3 Out (Fog Lamps)":            ["Outputs"],
  "Generic Output 4 Out (Speedometer)":          ["Outputs"],
  "Generic Output 5 Out (Heater)":               ["Outputs"],
  "Generic Output 6 Out (Stereo system)":        ["Outputs"],
  "Generic Output 7 Out (Coolant Temp Gauge)":   ["Outputs"],
  "Generic Output 8 Out (Oil Pressure Gauge)":   ["Outputs"],
  "Generic Output 9 Out (Boost Gauge)":          ["Outputs"],
  "Generic Output 10 Out (Speed & USB)":         ["Outputs"],

  // ── Cuts & Limits ──
  "Cut Percentage":                              ["Cuts & Limits"],
  "Cut Percentage Function":                     ["Cuts & Limits"],
};

// ── Keyword fallback for channels not in the explicit map ──
// Checked in order; first match wins per-channel (more specific rules first).

export const KEYWORD_FALLBACK: { path: string; keywords: string[] }[] = [
  { path: "Engine/Trigger",                 keywords: ["trigger system", "trigger voltage"] },
  { path: "Engine/Protection",              keywords: ["engine limiting", "engine protection"] },
  { path: "Engine/Traction Control",        keywords: ["traction control"] },
  { path: "Torque Management",               keywords: ["torque management", "torque model"] },
  { path: "Engine",                         keywords: ["rpm", "engine"] },
  { path: "Fuel/Injectors",                 keywords: ["injector", "injection stage", "short pulse width"] },
  { path: "Fuel/Transient Throttle",        keywords: ["transient throttle"] },
  { path: "Fuel",                           keywords: ["fuel", "air mass"] },
  { path: "Air & Boost/Boost Control",      keywords: ["boost control", "boost solenoid"] },
  { path: "Air & Boost",                    keywords: ["manifold", "boost"] },
  { path: "Ignition/Knock",                 keywords: ["knock", "cylinders knocking"] },
  { path: "Ignition",                       keywords: ["ignition"] },
  { path: "O2 & Lambda/O2 Control",         keywords: ["o2 control", "fuel trim"] },
  { path: "O2 & Lambda",                    keywords: ["wideband", "lambda", "afr", "o2"] },
  { path: "Throttle & Pedal/Idle Control",  keywords: ["idle control"] },
  { path: "Throttle & Pedal/Throttle Blip", keywords: ["throttle blip"] },
  { path: "Throttle & Pedal",               keywords: ["throttle", "pedal", "drive by wire", "decel"] },
  { path: "Drivetrain",                     keywords: ["vehicle speed", "wheel speed", "driveshaft", "gear", "odometer"] },
  { path: "Temperatures",                   keywords: ["temperature"] },
  { path: "Pressures",                      keywords: ["pressure"] },
  { path: "Brakes & Clutch",                keywords: ["brake", "clutch"] },
  { path: "Cam Control",                    keywords: ["cam control"] },
  { path: "Electrical",                     keywords: ["voltage", "battery", "check engine", "thermofan"] },
  { path: "Outputs",                        keywords: ["generic output"] },
  { path: "Cuts & Limits",                  keywords: ["cut percentage", "cut state"] },
];

export const GROUP_ORDER = [
  "Engine", "Fuel", "Air & Boost", "Ignition", "O2 & Lambda",
  "Throttle & Pedal", "Drivetrain", "Torque Management", "Temperatures", "Pressures",
  "Brakes & Clutch", "Cam Control", "Electrical", "Outputs", "Cuts & Limits", "Other",
];

export const SUBGROUP_ORDER: Record<string, string[]> = {
  Engine: ["Trigger", "Protection", "Traction Control"],
  Fuel: ["Injectors", "Transient Throttle"],
  "Air & Boost": ["Boost Control"],
  Ignition: ["Knock"],
  "O2 & Lambda": ["O2 Control"],
  "Throttle & Pedal": ["Idle Control", "Throttle Blip"],
  Pressures: ["Engine", "Boost", "Fuel"],
};

export const GROUP_COLORS: Record<string, string> = {
  Engine: "#ef4444", Fuel: "#f97316", "Air & Boost": "#06b6d4",
  Ignition: "#eab308", "O2 & Lambda": "#22c55e", "Throttle & Pedal": "#a855f7",
  Drivetrain: "#3b82f6", Temperatures: "#f43f5e", Pressures: "#14b8a6",
  "Brakes & Clutch": "#ec4899", "Cam Control": "#8b5cf6", Electrical: "#facc15",
  "Torque Management": "#d946ef", Outputs: "#64748b", "Cuts & Limits": "#fb923c", Other: "#6b7280",
};

/** A channel entry in a group, with a short display name for context. */
export interface GroupChannel {
  def: ChannelDef;
  /** Short name with the parent subgroup prefix stripped. */
  displayName: string;
  /** Searchable alternate names (e.g. ["TPS", "Throttle"]) */
  aliases?: string[];
}

export interface GroupNode {
  tag: string;
  channels: GroupChannel[];
  children: GroupNode[];
}

export function getChannelPaths(name: string): string[] {
  const explicit = CHANNEL_GROUPS[name];
  if (explicit) return explicit;
  const lower = name.toLowerCase();
  const paths: string[] = [];
  for (const rule of KEYWORD_FALLBACK) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      // If we already have a match, skip broad root-only rules —
      // e.g. don't also match "Engine" via "rpm" when we already
      // matched "Torque Management" via "torque management".
      if (paths.length > 0 && !rule.path.includes("/")) continue;
      paths.push(rule.path);
    }
  }
  return paths;
}

/**
 * Strip a prefix from a channel name for display within a subgroup.
 * "Torque Management Driveshaft RPM Target" inside "Torque Management"
 * → "Driveshaft RPM Target"
 *
 * Only strips if the result is non-empty.
 */
function stripPrefix(name: string, prefix: string): string {
  const lower = name.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower.startsWith(prefixLower)) {
    const rest = name.substring(prefix.length).trimStart();
    if (rest.length > 0) return rest;
  }
  return name;
}

/**
 * Auto-subgroup: for channels sitting directly in a root group,
 * find shared multi-word prefixes (2+ words, 2+ channels sharing it)
 * and pull them into auto-created subgroups.
 *
 * Only one level of subgrouping — no sub-sub-groups.
 * Only creates a subgroup if it doesn't already exist.
 */
function autoSubgroup(root: GroupNode) {
  if (root.channels.length < 2) return;

  // Build a map of 2-word prefixes → channels that have that prefix
  const prefixMap = new Map<string, GroupChannel[]>();
  for (const ch of root.channels) {
    const words = ch.def.name.split(" ");
    if (words.length < 2) continue;
    // Use exactly the first 2 words as the prefix
    const prefix = words.slice(0, 2).join(" ");
    const list = prefixMap.get(prefix) ?? [];
    list.push(ch);
    prefixMap.set(prefix, list);
  }

  const movedNames = new Set<string>();
  for (const [prefix, chs] of prefixMap) {
    if (chs.length < 2) continue;
    // Skip if subgroup already exists with this name
    if (root.children.some((c) => c.tag === prefix)) continue;
    // Skip if the prefix is the same as the root tag (would be redundant)
    if (prefix.toLowerCase() === root.tag.toLowerCase()) continue;

    // Create the subgroup with short display names
    root.children.push({
      tag: prefix,
      channels: chs.map((ch) => ({
        def: ch.def,
        displayName: stripPrefix(ch.def.name, prefix),
      })),
      children: [],
    });
    for (const ch of chs) movedNames.add(ch.def.name);
  }

  if (movedNames.size > 0) {
    root.channels = root.channels.filter((ch) => !movedNames.has(ch.def.name));
  }
}

export function buildTree(defs: ChannelDef[]): GroupNode[] {
  const rootMap = new Map<string, GroupNode>();

  const getOrCreateRoot = (tag: string): GroupNode => {
    let node = rootMap.get(tag);
    if (!node) { node = { tag, channels: [], children: [] }; rootMap.set(tag, node); }
    return node;
  };

  const getOrCreateChild = (root: GroupNode, childTag: string): GroupNode => {
    let child = root.children.find((c) => c.tag === childTag);
    if (!child) { child = { tag: childTag, channels: [], children: [] }; root.children.push(child); }
    return child;
  };

  for (const def of defs) {
    const paths = getChannelPaths(def.name);
    if (paths.length === 0) {
      getOrCreateRoot("Other").channels.push({ def, displayName: def.name });
      continue;
    }
    for (const path of paths) {
      const slash = path.indexOf("/");
      if (slash === -1) {
        getOrCreateRoot(path).channels.push({ def, displayName: def.name });
      } else {
        const rootTag = path.substring(0, slash);
        const childTag = path.substring(slash + 1);
        const child = getOrCreateChild(getOrCreateRoot(rootTag), childTag);
        child.channels.push({ def, displayName: stripPrefix(def.name, childTag) });
      }
    }
  }

  // Auto-subgroup: cluster root-level channels by shared 2-word prefixes
  for (const root of rootMap.values()) {
    autoSubgroup(root);
  }

  const roots = [...rootMap.values()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.tag);
    const bi = GROUP_ORDER.indexOf(b.tag);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const root of roots) {
    const order = SUBGROUP_ORDER[root.tag];
    if (order) {
      root.children.sort((a, b) => {
        const ai = order.indexOf(a.tag);
        const bi = order.indexOf(b.tag);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    }
  }

  return roots;
}
