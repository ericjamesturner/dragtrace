import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckIcon, DownloadIcon, RotateCcwIcon, StarIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;
}

function dateTime(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const activityLabels: Record<string, string> = {
  signed_in: "Signed in",
  account_session_started: "Opened the app",
  signed_out: "Signed out",
  vehicle_opened: "Opened a vehicle",
  event_opened: "Opened an event",
  log_opened: "Opened a log",
  log_comparison_changed: "Changed a comparison",
  settings_opened: "Opened settings",
};

function browserLabel(userAgent?: string) {
  if (!userAgent) return "Browser unavailable";
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Firefox/")
      ? "Firefox"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const device = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : userAgent.includes("Android")
      ? "Android"
      : userAgent.includes("Mac OS X")
        ? "Mac"
        : userAgent.includes("Windows")
          ? "Windows"
          : userAgent.includes("Linux")
            ? "Linux"
            : "device";
  return `${browser} on ${device}`;
}

export function AdminInsights() {
  const [activitySearch, setActivitySearch] = useState("");
  const summary = useQuery(api.analytics.summary);
  const feedback = useQuery(api.feedback.list);
  const sharedLogs = useQuery(api.sharedLogs.listForAdmin);
  const activity = useQuery(api.activity.listRecent, { limit: 200 });
  const markReviewed = useMutation(api.feedback.markReviewed);

  if (
    summary === undefined ||
    feedback === undefined ||
    sharedLogs === undefined ||
    activity === undefined
  ) {
    return <p className="text-sm text-muted-foreground">Loading usage and activity…</p>;
  }

  const search = activitySearch.trim().toLowerCase();
  const visibleActivity = activity.filter((item) =>
    !search ||
    [
      item.actorName,
      item.actorEmail,
      item.effectiveUserName,
      item.effectiveUserEmail,
      item.action,
      activityLabels[item.action],
      item.vehicleName,
      item.eventName,
      ...item.fileNames,
      item.ipAddress,
      item.userAgent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search),
  );

  const cards = [
    ["Unique people", summary.uniqueVisitors.toLocaleString()],
    ["Unique logs", summary.uniqueLogs.toLocaleString()],
    ["Viewer sessions", summary.sessions.toLocaleString()],
    ["Logs opened", summary.totalLogLoads.toLocaleString()],
    ["Active time", duration(summary.totalActiveMs)],
    ["Avg. active session", duration(summary.averageActiveMs)],
  ];

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold">Account activity</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Who is using DragTrace and what they open. Raw activity, IP, and
              browser details are kept for 90 days.
            </p>
          </div>
          <input
            type="search"
            value={activitySearch}
            onChange={(event) => setActivitySearch(event.target.value)}
            placeholder="Find a person, IP, or log…"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm sm:w-64"
          />
        </div>

        {visibleActivity.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {activity.length === 0 ? "No account activity recorded yet." : "No matching activity."}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Activity</th>
                  <th className="px-3 py-2 font-medium">IP &amp; browser</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleActivity.map((item) => {
                  const target = item.fileNames.length > 0
                    ? item.fileNames.join(", ")
                    : item.eventName || item.vehicleName || item.section;
                  const impersonating = item.actorUserId !== item.effectiveUserId;
                  return (
                    <tr key={item._id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {dateTime(item.occurredAt)}
                      </td>
                      <td className="px-3 py-2">
                        <p>{item.actorName || item.actorEmail || "Unknown account"}</p>
                        {item.actorName && item.actorEmail && (
                          <p className="text-xs text-muted-foreground">{item.actorEmail}</p>
                        )}
                        {impersonating && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Viewing as {item.effectiveUserName || item.effectiveUserEmail || "customer"}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <p>{activityLabels[item.action] || item.action}</p>
                        {target && (
                          <p className="max-w-72 truncate text-xs text-muted-foreground" title={target}>
                            {target}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-mono text-xs">{item.ipAddress || "Unavailable"}</p>
                        <p className="text-xs text-muted-foreground" title={item.userAgent}>
                          {browserLabel(item.userAgent)}
                          {item.timezone ? ` · ${item.timezone}` : ""}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the newest {activity.length} events. “Signed in” is recorded by the authentication server;
          other entries reflect authenticated app navigation.
        </p>
      </section>

      <section className="border-t pt-8">
        <div>
          <h3 className="text-base font-semibold">Viewer usage</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed-in accounts count once; guests count by a random browser id.
            Background and idle tabs are excluded from active time.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {summary.guestSessions.toLocaleString()} guest sessions ·{" "}
          {summary.accountSessions.toLocaleString()} signed-in sessions
        </p>

        <div className="mt-5 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                <th className="px-3 py-2 text-right font-medium">People</th>
                <th className="px-3 py-2 text-right font-medium">Sessions</th>
                <th className="px-3 py-2 text-right font-medium">Logs</th>
                <th className="px-3 py-2 text-right font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.daily.map((day) => (
                <tr key={day.date}>
                  <td className="px-3 py-2">
                    {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{day.uniqueVisitors}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{day.sessions}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{day.uniqueLogs}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{duration(day.activeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t pt-8">
        <div>
          <h3 className="text-base font-semibold">Publicly shared logs</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The latest 100 public links and the people who created them.
          </p>
        </div>

        {sharedLogs.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No shared logs yet.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Shared by</th>
                  <th className="px-3 py-2 font-medium">Log</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sharedLogs.map((item) => (
                  <tr key={item._id}>
                    <td className="px-3 py-2">
                      <p>{item.sharerName || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.sharerEmail || "Created before contact collection"}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/share/${item._id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {item.fileName}
                      </a>
                      {(item.files?.length ?? 1) > 1 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.files!.length}-log comparison
                        </p>
                      )}
                      {item.vehicleDetails && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.vehicleDetails}
                        </p>
                      )}
                      {item.description && (
                        <p className="mt-1 max-w-md whitespace-pre-wrap text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {dateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-t pt-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Feedback &amp; testimonials</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The latest 100 reports, newest first.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {feedback.filter((item) => item.status === "new").length} new
          </span>
        </div>

        {feedback.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No feedback yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {feedback.map((item) => (
              <article
                key={item._id}
                className={`rounded-lg border p-4 ${item.status === "reviewed" ? "bg-muted/20 opacity-75" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {dateTime(item.createdAt)} · {item.source === "guest" ? "Guest viewer" : "Signed-in viewer"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.contactEmail || item.userEmail || (item.visitorKey ? "Anonymous visitor" : "Anonymous")}
                      {item.page ? ` · ${item.page}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void markReviewed({
                        feedbackId: item._id,
                        reviewed: item.status !== "reviewed",
                      })
                    }
                  >
                    {item.status === "reviewed" ? <RotateCcwIcon /> : <CheckIcon />}
                    {item.status === "reviewed" ? "Mark new" : "Reviewed"}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(item.rating ?? 0) > 0 ? (
                    <div
                      className="flex items-center gap-0.5 text-amber-400"
                      aria-label={`${item.rating} out of 5 stars`}
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <StarIcon
                          key={value}
                          className={`size-4 ${value <= (item.rating ?? 0) ? "fill-current" : "text-muted-foreground/25"}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No star rating</span>
                  )}
                  {item.allowTestimonial && (
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                      Approved testimonial
                      {item.testimonialName ? ` · ${item.testimonialName}` : ""}
                    </span>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                {item.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.attachments.map((attachment) =>
                      attachment.url ? (
                        <a
                          key={attachment._id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <DownloadIcon className="size-3" />
                          <span className="max-w-52 truncate">{attachment.fileName}</span>
                        </a>
                      ) : null,
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
