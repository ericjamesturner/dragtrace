import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState("");

  return (
    <div className="auth-container">
      <h1>Log Viewer</h1>
      <div className="auth-card">
        <h2>{flow === "signIn" ? "Sign In" : "Sign Up"}</h2>
        {error && <p className="auth-error">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            const formData = new FormData(e.currentTarget);
            void signIn("password", formData).catch(() => {
              setError(
                flow === "signIn"
                  ? "Invalid email or password."
                  : "Could not create account. Try a different email."
              );
            });
          }}
        >
          <input name="email" placeholder="Email" type="email" required />
          <input
            name="password"
            placeholder="Password"
            type="password"
            required
          />
          <input name="flow" type="hidden" value={flow} />
          <button type="submit">
            {flow === "signIn" ? "Sign In" : "Sign Up"}
          </button>
        </form>
        <button
          type="button"
          className="auth-toggle"
          onClick={() => {
            setFlow(flow === "signIn" ? "signUp" : "signIn");
            setError("");
          }}
        >
          {flow === "signIn"
            ? "Don't have an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
