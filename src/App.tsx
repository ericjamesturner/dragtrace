import { useConvexAuth } from "convex/react";
import { SignIn } from "./components/SignIn";
import { Layout } from "./components/Layout";
import { ImpersonationBanner } from "./components/AdminControls";
import "./App.css";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return isAuthenticated ? (
    <>
      <Layout />
      <ImpersonationBanner />
    </>
  ) : (
    <SignIn />
  );
}

export default App;
