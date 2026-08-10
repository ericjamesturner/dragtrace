import { useEffect, useState } from "react";
import { errText } from "@/lib/error-text";
import { useAction, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

/**
 * Shown to a signed-in account that is not paid up. Stripe Checkout does the
 * card handling — we never see card details, and the secret key stays on the
 * server.
 *
 * Coming back from Checkout, the webhook is usually already in, but not always.
 * `?checkout=success` triggers a direct read from Stripe so the racer is not
 * staring at a paywall he just paid for.
 */
export function Subscribe() {
  const access = useQuery(api.stripe.access);
  const checkout = useAction(api.stripe.createCheckoutSession);
  const sync = useAction(api.stripe.syncFromStripe);
  const { signOut } = useAuthActions();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returning = new URLSearchParams(window.location.search).has("checkout");

  // Just back from Stripe: pull the status straight from them rather than
  // waiting on the webhook.
  useEffect(() => {
    if (!returning) return;
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      if (cancelled || tries >= 6) return;
      tries++;
      try {
        await sync({});
      } catch {
        // The webhook is the reliable path; this is only the fast one.
      }
      if (!cancelled) setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [returning, sync]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await checkout({ returnOrigin: window.location.origin });
      window.location.href = url;
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const settling = returning && access?.active === false;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#08090a] p-6 text-white antialiased">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          DragTrace
        </h1>

        <div className="mt-8 rounded-xl border border-white/12 bg-[#0d0e10] p-6">
          {settling ? (
            <>
              <h2 className="text-xl font-semibold">Finishing up…</h2>
              <p className="mt-3 text-white/70">
                Stripe is confirming your payment. This takes a few seconds.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Start your subscription</h2>
              <p className="mt-3 text-lg leading-relaxed text-white/70">
                $100 a year. Every car you own, every race, every pass. Your first
                14 days are free, and you can cancel any time before then without
                being charged.
              </p>

              <button
                onClick={() => void start()}
                disabled={busy}
                className="mt-6 w-full rounded-lg bg-white px-5 py-3 text-base font-semibold text-black transition-colors hover:bg-white/85 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {busy ? "Opening Stripe…" : "Continue to payment"}
              </button>

              <p className="mt-3 text-center text-sm text-white/45">
                Payment is handled by Stripe. We never see your card details.
              </p>

              {error && (
                <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-sm text-white/45">
          <button
            onClick={() => void signOut()}
            className="transition-colors hover:text-white"
          >
            Sign out
          </button>
          <span className="text-white/20">·</span>
          <a href="/?terms" className="transition-colors hover:text-white">
            Terms
          </a>
          <span className="text-white/20">·</span>
          <a href="/?privacy" className="transition-colors hover:text-white">
            Privacy
          </a>
        </div>
      </div>
    </div>
  );
}
