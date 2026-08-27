import { useEffect } from "react";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Privacy policy and terms, written to match what the code actually does:
 * account data has no sharing between users, guest logs stay in the browser,
 * feedback attachments and account files live in Convex storage, and the
 * plain-English features send channel names, a small sample of values, or a
 * timeslip photo to Anthropic.
 *
 * NOT LEGAL ADVICE. Eric shipped this without lawyer review on 2026-08-09;
 * worth a real review once there are paying customers.
 */

const UPDATED = "26 August 2026";

/** Fill these in before launch. */
const CO = {
  legalName: "DragTrace",
  address: "2921 N University Rd #1, Spokane Valley, WA 99206",
  email: "info@dragtrace.com",
  state: "Washington",
  smsName: "DragTrace",
};

export function Legal({
  page,
  onBack,
  onSignIn,
  onLegal,
}: {
  page: "privacy" | "terms";
  onBack: () => void;
  onSignIn: (flow: "signIn" | "signUp") => void;
  onLegal: (page: "privacy" | "terms") => void;
}) {
  useEffect(() => {
    window.scrollTo(0, 0);
    const prev = document.title;
    document.title =
      page === "privacy"
        ? "Privacy Policy — DragTrace"
        : "Terms of Service — DragTrace";
    return () => {
      document.title = prev;
    };
  }, [page]);

  return (
    <div className="min-h-dvh bg-[#08090a] text-white antialiased">
      <SiteHeader onHome={onBack} onSignIn={onSignIn} />

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {page === "privacy" ? <Privacy /> : <Terms />}

        <p className="mt-16 border-t border-white/12 pt-6 text-sm text-white/45">
          Last updated {UPDATED}. Questions: {CO.email}
        </p>
      </main>

      <SiteFooter onLegal={onLegal} />
    </div>
  );
}

/* ─────────────── building blocks ─────────────── */

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mt-10 text-[clamp(2rem,5vw,2.8rem)] font-semibold tracking-[-0.02em]">
      {children}
    </h1>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-semibold">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-lg leading-relaxed text-white/75">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-4 space-y-2 text-lg leading-relaxed text-white/75">
      {children}
    </ul>
  );
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-white/35" />
      <span>{children}</span>
    </li>
  );
}

/* ─────────────── privacy ─────────────── */

