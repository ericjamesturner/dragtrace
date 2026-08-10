# DragTrace

The datalog viewer that has your back.

Load the run. The view you set up last time is already there, your passes line up
side by side, and anything you told it to watch for is flagged before you go
looking.

Simple enough for a racer between rounds. Deep enough for whoever tunes the car.

## What it does

- **Your view persists.** The chart you build is saved per car. Open any pass,
  on any weekend, and it opens into the same chart — channels remap by name.
- **It watches for you.** Describe what matters in plain English ("fuel pressure
  dropping fast during the run"). DragTrace checks every run from then on and
  shows a count of what fired.
- **Runs compare themselves.** Add a second pass and it draws on the same chart,
  aligned at the launch, with the same channels and its own colour.
- **It knows what a pass is.** Automatic launch detection, time rebased to zero
  at the hit, and your timeslip drawn on the chart — 60 ft, 330 ft, 660 ft,
  1000 ft, 1320 ft — with feet-down-track at the cursor.
- **Everything stays organized.** Car → event → pass, with best ET on every
  weekend and a preview on every pass card.
- **Trackside.** Touch and pinch work, so it runs on a tablet in the trailer.

## ECU support

Right now, Haltech only. We are adding more later — Holley, AEM, MoTeC and Fueltech.

## Development

```bash
npm install
npm run dev          # Vite dev server
npm run dev:convex   # Convex functions (see the warning in .env.local first)
```

Stack: React 19, Vite, Convex, uPlot, Tailwind 4, shadcn/base-ui.
Claude features (highlight zones, math channels, scatter suggestions, timeslip
photo OCR) run server-side as Convex actions.
