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
}: {
  checked: boolean;
  mixed?: boolean;
  /** The colour of the thing being switched — usually the plotted line. */
  color?: string;
  opacity?: number;
  onChange: (next: boolean) => void;
  title?: string;
  className?: string;
}) {
  const on = checked && !mixed;
  const lit = on || mixed;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? "mixed" : checked}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative shrink-0 cursor-pointer rounded-full transition-colors ${
        color && lit ? "" : on ? "bg-white/75" : mixed ? "bg-white/30" : "bg-white/15 hover:bg-white/25"
      } ${className}`}
      style={{
        width: 18,
        height: 10,
        ...(color && lit
          ? { backgroundColor: color, opacity: mixed ? 0.45 : opacity }
          : null),
      }}
    >
      <span
        className="absolute top-1/2 block rounded-full transition-all"
        style={{
          width: 6,
          height: 6,
          marginTop: -3,
          left: on ? 10 : mixed ? 6 : 2,
          backgroundColor: lit ? "#0a0a0a" : "rgba(255,255,255,0.6)",
        }}
      />
    </button>
  );
}