function Privacy() {
  return (
    <>
      <H1>Privacy Policy</H1>
      <P>
        This explains what DragTrace collects, what we do with it, and who else
        touches it.
      </P>

      <H2>Your logs are yours. We do not share them.</H2>
      <P>
        If you use the guest viewer, your selected datalogs are read and parsed
        on your device. We do not upload or store those files, their filenames,
        or their contents. Reloading the page clears the log files. Your browser
        stores the guest workspace locally—including channel names, pages, units,
        and chart settings—so it is ready for the next logs you open. That local
        workspace stays on your device until you clear this site's browser data.
        We do send a one-way fingerprint of each log so we can count distinct
        logs without receiving their contents. A file is uploaded only if you
        deliberately attach it to feedback or choose to create a public share
        link.
      </P>
      <P>
        Your datalogs, your charts, your notes and your timeslips are private to
        your account. No other DragTrace customer can see them. There is no public
        sharing, no shared link and no feed. We do not sell your data, we do not
        rent it, and we do not hand it to advertisers or to anyone building a
        competing car.
      </P>
      <P>
        Two honest exceptions, spelled out below: the companies that run our
        servers and the plain-English features, and our own staff when you ask for
        help.
      </P>

      <H2>What we collect</H2>
      <UL>
        <LI>
          <strong className="text-white">Your account.</strong> Email address and
          a password. Passwords are stored hashed; we never see the plain text.
        </LI>
        <LI>
          <strong className="text-white">What you enter.</strong> Vehicles, races,
          notes, timeslip numbers and the charts you build.
        </LI>
        <LI>
          <strong className="text-white">Your datalog files.</strong> The files
          you upload, exactly as your ECU wrote them.
        </LI>
        <LI>
          <strong className="text-white">Viewer usage.</strong> A random browser
          identifier for guests, viewer start and active time, whether the viewer
          was guest or signed in, the number of logs opened, and a one-way log
          fingerprint used to count distinct logs. We do not collect the guest
          log's filename or contents for analytics.
        </LI>
        <LI>
          <strong className="text-white">Signed-in account activity.</strong>{" "}
          When you use an account, we record sign-ins and the vehicles, events,
          logs, comparisons and settings pages you open, along with the time,
          IP address, browser/device information and page route. We use this to
          understand whether the product is being used, provide support and
          investigate security or reliability problems. This does not apply to
          datalogs opened only in the guest viewer.
        </LI>
        <LI>
          <strong className="text-white">Feedback.</strong> The message and star
          rating you send, an email address if you provide one, the viewer page
          it came from, any files you choose to attach, and—only if you opt
          in—permission and a display name for using your words as a testimonial.
        </LI>
        <LI>
          <strong className="text-white">Logs you publish.</strong> If you choose
          “Create public link,” we store that selected log and a generated social
          preview image, plus the name and email address you enter when publishing.
          Vehicle details and a description or question are optional; if you add
          them, they are shown publicly with the log. Anyone with the link can
          open the log, but your name and email stay private to DragTrace. No
          other guest logs or account data are included.
        </LI>
        <LI>
          <strong className="text-white">Phone number,</strong> if you give us
          one for text messages. See the SMS section of the Terms.
        </LI>
      </UL>
      <P>
        We do not ask for your address, your date of birth or your payment card
        details. Card details, when subscriptions start, will be handled by a
        payment processor and never stored on our servers.
      </P>

      <H2>Who else touches your data</H2>
      <UL>
        <LI>
          <strong className="text-white">Convex</strong> runs our database and
          stores your uploaded files.
        </LI>
        <LI>
          <strong className="text-white">Vercel</strong> serves the website.
        </LI>
        <LI>
          <strong className="text-white">Anthropic</strong> powers the
          plain-English features. See the next section for exactly what gets sent.
        </LI>
      </UL>
      <P>
        These companies process data so we can run the service. They are not
        allowed to use it for their own purposes.
      </P>

      <H2>What the AI features send, and when</H2>
      <P>
        Nothing is sent unless you use one of these features. Your whole datalog
        file is never uploaded to Anthropic.
      </P>
      <UL>
        <LI>
          <strong className="text-white">Writing an alert in plain words.</strong>{" "}
          We send your sentence, the list of channel names on the car, your unit
          preferences, and roughly twenty sampled values per channel from the part
          of the run you are looking at, so the thresholds it writes are realistic.
        </LI>
        <LI>
          <strong className="text-white">Making a math channel.</strong> We send
          your sentence and the list of channel names.
        </LI>
        <LI>
          <strong className="text-white">Suggesting scatter plots.</strong> We
          send the list of channel names.
        </LI>
        <LI>
          <strong className="text-white">Scanning a timeslip photo.</strong> We
          send the photo so the numbers can be read off it. The photo is deleted
          from our storage once the scan finishes.
        </LI>
      </UL>
      <P>
        Anthropic processes these requests through its business API, under terms
        that do not permit your data to be used to train its models.
      </P>

      <H2>When our staff can see your account</H2>
      <P>
        DragTrace staff can open your account to help you with a support problem
        or to investigate a fault. We do it to fix things, not to browse. If this
        bothers you, tell us and we will explain exactly what was accessed and
        when. The signed-in activity timeline is available only to DragTrace
        administrators.
      </P>

      <H2>How long we keep it</H2>
      <P>
        Your files stay until you delete them or close your account. Deleting a
        car, a race or a pass removes its files and timeslips from our storage.
        Publicly shared guest logs stay available at their link; email {CO.email}
        if you want one removed. Backups may hold copies for a short period
        afterwards. Raw signed-in activity records, including IP address and
        browser/device information, are kept for 90 days and then deleted.
      </P>

      <H2>Getting your data out, or deleting it</H2>
      <P>
        Every pass has a download button that gives you back the original file, so
        you are never locked in. To delete your account and everything in it,
        email {CO.email} and we will do it.
      </P>

      <H2>Security</H2>
      <P>
        Traffic is encrypted in transit. Files and records are scoped to your
        account and checked on every read and write. No system is perfect, so if
        something goes wrong that affects you, we will tell you.
      </P>

      <H2>Children</H2>
      <P>
        DragTrace is not intended for anyone under 18, and we do not knowingly
        collect information from children.
      </P>

      <H2>Changes</H2>
      <P>
        If we change this in a way that matters, we will say so in the app or by
        email before it takes effect.
      </P>

      <H2>Contact</H2>
      <P>
        {CO.legalName}, {CO.address}. Email {CO.email}.
      </P>
    </>
  );
}

