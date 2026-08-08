// GENERATED FILE — do not edit by hand.
// Run `npm run gen:quantities` to regenerate from src/lib/ecu/haltech-units.json.
//
// 118 quantities, 204 alternates,
// 41 of which offer a choice of display unit.

import type { Quantity } from "./types";

export const GENERATED_QUANTITIES: Record<string, Quantity> = {
  "raw": {
    "slug": "raw",
    "name": "Raw",
    "sourceId": 0,
    "alternates": [
      {
        "key": "alt-0",
        "label": " ",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "alt-0",
    "imperialKey": "alt-0"
  },
  "engine-speed": {
    "slug": "engine-speed",
    "name": "Engine Speed",
    "sourceId": 1,
    "alternates": [
      {
        "key": "rpm",
        "label": "RPM",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "rpm",
    "imperialKey": "rpm"
  },
  "percentage": {
    "slug": "percentage",
    "name": "Percentage",
    "sourceId": 2,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "pressure": {
    "slug": "pressure",
    "name": "Pressure",
    "sourceId": 3,
    "alternates": [
      {
        "key": "kpa",
        "label": "kPa",
        "dp": 1,
        "scale": 0.1,
        "offset": -101.3
      },
      {
        "key": "kpa-abs",
        "label": "kPa (Abs.)",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mbar-abs",
        "label": "mbar (Abs.)",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "bar-abs",
        "label": "bar (Abs.)",
        "dp": 3,
        "scale": 0.001000000011,
        "offset": 0
      },
      {
        "key": "kg-cm2",
        "label": "kg/cm²",
        "dp": 2,
        "scale": 0.001019999981,
        "offset": -1.033259980679
      },
      {
        "key": "psi",
        "label": "psi",
        "dp": 1,
        "scale": 0.0145,
        "offset": -14.6885
      },
      {
        "key": "inhg",
        "label": "inHg",
        "dp": 1,
        "scale": 0.029530000687,
        "offset": -29.913890695572
      },
      {
        "key": "psi-abs",
        "label": "psi (Abs.)",
        "dp": 1,
        "scale": 0.014313919052,
        "offset": 0
      }
    ],
    "metricKey": "kpa",
    "imperialKey": "psi"
  },
  "speed": {
    "slug": "speed",
    "name": "Speed",
    "sourceId": 4,
    "alternates": [
      {
        "key": "km-h",
        "label": "km/h",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mph",
        "label": "mph",
        "dp": 1,
        "scale": 0.062137119293,
        "offset": 0
      }
    ],
    "metricKey": "km-h",
    "imperialKey": "mph"
  },
  "temperature": {
    "slug": "temperature",
    "name": "Temperature",
    "sourceId": 5,
    "alternates": [
      {
        "key": "degc",
        "label": "°C",
        "dp": 0,
        "scale": 0.1,
        "offset": -273.1
      },
      {
        "key": "degf",
        "label": "°F",
        "dp": 0,
        "scale": 0.18,
        "offset": -459.58
      }
    ],
    "metricKey": "degc",
    "imperialKey": "degf"
  },
  "afr": {
    "slug": "afr",
    "name": "AFR",
    "sourceId": 6,
    "alternates": [
      {
        "key": "lambda",
        "label": "λ",
        "dp": 2,
        "scale": 0.001000000011,
        "offset": 0
      },
      {
        "key": "afr-14-71",
        "label": "AFR (14.71)",
        "dp": 1,
        "scale": 0.014705882353,
        "offset": 0
      },
      {
        "key": "afr-6-47",
        "label": "AFR (6.47)",
        "dp": 2,
        "scale": 0.006470588376,
        "offset": 0
      },
      {
        "key": "afr-9",
        "label": "AFR (9)",
        "dp": 2,
        "scale": 0.008999999832,
        "offset": 0
      }
    ],
    "metricKey": "lambda",
    "imperialKey": "lambda"
  },
  "voltage": {
    "slug": "voltage",
    "name": "Voltage",
    "sourceId": 7,
    "alternates": [
      {
        "key": "volts",
        "label": "Volts",
        "dp": 2,
        "scale": 0.004887585533,
        "offset": 0
      }
    ],
    "metricKey": "volts",
    "imperialKey": "volts"
  },
  "battery-voltage": {
    "slug": "battery-voltage",
    "name": "Battery Voltage",
    "sourceId": 8,
    "alternates": [
      {
        "key": "volts",
        "label": "Volts",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "volts",
    "imperialKey": "volts"
  },
  "time-s": {
    "slug": "time-s",
    "name": "Time s",
    "sourceId": 9,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "time-ms": {
    "slug": "time-ms",
    "name": "Time ms",
    "sourceId": 10,
    "alternates": [
      {
        "key": "ms",
        "label": "ms",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "ms",
    "imperialKey": "ms"
  },
  "time-us": {
    "slug": "time-us",
    "name": "Time us",
    "sourceId": 11,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 3,
        "scale": 0.000001,
        "offset": 0
      },
      {
        "key": "ms",
        "label": "ms",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "mass-per-cyl": {
    "slug": "mass-per-cyl",
    "name": "Mass Per Cyl",
    "sourceId": 12,
    "alternates": [
      {
        "key": "g-cyl",
        "label": "g/Cyl",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "grains-cyl",
        "label": "grains/Cyl",
        "dp": 2,
        "scale": 0.015432358742,
        "offset": 0
      }
    ],
    "metricKey": "g-cyl",
    "imperialKey": "grains-cyl"
  },
  "angle": {
    "slug": "angle",
    "name": "Angle",
    "sourceId": 13,
    "alternates": [
      {
        "key": "deg",
        "label": "°",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "deg",
    "imperialKey": "deg"
  },
  "mass": {
    "slug": "mass",
    "name": "Mass",
    "sourceId": 14,
    "alternates": [
      {
        "key": "g",
        "label": "g",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "grains",
        "label": "grains",
        "dp": 1,
        "scale": 0.015432358742,
        "offset": 0
      }
    ],
    "metricKey": "g",
    "imperialKey": "grains"
  },
  "engine-volume": {
    "slug": "engine-volume",
    "name": "Engine Volume",
    "sourceId": 15,
    "alternates": [
      {
        "key": "cc",
        "label": "cc",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "l",
        "label": "L",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "cid",
        "label": "CID",
        "dp": 0,
        "scale": 0.061023742676,
        "offset": 0
      }
    ],
    "metricKey": "cc",
    "imperialKey": "cid"
  },
  "mass-over-time": {
    "slug": "mass-over-time",
    "name": "Mass Over Time",
    "sourceId": 16,
    "alternates": [
      {
        "key": "g-s",
        "label": "g/s",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "kg-hr",
        "label": "kg/hr",
        "dp": 2,
        "scale": 0.036,
        "offset": 0
      },
      {
        "key": "lb-hr",
        "label": "lb/hr",
        "dp": 2,
        "scale": 0.079366401672,
        "offset": 0
      }
    ],
    "metricKey": "g-s",
    "imperialKey": "lb-hr"
  },
  "ratio": {
    "slug": "ratio",
    "name": "Ratio",
    "sourceId": 17,
    "alternates": [
      {
        "key": "1",
        "label": ": 1",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "1",
    "imperialKey": "1"
  },
  "flow": {
    "slug": "flow",
    "name": "Flow",
    "sourceId": 18,
    "alternates": [
      {
        "key": "cc-min",
        "label": "cc/min",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "gal-hr",
        "label": "gal/hr",
        "dp": 2,
        "scale": 0.015850322723,
        "offset": 0
      },
      {
        "key": "inj-lb-hr",
        "label": "Inj lb/hr",
        "dp": 2,
        "scale": 0.095238098145,
        "offset": 0
      },
      {
        "key": "gal-min",
        "label": "gal/min",
        "dp": 2,
        "scale": 0.000264171988,
        "offset": 0
      },
      {
        "key": "inj-lb-min",
        "label": "Inj lb/min",
        "dp": 2,
        "scale": 0.001587301612,
        "offset": 0
      },
      {
        "key": "meth-lb-hr",
        "label": "Meth lb/hr",
        "dp": 2,
        "scale": 0.104737083435,
        "offset": 0
      }
    ],
    "metricKey": "cc-min",
    "imperialKey": "cc-min"
  },
  "relative-load": {
    "slug": "relative-load",
    "name": "Relative Load",
    "sourceId": 19,
    "alternates": [
      {
        "key": "pctebp",
        "label": "%EBP",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "pctebp",
    "imperialKey": "pctebp"
  },
  "acceleration": {
    "slug": "acceleration",
    "name": "Acceleration",
    "sourceId": 20,
    "alternates": [
      {
        "key": "m-s2",
        "label": "m/s²",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "g",
        "label": "g",
        "dp": 2,
        "scale": 0.010193679918,
        "offset": 0
      }
    ],
    "metricKey": "m-s2",
    "imperialKey": "g"
  },
  "angular-velocity": {
    "slug": "angular-velocity",
    "name": "Angular Velocity",
    "sourceId": 21,
    "alternates": [
      {
        "key": "deg-s",
        "label": "°/s",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "deg-s",
    "imperialKey": "deg-s"
  },
  "sm-steps": {
    "slug": "sm-steps",
    "name": "SM Steps",
    "sourceId": 22,
    "alternates": [
      {
        "key": "steps",
        "label": "steps",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "steps",
    "imperialKey": "steps"
  },
  "ms-per-eng-cyl": {
    "slug": "ms-per-eng-cyl",
    "name": "ms Per Eng Cyl",
    "sourceId": 23,
    "alternates": [
      {
        "key": "ms-ecyc",
        "label": "ms/ECyc",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "ms-ecyc",
    "imperialKey": "ms-ecyc"
  },
  "deg-per-eng-cyl": {
    "slug": "deg-per-eng-cyl",
    "name": "deg Per Eng Cyl",
    "sourceId": 24,
    "alternates": [
      {
        "key": "deg-ecyc",
        "label": "°/ECyc",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "deg-ecyc",
    "imperialKey": "deg-ecyc"
  },
  "short-distance": {
    "slug": "short-distance",
    "name": "Short Distance",
    "sourceId": 25,
    "alternates": [
      {
        "key": "m",
        "label": "m",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "ft",
        "label": "ft",
        "dp": 0,
        "scale": 0.328084,
        "offset": 0
      }
    ],
    "metricKey": "m",
    "imperialKey": "ft"
  },
  "frequency": {
    "slug": "frequency",
    "name": "Frequency",
    "sourceId": 26,
    "alternates": [
      {
        "key": "hz",
        "label": "Hz",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "hz",
    "imperialKey": "hz"
  },
  "abs-pressure": {
    "slug": "abs-pressure",
    "name": "Abs Pressure",
    "sourceId": 27,
    "alternates": [
      {
        "key": "kpa-abs",
        "label": "kPa (Abs.)",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mbar-abs",
        "label": "mbar (Abs.)",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "bar-abs",
        "label": "bar (Abs.)",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "kg-cm2-abs",
        "label": "kg/cm² (Abs.)",
        "dp": 2,
        "scale": 0.001019999981,
        "offset": 0
      },
      {
        "key": "psi-abs",
        "label": "psi (Abs.)",
        "dp": 1,
        "scale": 0.0145,
        "offset": 0
      }
    ],
    "metricKey": "kpa-abs",
    "imperialKey": "psi-abs"
  },
  "density": {
    "slug": "density",
    "name": "Density",
    "sourceId": 28,
    "alternates": [
      {
        "key": "kg-m3",
        "label": "kg/m³",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "g-l",
        "label": "g/L",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "kg-m3",
    "imperialKey": "kg-m3"
  },
  "stoichiometry": {
    "slug": "stoichiometry",
    "name": "Stoichiometry",
    "sourceId": 29,
    "alternates": [
      {
        "key": "afr",
        "label": "AFR",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "afr",
    "imperialKey": "afr"
  },
  "percentage1-for1": {
    "slug": "percentage1-for1",
    "name": "Percentage1 For1",
    "sourceId": 30,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "percentage-inj-air-temp-corr": {
    "slug": "percentage-inj-air-temp-corr",
    "name": "Percentage Inj Air Temp Corr",
    "sourceId": 31,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 0.1,
        "offset": -12.5
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "percentage-inj-baro-corr": {
    "slug": "percentage-inj-baro-corr",
    "name": "Percentage Inj Baro Corr",
    "sourceId": 32,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 0.5,
        "offset": -50
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "time-us4-for1": {
    "slug": "time-us4-for1",
    "name": "Time us4 For1",
    "sourceId": 33,
    "alternates": [
      {
        "key": "ms",
        "label": "ms",
        "dp": 3,
        "scale": 0.004,
        "offset": 0
      }
    ],
    "metricKey": "ms",
    "imperialKey": "ms"
  },
  "percentage4-for1": {
    "slug": "percentage4-for1",
    "name": "Percentage4 For1",
    "sourceId": 34,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 2,
        "scale": 0.25,
        "offset": 0
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "angle-ign-sprt2-k": {
    "slug": "angle-ign-sprt2-k",
    "name": "Angle Ign Sprt2 K",
    "sourceId": 35,
    "alternates": [
      {
        "key": "deg",
        "label": "°",
        "dp": 1,
        "scale": 0.1,
        "offset": -20
      }
    ],
    "metricKey": "deg",
    "imperialKey": "deg"
  },
  "angle-offset10deg": {
    "slug": "angle-offset10deg",
    "name": "Angle Offset10deg",
    "sourceId": 36,
    "alternates": [
      {
        "key": "deg",
        "label": "°",
        "dp": 1,
        "scale": 0.1,
        "offset": -10
      }
    ],
    "metricKey": "deg",
    "imperialKey": "deg"
  },
  "time-s20-for1": {
    "slug": "time-s20-for1",
    "name": "Time s20 For1",
    "sourceId": 37,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 2,
        "scale": 0.050000000745,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "time-s10-for1": {
    "slug": "time-s10-for1",
    "name": "Time s10 For1",
    "sourceId": 38,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 1,
        "scale": 0.10000000149,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "time-s200-for1": {
    "slug": "time-s200-for1",
    "name": "Time s200 For1",
    "sourceId": 39,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 3,
        "scale": 0.004999999888,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "percentage2-for1": {
    "slug": "percentage2-for1",
    "name": "Percentage2 For1",
    "sourceId": 40,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 0.5,
        "offset": 0
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "percentage-map-corr": {
    "slug": "percentage-map-corr",
    "name": "Percentage Map Corr",
    "sourceId": 41,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 0.5,
        "offset": -100
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "percentage-egt-corr": {
    "slug": "percentage-egt-corr",
    "name": "Percentage EGT Corr",
    "sourceId": 42,
    "alternates": [
      {
        "key": "pct",
        "label": "%",
        "dp": 1,
        "scale": 1,
        "offset": -100
      }
    ],
    "metricKey": "pct",
    "imperialKey": "pct"
  },
  "time-s100-for1": {
    "slug": "time-s100-for1",
    "name": "Time s100 For1",
    "sourceId": 43,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "time-ms1-for10": {
    "slug": "time-ms1-for10",
    "name": "Time ms1 For10",
    "sourceId": 44,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 2,
        "scale": 0.009999999776,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "long-distance": {
    "slug": "long-distance",
    "name": "Long Distance",
    "sourceId": 45,
    "alternates": [
      {
        "key": "km",
        "label": "km",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "mi",
        "label": "mi",
        "dp": 0,
        "scale": 0.621371191406,
        "offset": 0
      }
    ],
    "metricKey": "km",
    "imperialKey": "mi"
  },
  "time-ms200-for1": {
    "slug": "time-ms200-for1",
    "name": "Time ms200 For1",
    "sourceId": 46,
    "alternates": [
      {
        "key": "ms",
        "label": "ms",
        "dp": 0,
        "scale": 5,
        "offset": 0
      }
    ],
    "metricKey": "ms",
    "imperialKey": "ms"
  },
  "gear": {
    "slug": "gear",
    "name": "Gear",
    "sourceId": 47,
    "alternates": [
      {
        "key": "gear",
        "label": "gear",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "gear",
    "imperialKey": "gear"
  },
  "time-ms-as-s": {
    "slug": "time-ms-as-s",
    "name": "Time ms as s",
    "sourceId": 48,
    "alternates": [
      {
        "key": "s",
        "label": "s",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "s",
    "imperialKey": "s"
  },
  "rp-mx1000": {
    "slug": "rp-mx1000",
    "name": "RP Mx1000",
    "sourceId": 49,
    "alternates": [
      {
        "key": "rpm",
        "label": "RPM",
        "dp": 0,
        "scale": 100,
        "offset": 0
      }
    ],
    "metricKey": "rpm",
    "imperialKey": "rpm"
  },
  "engine-acceleration": {
    "slug": "engine-acceleration",
    "name": "Engine Acceleration",
    "sourceId": 50,
    "alternates": [
      {
        "key": "rpm-s",
        "label": "RPM/s",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "rpm-s",
    "imperialKey": "rpm-s"
  },
  "fuel-volume": {
    "slug": "fuel-volume",
    "name": "Fuel Volume",
    "sourceId": 51,
    "alternates": [
      {
        "key": "l",
        "label": "L",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "gal",
        "label": "gal",
        "dp": 2,
        "scale": 0.002642000008,
        "offset": 0
      }
    ],
    "metricKey": "l",
    "imperialKey": "gal"
  },
  "fuel-ecomony": {
    "slug": "fuel-ecomony",
    "name": "Fuel Ecomony",
    "sourceId": 52,
    "alternates": [
      {
        "key": "l-100km",
        "label": "L/100km",
        "dp": 2,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "l-100km",
    "imperialKey": "l-100km"
  },
  "mileage": {
    "slug": "mileage",
    "name": "Mileage",
    "sourceId": 53,
    "alternates": [
      {
        "key": "km-l",
        "label": "km/L",
        "dp": 2,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mpg",
        "label": "MPG",
        "dp": 2,
        "scale": 0.235214996338,
        "offset": 0
      }
    ],
    "metricKey": "km-l",
    "imperialKey": "mpg"
  },
  "fuel-rate": {
    "slug": "fuel-rate",
    "name": "Fuel Rate",
    "sourceId": 54,
    "alternates": [
      {
        "key": "l-hr",
        "label": "L/hr",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "gal-hr",
        "label": "gal/hr",
        "dp": 2,
        "scale": 0.00264199996,
        "offset": 0
      },
      {
        "key": "gal-min",
        "label": "gal/min",
        "dp": 2,
        "scale": 0.000044033331,
        "offset": 0
      }
    ],
    "metricKey": "l-hr",
    "imperialKey": "gal-hr"
  },
  "abs-pressure-per-second": {
    "slug": "abs-pressure-per-second",
    "name": "Abs Pressure Per Second",
    "sourceId": 55,
    "alternates": [
      {
        "key": "kpa-s",
        "label": "kPa/s",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mbar-s",
        "label": "mbar/s",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "bar-s",
        "label": "bar/s",
        "dp": 3,
        "scale": 0.001000000011,
        "offset": 0
      },
      {
        "key": "kg-cm2-s",
        "label": "kg/cm²/s",
        "dp": 2,
        "scale": 0.001019999981,
        "offset": 0
      },
      {
        "key": "psi-s",
        "label": "psi/s",
        "dp": 1,
        "scale": 0.0145,
        "offset": 0
      }
    ],
    "metricKey": "kpa-s",
    "imperialKey": "psi-s"
  },
  "mega-pressure": {
    "slug": "mega-pressure",
    "name": "Mega Pressure",
    "sourceId": 56,
    "alternates": [
      {
        "key": "kpa",
        "label": "kPa",
        "dp": 0,
        "scale": 1,
        "offset": -101
      },
      {
        "key": "kpa-abs",
        "label": "kPa (Abs.)",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "bar-abs",
        "label": "bar (Abs.)",
        "dp": 0,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "kg-cm2",
        "label": "kg/cm²",
        "dp": 0,
        "scale": 0.010199999809,
        "offset": -1.030199980736
      },
      {
        "key": "psi-0-14",
        "label": "psi (0.14)",
        "dp": 0,
        "scale": 0.145,
        "offset": -14.645
      },
      {
        "key": "inhg",
        "label": "inHg",
        "dp": 0,
        "scale": 0.292376244422,
        "offset": -29.530000686646
      },
      {
        "key": "psi-14-64",
        "label": "psi (14.64)",
        "dp": 0,
        "scale": 0.143564356436,
        "offset": 0
      }
    ],
    "metricKey": "kpa",
    "imperialKey": "psi-0-14"
  },
  "pid500": {
    "slug": "pid500",
    "name": "PID500",
    "sourceId": 57,
    "alternates": [
      {
        "key": "pid500",
        "label": "PID500",
        "dp": 1,
        "scale": 0.2,
        "offset": 0
      }
    ],
    "metricKey": "pid500",
    "imperialKey": "pid500"
  },
  "pid1000": {
    "slug": "pid1000",
    "name": "PID1000",
    "sourceId": 58,
    "alternates": [
      {
        "key": "pid1000",
        "label": "PID1000",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "pid1000",
    "imperialKey": "pid1000"
  },
  "pid2000": {
    "slug": "pid2000",
    "name": "PID2000",
    "sourceId": 59,
    "alternates": [
      {
        "key": "pid2000",
        "label": "PID2000",
        "dp": 2,
        "scale": 0.05,
        "offset": 0
      }
    ],
    "metricKey": "pid2000",
    "imperialKey": "pid2000"
  },
  "pid2500": {
    "slug": "pid2500",
    "name": "PID2500",
    "sourceId": 60,
    "alternates": [
      {
        "key": "pid2500",
        "label": "PID2500",
        "dp": 2,
        "scale": 0.04,
        "offset": 0
      }
    ],
    "metricKey": "pid2500",
    "imperialKey": "pid2500"
  },
  "pid5000": {
    "slug": "pid5000",
    "name": "PID5000",
    "sourceId": 61,
    "alternates": [
      {
        "key": "pid5000",
        "label": "PID5000",
        "dp": 1,
        "scale": 0.02,
        "offset": 0
      }
    ],
    "metricKey": "pid5000",
    "imperialKey": "pid5000"
  },
  "pid40": {
    "slug": "pid40",
    "name": "PID40",
    "sourceId": 62,
    "alternates": [
      {
        "key": "pid40",
        "label": "PID40",
        "dp": 1,
        "scale": 2.5,
        "offset": 0
      }
    ],
    "metricKey": "pid40",
    "imperialKey": "pid40"
  },
  "pid50000": {
    "slug": "pid50000",
    "name": "PID50000",
    "sourceId": 63,
    "alternates": [
      {
        "key": "pid50000",
        "label": "PID50000",
        "dp": 1,
        "scale": 0.002,
        "offset": 0
      }
    ],
    "metricKey": "pid50000",
    "imperialKey": "pid50000"
  },
  "pid20000": {
    "slug": "pid20000",
    "name": "PID20000",
    "sourceId": 64,
    "alternates": [
      {
        "key": "pid20000",
        "label": "PID20000",
        "dp": 1,
        "scale": 0.005,
        "offset": 0
      }
    ],
    "metricKey": "pid20000",
    "imperialKey": "pid20000"
  },
  "pid3000": {
    "slug": "pid3000",
    "name": "PID3000",
    "sourceId": 65,
    "alternates": [
      {
        "key": "pid3000",
        "label": "PID3000",
        "dp": 1,
        "scale": 0.033333333333,
        "offset": 0
      }
    ],
    "metricKey": "pid3000",
    "imperialKey": "pid3000"
  },
  "offset-pressure": {
    "slug": "offset-pressure",
    "name": "Offset Pressure",
    "sourceId": 66,
    "alternates": [
      {
        "key": "kpa",
        "label": "kPa",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mbar",
        "label": "mbar",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "bar",
        "label": "bar",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "kg-cm2",
        "label": "kg/cm²",
        "dp": 2,
        "scale": 0.001019999981,
        "offset": 0
      },
      {
        "key": "psi",
        "label": "psi",
        "dp": 1,
        "scale": 0.0145,
        "offset": 0
      }
    ],
    "metricKey": "kpa",
    "imperialKey": "psi"
  },
  "time-ms1-for5": {
    "slug": "time-ms1-for5",
    "name": "Time ms1 For5",
    "sourceId": 67,
    "alternates": [
      {
        "key": "ms",
        "label": "ms",
        "dp": 2,
        "scale": 5,
        "offset": 0
      }
    ],
    "metricKey": "ms",
    "imperialKey": "ms"
  },
  "pid25000": {
    "slug": "pid25000",
    "name": "PID25000",
    "sourceId": 68,
    "alternates": [
      {
        "key": "pid25000",
        "label": "PID25000",
        "dp": 1,
        "scale": 0.004,
        "offset": 0
      }
    ],
    "metricKey": "pid25000",
    "imperialKey": "pid25000"
  },
  "pid10000": {
    "slug": "pid10000",
    "name": "PID10000",
    "sourceId": 69,
    "alternates": [
      {
        "key": "pid10000",
        "label": "PID10000",
        "dp": 1,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "pid10000",
    "imperialKey": "pid10000"
  },
  "pulses-per-long-distance": {
    "slug": "pulses-per-long-distance",
    "name": "Pulses Per Long Distance",
    "sourceId": 70,
    "alternates": [
      {
        "key": "pulses-km",
        "label": "Pulses/km",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "pulses-mi",
        "label": "Pulses/mi",
        "dp": 0,
        "scale": 1.609344042969,
        "offset": 0
      }
    ],
    "metricKey": "pulses-km",
    "imperialKey": "pulses-km"
  },
  "mega-fuel-volume": {
    "slug": "mega-fuel-volume",
    "name": "Mega Fuel Volume",
    "sourceId": 71,
    "alternates": [
      {
        "key": "l",
        "label": "L",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "gal",
        "label": "gal",
        "dp": 1,
        "scale": 0.026417204738,
        "offset": 0
      }
    ],
    "metricKey": "l",
    "imperialKey": "gal"
  },
  "torque": {
    "slug": "torque",
    "name": "Torque",
    "sourceId": 72,
    "alternates": [
      {
        "key": "n-m",
        "label": "N m",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "ft-lb",
        "label": "ft⋅lb",
        "dp": 1,
        "scale": 0.073756,
        "offset": 0
      }
    ],
    "metricKey": "n-m",
    "imperialKey": "ft-lb"
  },
  "retard-angular-velocity": {
    "slug": "retard-angular-velocity",
    "name": "Retard Angular Velocity",
    "sourceId": 73,
    "alternates": [
      {
        "key": "deg-s",
        "label": "°/s",
        "dp": 1,
        "scale": -0.1,
        "offset": 0
      }
    ],
    "metricKey": "deg-s",
    "imperialKey": "deg-s"
  },
  "retard-angle": {
    "slug": "retard-angle",
    "name": "Retard Angle",
    "sourceId": 74,
    "alternates": [
      {
        "key": "deg",
        "label": "°",
        "dp": 1,
        "scale": -0.1,
        "offset": 0
      }
    ],
    "metricKey": "deg",
    "imperialKey": "deg"
  },
  "step-rate": {
    "slug": "step-rate",
    "name": "Step Rate",
    "sourceId": 75,
    "alternates": [
      {
        "key": "steps-s",
        "label": "steps/s",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "steps-s",
    "imperialKey": "steps-s"
  },
  "current": {
    "slug": "current",
    "name": "Current",
    "sourceId": 76,
    "alternates": [
      {
        "key": "ma",
        "label": "mA",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "ma",
    "imperialKey": "ma"
  },
  "inj-fuel-volume": {
    "slug": "inj-fuel-volume",
    "name": "Inj Fuel Volume",
    "sourceId": 77,
    "alternates": [
      {
        "key": "ul",
        "label": "µL",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "us-fl-oz",
        "label": "US fl oz",
        "dp": 4,
        "scale": 3.3814e-7,
        "offset": 0
      },
      {
        "key": "us-tsp",
        "label": "US tsp",
        "dp": 4,
        "scale": 0.000002028842,
        "offset": 0
      },
      {
        "key": "inj-grains",
        "label": "Inj Grains",
        "dp": 1,
        "scale": 0.111099996567,
        "offset": 0
      },
      {
        "key": "meth-grains",
        "label": "Meth Grains",
        "dp": 1,
        "scale": 0.122193422318,
        "offset": 0
      }
    ],
    "metricKey": "ul",
    "imperialKey": "us-fl-oz"
  },
  "gear-ratio": {
    "slug": "gear-ratio",
    "name": "Gear Ratio",
    "sourceId": 78,
    "alternates": [
      {
        "key": "km-h-per-1000rpm",
        "label": "km/h per 1000RPM",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "mph-per-1000rpm",
        "label": "mph per 1000RPM",
        "dp": 1,
        "scale": 0.062137119293,
        "offset": 0
      }
    ],
    "metricKey": "km-h-per-1000rpm",
    "imperialKey": "mph-per-1000rpm"
  },
  "decibel": {
    "slug": "decibel",
    "name": "Decibel",
    "sourceId": 79,
    "alternates": [
      {
        "key": "db",
        "label": "dB",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "db",
    "imperialKey": "db"
  },
  "temperature-relative": {
    "slug": "temperature-relative",
    "name": "Temperature Relative",
    "sourceId": 80,
    "alternates": [
      {
        "key": "degc",
        "label": "°C",
        "dp": 0,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "degf",
        "label": "°F",
        "dp": 0,
        "scale": 0.18,
        "offset": 0
      }
    ],
    "metricKey": "degc",
    "imperialKey": "degf"
  },
  "resistance": {
    "slug": "resistance",
    "name": "Resistance",
    "sourceId": 81,
    "alternates": [
      {
        "key": "alt-0",
        "label": "Ω",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "alt-0",
    "imperialKey": "alt-0"
  },
  "raw2-decimal-place": {
    "slug": "raw2-decimal-place",
    "name": "Raw2 Decimal Place",
    "sourceId": 82,
    "alternates": [
      {
        "key": "alt-0",
        "label": " ",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "alt-0",
    "imperialKey": "alt-0"
  },
  "cubic-feet-min": {
    "slug": "cubic-feet-min",
    "name": "Cubic Feet Min",
    "sourceId": 83,
    "alternates": [
      {
        "key": "cfm",
        "label": "cfm",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "cfm",
    "imperialKey": "cfm"
  },
  "mass-flow": {
    "slug": "mass-flow",
    "name": "Mass Flow",
    "sourceId": 84,
    "alternates": [
      {
        "key": "g-s",
        "label": "g/s",
        "dp": 2,
        "scale": 0.000277777791,
        "offset": 0
      },
      {
        "key": "kg-hr",
        "label": "kg/hr",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "lb-hr",
        "label": "lb/hr",
        "dp": 2,
        "scale": 0.002204619884,
        "offset": 0
      }
    ],
    "metricKey": "g-s",
    "imperialKey": "lb-hr"
  },
  "shorter-distance": {
    "slug": "shorter-distance",
    "name": "Shorter Distance",
    "sourceId": 85,
    "alternates": [
      {
        "key": "mm",
        "label": "mm",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "cm",
        "label": "cm",
        "dp": 2,
        "scale": 0.0001,
        "offset": 0
      },
      {
        "key": "inches",
        "label": "inches",
        "dp": 2,
        "scale": 0.000039370079,
        "offset": 0
      }
    ],
    "metricKey": "mm",
    "imperialKey": "inches"
  },
  "pulses-per-revolution": {
    "slug": "pulses-per-revolution",
    "name": "Pulses Per Revolution",
    "sourceId": 86,
    "alternates": [
      {
        "key": "pulses-rev",
        "label": "Pulses/Rev",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "pulses-rev",
    "imperialKey": "pulses-rev"
  },
  "power": {
    "slug": "power",
    "name": "Power",
    "sourceId": 87,
    "alternates": [
      {
        "key": "kw",
        "label": "kW",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "hp",
        "label": "hp",
        "dp": 1,
        "scale": 0.001341019988,
        "offset": 0
      }
    ],
    "metricKey": "kw",
    "imperialKey": "hp"
  },
  "mass-per-energy": {
    "slug": "mass-per-energy",
    "name": "Mass Per Energy",
    "sourceId": 88,
    "alternates": [
      {
        "key": "g-kw-h",
        "label": "g/(kW⋅h)",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "lb-hp-h",
        "label": "lb/(hp·h)",
        "dp": 2,
        "scale": 0.001643999945,
        "offset": 0
      }
    ],
    "metricKey": "g-kw-h",
    "imperialKey": "lb-hp-h"
  },
  "position": {
    "slug": "position",
    "name": "Position",
    "sourceId": 89,
    "alternates": [
      {
        "key": "position",
        "label": "Position",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "position",
    "imperialKey": "position"
  },
  "mass-ratio": {
    "slug": "mass-ratio",
    "name": "Mass Ratio",
    "sourceId": 90,
    "alternates": [
      {
        "key": "ppm",
        "label": "ppm",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "mg-kg",
        "label": "mg/kg",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "grains-lb",
        "label": "grains/lb",
        "dp": 1,
        "scale": 0.007000000216,
        "offset": 0
      }
    ],
    "metricKey": "ppm",
    "imperialKey": "grains-lb"
  },
  "density-small": {
    "slug": "density-small",
    "name": "Density Small",
    "sourceId": 91,
    "alternates": [
      {
        "key": "g-m3",
        "label": "g/m³",
        "dp": 0,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "g-m3",
    "imperialKey": "g-m3"
  },
  "flowx10": {
    "slug": "flowx10",
    "name": "Flowx10",
    "sourceId": 92,
    "alternates": [
      {
        "key": "cc-min",
        "label": "cc/min",
        "dp": 0,
        "scale": 10,
        "offset": 0
      },
      {
        "key": "gal-hr",
        "label": "gal/hr",
        "dp": 2,
        "scale": 0.158503234863,
        "offset": 0
      },
      {
        "key": "inj-lb-hr",
        "label": "Inj lb/hr",
        "dp": 2,
        "scale": 0.952380981445,
        "offset": 0
      },
      {
        "key": "gal-min",
        "label": "gal/min",
        "dp": 2,
        "scale": 0.002641720057,
        "offset": 0
      },
      {
        "key": "inj-lb-min",
        "label": "Inj lb/min",
        "dp": 2,
        "scale": 0.015873015404,
        "offset": 0
      },
      {
        "key": "meth-lb-hr",
        "label": "Meth lb/hr",
        "dp": 2,
        "scale": 1.047370849609,
        "offset": 0
      }
    ],
    "metricKey": "cc-min",
    "imperialKey": "gal-hr"
  },
  "current-u-a-as-m-a": {
    "slug": "current-u-a-as-m-a",
    "name": "Current u A as m A",
    "sourceId": 93,
    "alternates": [
      {
        "key": "ma",
        "label": "mA",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "ma",
    "imperialKey": "ma"
  },
  "byte-count": {
    "slug": "byte-count",
    "name": "Byte Count",
    "sourceId": 94,
    "alternates": [
      {
        "key": "b",
        "label": "B",
        "dp": 1,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "b",
    "imperialKey": "b"
  },
  "time-us-as-us": {
    "slug": "time-us-as-us",
    "name": "Time Us As Us",
    "sourceId": 95,
    "alternates": [
      {
        "key": "us",
        "label": "μs",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "us",
    "imperialKey": "us"
  },
  "current-m-a-as-a": {
    "slug": "current-m-a-as-a",
    "name": "Current m A as A",
    "sourceId": 96,
    "alternates": [
      {
        "key": "a",
        "label": "A",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "a",
    "imperialKey": "a"
  },
  "percent-per-rpm": {
    "slug": "percent-per-rpm",
    "name": "Percent Per Rpm",
    "sourceId": 97,
    "alternates": [
      {
        "key": "pct-100-rpm",
        "label": "% / 100 RPM",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      }
    ],
    "metricKey": "pct-100-rpm",
    "imperialKey": "pct-100-rpm"
  },
  "percent-per-degree": {
    "slug": "percent-per-degree",
    "name": "Percent Per Degree",
    "sourceId": 98,
    "alternates": [
      {
        "key": "pct-deg",
        "label": "% / °",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "pct-deg",
    "imperialKey": "pct-deg"
  },
  "percent-per-k-pa": {
    "slug": "percent-per-k-pa",
    "name": "Percent Per K Pa",
    "sourceId": 99,
    "alternates": [
      {
        "key": "pct-kpa",
        "label": "% / kPa",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "pct-mbar",
        "label": "% / mbar",
        "dp": 4,
        "scale": 0.0001,
        "offset": 0
      },
      {
        "key": "pct-kg-cm2",
        "label": "% / (kg/cm²)",
        "dp": 1,
        "scale": 0.102,
        "offset": 0
      },
      {
        "key": "pct-psi",
        "label": "% / psi",
        "dp": 2,
        "scale": 0.00689655,
        "offset": 0
      }
    ],
    "metricKey": "pct-kpa",
    "imperialKey": "pct-psi"
  },
  "percent-per-kmph": {
    "slug": "percent-per-kmph",
    "name": "Percent Per Kmph",
    "sourceId": 100,
    "alternates": [
      {
        "key": "pct-km-h",
        "label": "% / (km/h)",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "pct-mph",
        "label": "% / mph",
        "dp": 2,
        "scale": 0.00160934,
        "offset": 0
      }
    ],
    "metricKey": "pct-km-h",
    "imperialKey": "pct-mph"
  },
  "percent-per-lambda": {
    "slug": "percent-per-lambda",
    "name": "Percent Per Lambda",
    "sourceId": 101,
    "alternates": [
      {
        "key": "pct-lambda",
        "label": "% / λ",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      },
      {
        "key": "pct-afr-0-07",
        "label": "% / AFR (0.07)",
        "dp": 2,
        "scale": 0.006802721088,
        "offset": 0
      },
      {
        "key": "pct-afr-0-15",
        "label": "% / AFR (0.15)",
        "dp": 2,
        "scale": 0.015455950541,
        "offset": 0
      },
      {
        "key": "pct-afr-0-11",
        "label": "% / AFR (0.11)",
        "dp": 2,
        "scale": 0.011111111111,
        "offset": 0
      }
    ],
    "metricKey": "pct-lambda",
    "imperialKey": "pct-lambda"
  },
  "hexadecimal": {
    "slug": "hexadecimal",
    "name": "Hexadecimal",
    "sourceId": 102,
    "alternates": [
      {
        "key": "hexadecimal",
        "label": "Hexadecimal",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "hexadecimal",
    "imperialKey": "hexadecimal"
  },
  "percent-per-volt": {
    "slug": "percent-per-volt",
    "name": "Percent Per Volt",
    "sourceId": 103,
    "alternates": [
      {
        "key": "pct-v",
        "label": "% / V",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "pct-v",
    "imperialKey": "pct-v"
  },
  "percent-per-percent": {
    "slug": "percent-per-percent",
    "name": "Percent Per Percent",
    "sourceId": 104,
    "alternates": [
      {
        "key": "pct-pct",
        "label": "% / %",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "pct-pct",
    "imperialKey": "pct-pct"
  },
  "percent-per-kelvin": {
    "slug": "percent-per-kelvin",
    "name": "Percent Per Kelvin",
    "sourceId": 105,
    "alternates": [
      {
        "key": "pct-degc",
        "label": "% / °C",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "pct-degf",
        "label": "% / °F",
        "dp": 3,
        "scale": 0.000555555556,
        "offset": 0
      }
    ],
    "metricKey": "pct-degc",
    "imperialKey": "pct-degf"
  },
  "latitude": {
    "slug": "latitude",
    "name": "Latitude",
    "sourceId": 106,
    "alternates": [
      {
        "key": "degs",
        "label": "°S",
        "dp": 7,
        "scale": -1e-7,
        "offset": 0
      }
    ],
    "metricKey": "degs",
    "imperialKey": "degs"
  },
  "longitude": {
    "slug": "longitude",
    "name": "Longitude",
    "sourceId": 107,
    "alternates": [
      {
        "key": "degw",
        "label": "°W",
        "dp": 7,
        "scale": -1e-7,
        "offset": 0
      }
    ],
    "metricKey": "degw",
    "imperialKey": "degw"
  },
  "percent-per-engine-cycle": {
    "slug": "percent-per-engine-cycle",
    "name": "Percent Per Engine Cycle",
    "sourceId": 108,
    "alternates": [
      {
        "key": "pct-ecyc",
        "label": "%/ECyc",
        "dp": 1,
        "scale": 0.1,
        "offset": 0
      }
    ],
    "metricKey": "pct-ecyc",
    "imperialKey": "pct-ecyc"
  },
  "driven-distance": {
    "slug": "driven-distance",
    "name": "Driven Distance",
    "sourceId": 109,
    "alternates": [
      {
        "key": "km",
        "label": "km",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "mi",
        "label": "mi",
        "dp": 1,
        "scale": 0.000621371191,
        "offset": 0
      }
    ],
    "metricKey": "km",
    "imperialKey": "mi"
  },
  "comp-ratio": {
    "slug": "comp-ratio",
    "name": "Comp Ratio",
    "sourceId": 110,
    "alternates": [
      {
        "key": "1",
        "label": ": 1",
        "dp": 1,
        "scale": 0.001,
        "offset": 0
      }
    ],
    "metricKey": "1",
    "imperialKey": "1"
  },
  "boost-to-fuel-flow-rate": {
    "slug": "boost-to-fuel-flow-rate",
    "name": "Boost To Fuel Flow Rate",
    "sourceId": 111,
    "alternates": [
      {
        "key": "psi-gal-min",
        "label": "psi / (gal/min)",
        "dp": 2,
        "scale": 0.055769,
        "offset": 0
      }
    ],
    "metricKey": "psi-gal-min",
    "imperialKey": "psi-gal-min"
  },
  "force": {
    "slug": "force",
    "name": "Force",
    "sourceId": 112,
    "alternates": [
      {
        "key": "n",
        "label": "N",
        "dp": 0,
        "scale": 1,
        "offset": 0
      },
      {
        "key": "lbf",
        "label": "lbf",
        "dp": 0,
        "scale": 0.224809,
        "offset": 0
      }
    ],
    "metricKey": "n",
    "imperialKey": "lbf"
  },
  "current-per-k-pa": {
    "slug": "current-per-k-pa",
    "name": "Current Per K Pa",
    "sourceId": 113,
    "alternates": [
      {
        "key": "ma-kpa",
        "label": "mA / kPa",
        "dp": 2,
        "scale": 0.01,
        "offset": 0
      },
      {
        "key": "ma-mbar",
        "label": "mA / mbar",
        "dp": 3,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "ma-kg-cm2",
        "label": "mA / (kg/cm²)",
        "dp": 0,
        "scale": 1.02,
        "offset": 0
      },
      {
        "key": "ma-psi",
        "label": "mA / psi",
        "dp": 1,
        "scale": 0.0689655,
        "offset": 0
      }
    ],
    "metricKey": "ma-kpa",
    "imperialKey": "ma-psi"
  },
  "bar-to-minor-tick": {
    "slug": "bar-to-minor-tick",
    "name": "Bar To Minor Tick",
    "sourceId": 116,
    "alternates": [
      {
        "key": "bars",
        "label": "Bars",
        "dp": 0,
        "scale": 1,
        "offset": 1
      }
    ],
    "metricKey": "bars",
    "imperialKey": "bars"
  },
  "time-h": {
    "slug": "time-h",
    "name": "Time h",
    "sourceId": 117,
    "alternates": [
      {
        "key": "h",
        "label": "h",
        "dp": 2,
        "scale": 0.000277777778,
        "offset": 0
      }
    ],
    "metricKey": "h",
    "imperialKey": "h"
  },
  "time-h-m-formatted": {
    "slug": "time-h-m-formatted",
    "name": "Time h m formatted",
    "sourceId": 118,
    "alternates": [
      {
        "key": "hh-mm",
        "label": "hh:mm",
        "dp": 0,
        "scale": 1,
        "offset": 0
      }
    ],
    "metricKey": "hh-mm",
    "imperialKey": "hh-mm"
  },
  "mass-per-rev": {
    "slug": "mass-per-rev",
    "name": "Mass Per Rev",
    "sourceId": 119,
    "alternates": [
      {
        "key": "g-rev",
        "label": "g/Rev",
        "dp": 2,
        "scale": 0.001,
        "offset": 0
      },
      {
        "key": "grains-rev",
        "label": "grains/Rev",
        "dp": 2,
        "scale": 0.015432358742,
        "offset": 0
      }
    ],
    "metricKey": "g-rev",
    "imperialKey": "grains-rev"
  }
};

/**
 * Haltech `Type :` token -> quantity slug, keyed by the token reduced to
 * lowercase alphanumerics. Use `normalizeTypeToken` to look up.
 */
export const HALTECH_TYPE_TO_SLUG: Record<string, string> = {
  "raw": "raw",
  "enginespeed": "engine-speed",
  "percentage": "percentage",
  "pressure": "pressure",
  "speed": "speed",
  "temperature": "temperature",
  "afr": "afr",
  "voltage": "voltage",
  "batteryvoltage": "battery-voltage",
  "times": "time-s",
  "timems": "time-ms",
  "timeus": "time-us",
  "masspercyl": "mass-per-cyl",
  "angle": "angle",
  "mass": "mass",
  "enginevolume": "engine-volume",
  "massovertime": "mass-over-time",
  "ratio": "ratio",
  "flow": "flow",
  "relativeload": "relative-load",
  "acceleration": "acceleration",
  "angularvelocity": "angular-velocity",
  "smsteps": "sm-steps",
  "msperengcyl": "ms-per-eng-cyl",
  "degperengcyl": "deg-per-eng-cyl",
  "shortdistance": "short-distance",
  "frequency": "frequency",
  "abspressure": "abs-pressure",
  "density": "density",
  "stoichiometry": "stoichiometry",
  "percentage1for1": "percentage1-for1",
  "percentageinjairtempcorr": "percentage-inj-air-temp-corr",
  "percentageinjbarocorr": "percentage-inj-baro-corr",
  "timeus4for1": "time-us4-for1",
  "percentage4for1": "percentage4-for1",
  "angleignsprt2k": "angle-ign-sprt2-k",
  "angleoffset10deg": "angle-offset10deg",
  "times20for1": "time-s20-for1",
  "times10for1": "time-s10-for1",
  "times200for1": "time-s200-for1",
  "percentage2for1": "percentage2-for1",
  "percentagemapcorr": "percentage-map-corr",
  "percentageegtcorr": "percentage-egt-corr",
  "times100for1": "time-s100-for1",
  "timems1for10": "time-ms1-for10",
  "longdistance": "long-distance",
  "timems200for1": "time-ms200-for1",
  "gear": "gear",
  "timemsass": "time-ms-as-s",
  "rpmx1000": "rp-mx1000",
  "engineacceleration": "engine-acceleration",
  "fuelvolume": "fuel-volume",
  "fuelecomony": "fuel-ecomony",
  "mileage": "mileage",
  "fuelrate": "fuel-rate",
  "abspressurepersecond": "abs-pressure-per-second",
  "megapressure": "mega-pressure",
  "pid500": "pid500",
  "pid1000": "pid1000",
  "pid2000": "pid2000",
  "pid2500": "pid2500",
  "pid5000": "pid5000",
  "pid40": "pid40",
  "pid50000": "pid50000",
  "pid20000": "pid20000",
  "pid3000": "pid3000",
  "offsetpressure": "offset-pressure",
  "timems1for5": "time-ms1-for5",
  "pid25000": "pid25000",
  "pid10000": "pid10000",
  "pulsesperlongdistance": "pulses-per-long-distance",
  "megafuelvolume": "mega-fuel-volume",
  "torque": "torque",
  "retardangularvelocity": "retard-angular-velocity",
  "retardangle": "retard-angle",
  "steprate": "step-rate",
  "current": "current",
  "injfuelvolume": "inj-fuel-volume",
  "gearratio": "gear-ratio",
  "decibel": "decibel",
  "temperaturerelative": "temperature-relative",
  "resistance": "resistance",
  "raw2decimalplace": "raw2-decimal-place",
  "cubicfeetmin": "cubic-feet-min",
  "massflow": "mass-flow",
  "shorterdistance": "shorter-distance",
  "pulsesperrevolution": "pulses-per-revolution",
  "power": "power",
  "massperenergy": "mass-per-energy",
  "position": "position",
  "massratio": "mass-ratio",
  "densitysmall": "density-small",
  "flowx10": "flowx10",
  "currentuaasma": "current-u-a-as-m-a",
  "bytecount": "byte-count",
  "timeusasus": "time-us-as-us",
  "currentmaasa": "current-m-a-as-a",
  "percentperrpm": "percent-per-rpm",
  "percentperdegree": "percent-per-degree",
  "percentperkpa": "percent-per-k-pa",
  "percentperkmph": "percent-per-kmph",
  "percentperlambda": "percent-per-lambda",
  "hexadecimal": "hexadecimal",
  "percentpervolt": "percent-per-volt",
  "percentperpercent": "percent-per-percent",
  "percentperkelvin": "percent-per-kelvin",
  "latitude": "latitude",
  "longitude": "longitude",
  "percentperenginecycle": "percent-per-engine-cycle",
  "drivendistance": "driven-distance",
  "compratio": "comp-ratio",
  "boosttofuelflowrate": "boost-to-fuel-flow-rate",
  "force": "force",
  "currentperkpa": "current-per-k-pa",
  "bartominortick": "bar-to-minor-tick",
  "timeh": "time-h",
  "timehmformatted": "time-h-m-formatted",
  "massperrev": "mass-per-rev"
};

export function normalizeTypeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}
