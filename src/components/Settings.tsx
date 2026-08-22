import { useState } from "react";
import { errText } from "@/lib/error-text";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { UnitsPanel } from "./UnitsPanel";
import { Button } from "@/components/ui/button";
import { AdminInsights } from "./AdminInsights";

/**
 * Settings, rendered inside the normal app shell like any other page — the
 * sidebar stays put, and clicking anything in it takes you straight back to
 * the app. Standard SaaS layout: heading, horizontal tabs, content.
 */

export type SettingsSection = "profile" | "billing" | "units" | "insights";

export function Settings({ section }: { section: SettingsSection }) {
  const { openSettings, goToChannelManager } = useNav();
  const { signOut } = useAuthActions();
  const adminState = useQuery(api.admin.state);
  const isAdmin = adminState?.isAdmin ?? false;

  const item = (active: boolean) =>
    `block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors cursor-pointer ${
      active
        ? "bg-accent font-medium text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;
  const groupLabel =
    "px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-0";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-8 sm:flex-row">
        {/* Grouped like every SaaS: your account, then your cars. */}
        <nav className="w-full shrink-0 sm:w-44">
          <p className={groupLabel}>Account</p>
          <button className={item(section === "profile")} onClick={() => openSettings("profile")}>
            Profile
          </button>
          <button className={item(section === "billing")} onClick={() => openSettings("billing")}>
            Billing
          </button>
          <p className={groupLabel}>Cars</p>
          <button className={item(section === "units")} onClick={() => openSettings("units")}>
            Units
          </button>
          {isAdmin && (
            <>
              <p className={groupLabel}>Admin</p>
              <button className={item(section === "insights")} onClick={() => openSettings("insights")}>
                Usage &amp; feedback
              </button>
              <button className={item(false)} onClick={goToChannelManager}>
                Channels
              </button>
            </>
          )}
        </nav>

        <div className="min-w-0 flex-1">
          {section === "profile" ? (
            <ProfileSection />
          ) : section === "billing" ? (
            <BillingSection />
          ) : section === "insights" && isAdmin ? (
            <AdminInsights />
          ) : (
            <UnitsSection />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Profile ─────────────── */

function ProfileSection() {
  const me = useQuery(api.users.me);
  const updateName = useMutation(api.profile.updateName);
  const changeEmail = useAction(api.profile.changeEmail);
  const changePassword = useAction(api.profile.changePassword);

  const [name, setName] = useState<string | null>(null);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  if (me === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const shownName = name ?? me?.name ?? "";

  const saveName = async () => {
    await updateName({ name: shownName });
    setNameMsg("Saved.");
    setTimeout(() => setNameMsg(null), 2000);
  };

  const submitEmail = async () => {
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      await changeEmail({ newEmail, currentPassword: emailPw });
      setEmailMsg({ ok: true, text: "Email changed. Use it next time you sign in." });
      setNewEmail("");
      setEmailPw("");
    } catch (e) {
      setEmailMsg({ ok: false, text: errText(e) });
    } finally {
      setEmailBusy(false);
    }
  };

  const submitPassword = async () => {
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "The new passwords do not match." });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changePassword({ currentPassword: curPw, newPassword: newPw });
      setPwMsg({ ok: true, text: "Password changed." });
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      setPwMsg({ ok: false, text: errText(e) });
    } finally {
      setPwBusy(false);
    }
  };

  const field = "mt-1 block w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm";
  const label = "text-sm font-medium";
  const note = (m: { ok: boolean; text: string } | null) =>
    m && (
      <p className={`mt-2 text-sm ${m.ok ? "text-green-500" : "text-destructive"}`}>
        {m.text}
      </p>
    );

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-base font-semibold">Your name</h3>
        <input
          className={field}
          value={shownName}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" onClick={() => void saveName()}>
            Save
          </Button>
          {nameMsg && <span className="text-sm text-green-500">{nameMsg}</span>}
        </div>
      </section>

      <section className="border-t pt-6">
        <h3 className="text-base font-semibold">Email</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          You sign in with <span className="text-foreground">{me?.email}</span>.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className={label} htmlFor="new-email">New email</label>
            <input
              id="new-email"
              type="email"
              className={field}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className={label} htmlFor="email-pw">Current password</label>
            <input
              id="email-pw"
              type="password"
              className={field}
              value={emailPw}
              onChange={(e) => setEmailPw(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button
            size="sm"
            disabled={emailBusy || !newEmail || !emailPw}
            onClick={() => void submitEmail()}
          >
            {emailBusy ? "Changing…" : "Change email"}
          </Button>
          {note(emailMsg)}
        </div>
      </section>

      <section className="border-t pt-6">
        <h3 className="text-base font-semibold">Password</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className={label} htmlFor="cur-pw">Current password</label>
            <input id="cur-pw" type="password" className={field} value={curPw}
              onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label className={label} htmlFor="new-pw">New password</label>
            <input id="new-pw" type="password" className={field} value={newPw}
              onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div>
            <label className={label} htmlFor="confirm-pw">New password again</label>
            <input id="confirm-pw" type="password" className={field} value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
          </div>
          <Button
            size="sm"
            disabled={pwBusy || !curPw || !newPw || !confirmPw}
            onClick={() => void submitPassword()}
          >
            {pwBusy ? "Changing…" : "Change password"}
          </Button>
          {note(pwMsg)}
        </div>
      </section>
    </div>
  );
}

/* ─────────────── Billing ─────────────── */

function BillingSection() {
  const access = useQuery(api.stripe.access);
  const portal = useAction(api.stripe.createPortalSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renews = access?.currentPeriodEnd
    ? new Date(access.currentPeriodEnd * 1000).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await portal({ returnOrigin: window.location.origin });
      window.location.href = url;
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  if (access === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const heading = access.comped
    ? "Complimentary access"
    : access.trialing
      ? "Free trial"
      : access.status === "active"
        ? "Subscribed"
        : access.status === "past_due"
          ? "Payment did not go through"
          : "No subscription";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-2xl font-semibold tracking-tight">{heading}</p>
        {renews && !access.comped && (
          <p className="mt-1 text-muted-foreground">
            {access.cancelAtPeriodEnd
              ? `Your access ends on ${renews}.`
              : access.trialing
                ? `Your card is charged $100 on ${renews}. Cancel before then and you pay nothing.`
                : `Renews on ${renews} for $100.`}
          </p>
        )}
        {access.comped && (
          <p className="mt-1 text-muted-foreground">
            You are not being charged for DragTrace.
          </p>
        )}
      </div>

      {access.status === "past_due" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">
          Your last payment was declined. Update your card to keep the account.
          You still have access for now.
        </p>
      )}

      {!access.comped && (
        <div>
          <Button disabled={busy} onClick={() => void openPortal()}>
            {busy ? "Opening…" : "Manage billing"}
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Change your card, get a receipt, or cancel. Handled by Stripe — we
            never see your card details.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="border-t pt-4 text-sm text-muted-foreground">
        $100 a year covers every car you own, every race and every pass.{" "}
        <a href="/?terms" className="underline hover:text-foreground">
          Terms
        </a>
        {" · "}
        <a href="/?privacy" className="underline hover:text-foreground">
          Privacy
        </a>
      </p>
    </div>
  );
}

/* ─────────────── Units ─────────────── */

function UnitsSection() {
  const vehicles = useQuery(api.vehicles.list);
  // null = the account-wide defaults every car starts from.
  const [scope, setScope] = useState<Id<"vehicles"> | null>(null);
  const active = vehicles?.find((v) => v._id === scope);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="units-scope" className="text-sm font-medium">
          Show units for
        </label>
        <select
          id="units-scope"
          value={scope ?? ""}
          onChange={(e) =>
            setScope((e.target.value || null) as Id<"vehicles"> | null)
          }
          className="mt-1.5 block w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All my cars (defaults)</option>
          {(vehicles ?? []).map((v) => (
            <option key={v._id} value={v._id}>
              {v.name}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {scope === null
            ? "How numbers show everywhere, unless a car overrides them."
            : "Only what is different for this car. Everything else follows your defaults."}
        </p>
      </div>

      <UnitsPanel
        key={scope ?? "user"}
        vehicleId={scope ?? undefined}
        vehicleName={active?.name}
      />
    </div>
  );
}
