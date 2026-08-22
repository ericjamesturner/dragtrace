/**
 * A switch sized to sit in a dense list row.
 *
 * The channels panel used checkboxes, which read as "select these for an
 * action". Nothing here is being selected — the control turns a plotted line
 * on and off, which is what a switch means.
 *
 * Give it the line's `color` and the switch becomes the colour key too: lit in
 * the channel's own colour when the line is drawn, grey when it isn't. The
 * knob is near-black so it stays visible on every colour in the palette,
 * including the near-white one.
 *
 * `mixed` covers the group case: a channel whose runs are only partly hidden.
 * A switch has no half-on position, so the knob parks in the middle of a
 * dimmed track rather than lying about the state.
 */
export function Switch({
  checked,
  mixed = false,
  color,
  opacity = 1,
  onChange,
  title,
  className = "",
  appearance = "channel",
}: {
  checked: boolean;
  mixed?: boolean;
  /** The colour of the thing being switched — usually the plotted line. */
  color?: string;
  opacity?: number;
  onChange: (next: boolean) => void;
  title?: string;
  className?: string;
  /** `channel` is the compact chart control; `form` is a standard form toggle. */
  appearance?: "channel" | "form";
}) {
  const on = checked && !mixed;
  const lit = on || mixed;
  const form = appearance === "form";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 ${
        form
          ? on
            ? "bg-primary"
            : "bg-muted-foreground/25 hover:bg-muted-foreground/35"
          : color && lit
            ? ""
            : on
              ? "bg-white/75"
              : mixed
                ? "bg-white/30"
                : "bg-white/15 hover:bg-white/25"
      } ${className}`}
      style={{
        width: form ? 36 : 18,
        height: form ? 20 : 10,
        ...(!form && color && lit
          ? { backgroundColor: color, opacity: mixed ? 0.45 : opacity }
          : null),
      }}
    >
      <span
        className="absolute top-1/2 block rounded-full transition-all"
        style={{
          width: form ? 16 : 6,
          height: form ? 16 : 6,
          marginTop: form ? -8 : -3,
          left: form ? (on ? 18 : 2) : on ? 10 : mixed ? 6 : 2,
          backgroundColor: form
            ? "white"
            : lit
              ? "#0a0a0a"
              : "rgba(255,255,255,0.6)",
          boxShadow: form ? "0 1px 2px rgba(0,0,0,0.28)" : undefined,
        }}
      />
    </button>
  );
}