/* ─────────────── terms ─────────────── */

function Terms() {
  return (
    <>
      <H1>Terms of Service</H1>
      <P>
        These are the terms for using DragTrace. Using the service means you
        accept them.
      </P>

      <H2>Your account</H2>
      <P>
        You need to be 18 or older. Keep your password to yourself; you are
        responsible for what happens under your account. One account is for one
        person — it is not meant to be shared around a team.
      </P>

      <H2>What it costs</H2>
      <P>
        DragTrace is $100 per year. That covers every car you own, every race and
        every pass, with no per-car charge. A subscription renews each year unless
        you cancel it first. Cancel any time and you keep access until the end of
        the period you paid for. Prices can change, but not in the middle of a
        term you have already paid for.
      </P>

      <H2>Your logs belong to you</H2>
      <P>
        You own your datalogs and everything you put into DragTrace. You give us
        permission to store and process them only so far as it takes to run the
        service for you — for example, to draw your charts, check your alerts and
        show you the run. That permission ends when you delete the data. We do not
        use your logs to build anything of our own, and we do not share them with
        other customers.
      </P>

      <H2>Fair use</H2>
      <UL>
        <LI>Do not upload anything that is not yours to upload.</LI>
        <LI>
          Do not try to break into other accounts, or work around the limits of
          the service.
        </LI>
        <LI>Do not resell DragTrace or run it as a service for other people.</LI>
        <LI>
          Do not hammer the AI features automatically. They cost us money per
          request and we may throttle or suspend accounts that abuse them.
        </LI>
      </UL>

      <H2>It is an analysis tool, not a safety system</H2>
      <P>
        DragTrace shows you what your ECU recorded and flags patterns you asked it
        to watch for. It does not inspect your car, and it cannot tell you the car
        is safe to run. Alerts can miss things, and they can flag things that turn
        out to be nothing. Every decision about your car, your combination and
        your safety stays yours and your crew's. Do not rely on DragTrace as the
        only check before a run.
      </P>

      <H2>Text messages</H2>
      <P>
        If you give us your mobile number, {CO.smsName} may text you about your
        account and the service — for example a sign-in code, or a note that
        something needs your attention.
      </P>
      <UL>
        <LI>
          You agree to receive these messages when you give us your number. It is
          not a condition of buying anything.
        </LI>
        <LI>Message frequency varies.</LI>
        <LI>Message and data rates may apply.</LI>
        <LI>
          Reply <strong className="text-white">STOP</strong> to any message to
          stop them. Reply <strong className="text-white">HELP</strong> for help,
          or email {CO.email}.
        </LI>
        <LI>
          Carriers are not liable for delayed or undelivered messages.
        </LI>
        <LI>
          We do not sell or share your mobile number or your consent to it with
          anyone for their own marketing.
        </LI>
      </UL>

      <H2>Interruptions</H2>
      <P>
        We aim to keep DragTrace up, but we do not promise it will never be down.
        We may change or retire features. If we make a change that takes away
        something you were relying on, we will give you notice.
      </P>

      <H2>No warranty</H2>
      <P>
        DragTrace is provided as is, without warranties of any kind, to the extent
        the law allows.
      </P>

      <H2>Limit of liability</H2>
      <P>
        To the extent the law allows, {CO.legalName} is not liable for lost races,
        lost rounds, damaged parts, engine damage, lost data or lost profits. Our
        total liability is limited to what you paid us in the twelve months before
        the claim.
      </P>

      <H2>Ending it</H2>
      <P>
        You can close your account any time. We can suspend or close an account
        that breaks these terms. If we close yours without cause, we will refund
        the unused part of your subscription.
      </P>

      <H2>Governing law</H2>
      <P>
        These terms are governed by the laws of {CO.state}, without regard to
        conflict-of-law rules.
      </P>

      <H2>Contact</H2>
      <P>
        {CO.legalName}, {CO.address}. Email {CO.email}.
      </P>
    </>
  );
}
