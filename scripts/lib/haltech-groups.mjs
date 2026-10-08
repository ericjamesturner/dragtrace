// Haltech's group names for the object tree, shared by the channel and the
// tune definition generators. The tree's own segment names are internal
// ("HCO25", "WIDEBAND_AVG", "FuelAdditonalTables"); most containers carry a
// display name in the definition, and the ones that don't are named here.

// The object tree's own segment names are internal ("HCO25", "WIDEBAND_AVG",
// "FuelAdditonalTables"). Most containers carry a display name in the
// definition; the ones that don't — mostly the top level — are named here.
export const SEGMENT_NAMES = {
  Functions: "Functions",
  Sensors: "Sensors",
  InjectionSystem: "Injection System",
  FuelSystem: "Fuel System",
  IgnitionSystem: "Ignition System",
  SparkTiming: "Ignition Timing",
  ElectronicThrottle: "Electronic Throttle",
  Trigger: "Trigger",
  EngineDescription: "Engine",
  EngineParameters: "Engine",
  EngineRuntimeInfo: "Engine",
  VehicleDescription: "Vehicle",
  DTC_Codes: "Fault Codes",
  DTC: "Fault Codes",
  DTC_LIST: "Fault Codes",
  AVI: "Analogue Voltage Inputs",
  SPI: "Synced Pulse Inputs",
  DPO: "Digital Pulsed Outputs",
  HBO: "Half Bridge Outputs",
  HCO8: "8A High Current Outputs",
  HCO25: "25A High Current Outputs",
  INJ: "Injector Outputs",
  IGN: "Ignition Outputs",
  GENERIC_TIMER: "Generic Timers",
  POWER_MAN: "Power Management",
  POWER_MAN_DEVICE: "Power Management",
  CAN_MATRIX: "CAN Signals",
  CAN_system: "CAN",
  CAN_PORT: "CAN",
  THIRD_PARTY_CAN: "Third Party CAN",
  INTERNAL_WBI: "Internal Wideband",
  INTERNAL_IMU: "Internal IMU",
  KNOCK_INPUTS: "Knock Inputs",
  DataLogging: "Data Logging",
  DASH: "Dash",
  Devices: "Devices",
  System: "System",
  Limiter: "Limiters",
  Switches: "Switches",
  Scheduler: "Scheduler",
  Button: "Buttons",
  // Second level, where the definition carries no name.
  N2O: "Nitrous",
  WIDEBAND_AVG: "Wideband Averaging",
  FuelAdditonalTables: "Fuel Corrections",
  SparkAdditonalTables: "Ignition Corrections",
  IgnitionOutputs: "Ignition Outputs",
  AIR_PRESSURE: "Air Pressure",
  EGT_Cyl_SHUTDOWN: "EGT Cylinder Shutdown",
  MISC: "Miscellaneous",
  VEHICLE_SPEED: "Vehicle Speed",
  FUEL_PRESSURE: "Fuel Pressure",
  AirSystem: "Air System",
  ATMOSPHERIC_DATA: "Atmospheric Data",
  RTC: "Clock",
  UserLogging: "User Logging",
  CONTROLLERS: "Controllers",
  ENABLERS: "Enablers",
  TPS: "Throttle Position",
  APP: "Accelerator Pedal",
  HOME: "Home",
  FuelLevel: "Fuel Level",
};

/** Segments that carry no grouping information of their own. */
const SKIP_SEGMENTS = new Set(["Settings", "VALUE", "VALUES", "Value", "Values"]);

/** Most specific first; groups deeper than this fold into their parent. */
const MAX_DEPTH = 3;

/** A definition name fit to show: not an internal identifier or stray prose. */
export function cleanName(s) {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || t.startsWith("_") || t.length > 48 || /[.:]/.test(t)) return null;
  if (/^[A-Z0-9_]+$/.test(t) && t.includes("_")) return null;
  return t;
}

/** Short words kept in capitals when a segment is spelled out. */
const ACRONYMS = new Set(["ECU", "RPM", "TPS", "GPS", "DTC", "CAN", "IO", "EGT", "TMS", "TCA", "WBC", "OBPS", "AC", "DC"]);

/** Every path segment in every pack, for telling 0-based numbering apart. */
export const allSegments = new Set();

export function prettify(seg) {
  // The tree numbers from zero ("STAGE_0" holds Injection Stage 1); the names
  // users see number from one. A segment family is 0-based if it has a _0.
  const numbered = seg.match(/^(.*)_(\d+)$/);
  if (numbered && allSegments.has(`${numbered[1]}_0`)) {
    const n = Number(numbered[2]) + 1;
    // A lone _0 is not one of a series; the number only adds noise.
    const label = n === 1 && !allSegments.has(`${numbered[1]}_1`) ? "" : ` ${n}`;
    return prettify(numbered[1]) + label;
  }
  // CamelCase splits into words; a capitals token ("TI4L") is one word.
  const words = seg.includes("_") || seg.includes(" ") || !/[a-z]/.test(seg)
    ? seg.split(/[_\s]+/)
    : seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words
    .filter(Boolean)
    .map((w) => {
      const upper = w === w.toUpperCase();
      // "PD16", "TI4L", "CO2": model and part names stay as written.
      if (upper && (/\d/.test(w) || ACRONYMS.has(w))) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Segments named by `prettify`, reported so the table above can be extended. */
export const fallbacks = new Map();

/** Display names for the groups above a channel, outermost first. */
export function groupNames(path, packGroups) {
  const segments = path.split("/");
  const names = [];
  // The final segment names the channel itself, not a group.
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!seg || SKIP_SEGMENTS.has(seg)) continue;
    const g = packGroups[segments.slice(0, i + 1).join("/")];
    const name = cleanName(g?.L) ?? cleanName(g?.m) ?? SEGMENT_NAMES[seg];
    if (name) {
      names.push(name);
    } else if (!seg.startsWith("_")) {
      // Underscore segments are internal plumbing with no name of their own.
      names.push(prettify(seg));
      fallbacks.set(seg, (fallbacks.get(seg) ?? 0) + 1);
    }
  }
  // A container often repeats its parent's name ("Nitrous" > "Nitrous").
  const deduped = names.filter((n, i) => i === 0 || n.toLowerCase() !== names[i - 1].toLowerCase());
  return deduped.slice(0, MAX_DEPTH);
}


/** Record every path segment of the packs, so prettify can tell 0-based series. */
export function indexSegments(packs) {
  for (const pack of packs) {
    for (const v of Object.values(pack.defs ?? {})) for (const seg of (v.p ?? "").split("/")) allSegments.add(seg);
  }
}
