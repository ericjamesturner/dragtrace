import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-3xl font-bold tracking-tight">
          Log Viewer
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>{flow === "signIn" ? "Sign In" : "Sign Up"}</CardTitle>
            <CardDescription>
              {flow === "signIn"
                ? "Enter your credentials to continue"
                : "Create a new account to get started"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <form
              className="space-y-4"
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
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Password"
                  required
                />
              </div>
              <input name="flow" type="hidden" value={flow} />
              <button type="submit" className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-all">
                {flow === "signIn" ? "Sign In" : "Sign Up"}
              </button>
            </form>
            <Button
              variant="link"
              className="mt-2 w-full text-sm"
              onClick={() => {
                setFlow(flow === "signIn" ? "signUp" : "signIn");
                setError("");
              }}
            >
              {flow === "signIn"
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
