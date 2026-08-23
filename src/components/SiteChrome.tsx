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
  onOpenLog,
  onShareLog,
  links,
}: {
  onHome: () => void;
  onSignIn: (flow: "signIn" | "signUp") => void;
  onOpenLog?: () => void;
  onShareLog?: () => void;
  /** In-page anchors, shown on the landing page so you can jump to a section. */
  links?: readonly { label: string; href: string }[];
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08090a]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <button
          onClick={onHome}
          className="text-base font-semibold tracking-tight transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          DragTrace
        </button>
        {links && (
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-base text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
              >
                {l.label}
              </a>
            ))}
          </nav>
        )}
        <span className="ml-auto flex items-center gap-2">
          {onShareLog && (
            <button
              onClick={onShareLog}
              className="rounded-md bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
            >
              <span className="sm:hidden">Share log</span>
              <span className="hidden sm:inline">Share a log</span>
            </button>
          )}
          {onOpenLog && (
            <button
              onClick={onOpenLog}
              className="hidden rounded-md px-3 py-2 text-base text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 lg:block"
            >
              Open a log
            </button>
          )}
          <button
            onClick={() => onSignIn("signIn")}
            className="hidden rounded-md px-3 py-2 text-base text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 md:block"
          >
            Sign in
          </button>
          <button onClick={() => onSignIn("signUp")} className={`${CTA} px-3 py-2 text-sm sm:px-4`}>
            Get started
          </button>
        </span>
      </div>
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
            Haltech and Holley are trademarks of their respective owners.
            DragTrace is not affiliated with either company.
          </span>
        </div>
      </div>
    </footer>
  );
}
