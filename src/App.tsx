import { useCallback, useEffect, useState } from "react";
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
type Route = null | "signIn" | "signUp" | "privacy" | "terms";

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  if (params.has("privacy")) return "privacy";
  if (params.has("terms")) return "terms";
  if (params.has("signup")) return "signUp";
  if (params.has("signin")) return "signIn";
  return null;
}

const QUERY: Record<Exclude<Route, null>, string> = {
  signIn: "?signin",
  signUp: "?signup",
  privacy: "?privacy",
  terms: "?terms",
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

  const go = useCallback((next: Exclude<Route, null>) => {
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
    <Landing onSignIn={go} onLegal={go} />
  );
}

export default App;
