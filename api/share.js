import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

// Convex's browser API URL is public configuration. Vercel injects it while
// building the app, but not into these serverless functions at runtime.
const CONVEX_URL =
  process.env.VITE_CONVEX_URL || "https://wonderful-husky-734.convex.cloud";

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export default async function handler(request, response) {
  const shareId = one(request.query.id) || "";
  const origin = "https://dragtrace.com";
  const canonicalUrl = `${origin}/share/${encodeURIComponent(shareId)}`;
  const viewerUrl = `/open?share=${encodeURIComponent(shareId)}`;
  let shared = null;

  if (shareId) {
    try {
      const client = new ConvexHttpClient(CONVEX_URL);
      shared = await client.query(api.sharedLogs.get, { shareId });
    } catch (error) {
      console.error("Could not load shared-log metadata", error);
    }
  }

  const fileName = shared?.fileName || "Shared datalog";
  const title = `${fileName} — DragTrace`;
  const description = shared
    ? "Open this interactive racing datalog in DragTrace."
    : "Open a shared racing datalog in DragTrace.";
  const imageUrl = `${origin}/api/share-og?id=${encodeURIComponent(shareId)}`;

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300",
  );
  response.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="DragTrace" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <script>window.location.replace(${JSON.stringify(viewerUrl)});</script>
  </head>
  <body style="margin:0;background:#08090a;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center">
    <p>Opening <a style="color:#fff" href="${escapeHtml(viewerUrl)}">${escapeHtml(fileName)}</a> in DragTrace…</p>
  </body>
</html>`);
}
