import { useConvexAuth } from "convex/react";
import { SignIn } from "./components/SignIn";
import { Layout } from "./components/Layout";
import "./App.css";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return isAuthenticated ? <Layout /> : <SignIn />;
}

export default App;
