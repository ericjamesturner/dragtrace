import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

// Convex's browser API URL is public configuration. Vercel injects it while
// building the app, but not into these serverless functions at runtime.
const CONVEX_URL =
  process.env.VITE_CONVEX_URL || "https://wonderful-husky-734.convex.cloud";

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(request, response) {
  const shareId = one(request.query.id) || "";
  if (!shareId) {
    response.status(404).send("Preview not found");
    return;
  }
  try {
    const client = new ConvexHttpClient(CONVEX_URL);
    const shared = await client.query(api.sharedLogs.get, { shareId });
    if (!shared?.ogImageUrl) {
      response.status(404).send("Preview not found");
      return;
    }
    response.setHeader("Cache-Control", "public, s-maxage=300");
    response.redirect(302, shared.ogImageUrl);
  } catch (error) {
    console.error("Could not load shared-log preview", error);
    response.status(404).send("Preview not found");
  }
}
