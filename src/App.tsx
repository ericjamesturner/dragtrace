import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { SignIn } from "./components/SignIn";
import { Subscribe } from "./components/Subscribe";
import { Landing } from "./components/Landing";
import { Legal } from "./components/Legal";
import { Layout } from "./components/Layout";
import { ImpersonationBanner } from "./components/AdminControls";
import "./App.css";

/**
 * Signed-out visitors land on the marketing page. The auth form and the legal
 * pages live behind query flags so they survive a reload and the back button,
 * matching how the rest of the app keeps its place in the query string. The
 * legal pages are reachable whether or not you are signed in.
 */
const PublicLogPage = lazy(() => import("./components/PublicLogPage"));
const SharedLogPage = lazy(() => import("./components/SharedLogPage"));

type Route = null | "signIn" | "signUp" | "privacy" | "terms" | "open" | "share";
type NavigableRoute = Exclude<Route, null | "share">;

function readShareId(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("share");
  if (fromQuery) return fromQuery;
  const match = /^\/share\/([^/]+)\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  if (params.has("privacy")) return "privacy";
  if (params.has("terms")) return "terms";
  if (params.has("signup")) return "signUp";
  if (params.has("signin")) return "signIn";
  if (readShareId()) return "share";
  if (window.location.pathname === "/open") return "open";
  return null;
}

const QUERY: Record<NavigableRoute, string> = {
  signIn: "/?signin",
  signUp: "/?signup",
  privacy: "/?privacy",
  terms: "/?terms",
  open: "/open",
};

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [route, setRoute] = useState<Route>(readRoute);
  // Skipped entirely while signed out, so the landing page costs no queries.
  const access = useQuery(api.stripe.access, isAuthenticated ? {} : "skip");

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: NavigableRoute) => {
    window.history.pushState({}, "", QUERY[next]);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  const goHome = useCallback(() => {
    window.history.pushState({}, "", "/");
    setRoute(null);
  }, []);

  // Legal pages win over everything, so a link to them always works.
  if (route === "privacy" || route === "terms") {
    return <Legal page={route} onBack={goHome} onSignIn={go} onLegal={go} />;
  }

  if (route === "open") {
    return (
      <Suspense fallback={<div className="loading">Loading viewer...</div>}>
        <PublicLogPage onHome={goHome} onSignIn={() => go("signIn")} />
      </Suspense>
    );
  }

  if (route === "share") {
    const shareId = readShareId() ?? "";
    return (
      <Suspense fallback={<div className="loading">Loading shared log...</div>}>
        <SharedLogPage key={shareId} shareId={shareId} onHome={goHome} />
      </Suspense>
    );
  }

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (isAuthenticated) {
    if (access === undefined) {
      return <div className="loading">Loading...</div>;
    }
    if (!access.active) {
      return <Subscribe />;
    }
    return (
      <>
        <Layout />
        <ImpersonationBanner />
      </>
    );
  }

  return route ? (
    <SignIn initialFlow={route} onBack={goHome} />
  ) : (
    <Landing onSignIn={go} onLegal={go} onOpenLog={() => go("open")} />
  );
}

export default App;
