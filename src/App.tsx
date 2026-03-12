import { useConvexAuth } from "convex/react";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";
import "./App.css";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return isAuthenticated ? <Dashboard /> : <SignIn />;
}

export default App;
