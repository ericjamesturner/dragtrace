/**
 * The public site's shared header and footer, used by the landing page and the
 * legal pages so every page looks like part of the same website — the way
 * every website works.
 */

const CTA =
  "rounded-lg bg-white font-semibold text-black transition-colors hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function SiteHeader({
  onHome,
  onSignIn,
}: {
  onHome: () => void;
  onSignIn: (flow: "signIn" | "signUp") => void;
}) {
  return (
    <header className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-5">
      <button
        onClick={onHome}
        className="text-base font-semibold tracking-tight transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        DragTrace
      </button>
      <span className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onSignIn("signIn")}
          className="rounded-md px-3 py-2 text-base text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          Sign in
        </button>
        <button onClick={() => onSignIn("signUp")} className={`${CTA} px-4 py-2 text-sm`}>
          Get started
        </button>
      </span>
    </header>
  );
}

export function SiteFooter({
  onLegal,
}: {
  onLegal: (page: "privacy" | "terms") => void;
}) {
  const link =
    "text-left text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60";
  return (
    <footer className="border-t border-white/12">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-md">
            <span className="text-base font-semibold tracking-tight">
              DragTrace
            </span>
            <p className="mt-3 text-base leading-relaxed text-white/60">
              Your logs are private to your account. We do not share them with
              other customers, we do not sell them, and we do not use them to
              build anything of our own.
            </p>
          </div>

          <nav className="flex flex-col gap-2 text-base">
            <button onClick={() => onLegal("privacy")} className={link}>
              Privacy policy
            </button>
            <button onClick={() => onLegal("terms")} className={link}>
              Terms of service
            </button>
            <button onClick={() => onLegal("terms")} className={link}>
              Text message terms
            </button>
            <a href="mailto:info@dragtrace.com" className={link}>
              Contact
            </a>
          </nav>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-6 text-sm text-white/40">
          <span>© {new Date().getFullYear()} DragTrace</span>
          <span className="text-white/25">·</span>
          <span>
            Haltech is a trademark of its owner. DragTrace is not affiliated with
            Haltech.
          </span>
        </div>
      </div>
    </footer>
  );
}
