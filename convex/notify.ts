import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/** The ntfy.sh topic that hears about new uploads. Anyone who knows the name can subscribe. */
const NTFY_TOPIC = "dragtrace-alerts";

/** Pushes a new-log alert. Never throws: an alert that fails must not matter to the upload. */
export const newLog = internalAction({
  args: { title: v.string(), message: v.string() },
  handler: async (_ctx, args) => {
    try {
      // JSON to the root, not headers on the topic URL: a Title header can't carry
      // non-ASCII, and vehicle or file names can.
      const res = await fetch("https://ntfy.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: NTFY_TOPIC, title: args.title, message: args.message, tags: ["checkered_flag"] }),
      });
      if (!res.ok) console.warn(`ntfy alert failed: HTTP ${res.status}`);
    } catch (e) {
      console.warn("ntfy alert failed:", e);
    }
  },
});
