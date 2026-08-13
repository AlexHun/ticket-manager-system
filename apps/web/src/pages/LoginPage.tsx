import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { loginSchema, type LoginValues } from "@ticket/core";
import { signIn, useSession } from "@/lib/auth-client";
import { LogoMark } from "@/components/layout/Logo";
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

export function LoginPage() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: import.meta.env.DEV
      ? { email: "admin@example.com", password: "password123" }
      : { email: "", password: "" },
  });

  if (sessionPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (values: LoginValues) => {
    setServerError(null);
    const { error } = await signIn.email(values);

    if (error) {
      // Better Auth reports the transport failure and the rejected credential
      // through the same channel, and they need different words. A network
      // failure arrives with no status at all; a server fault arrives as 5xx.
      // Neither says anything about what was typed, and answering both with
      // "Invalid email or password" sends someone off to reset a password that
      // was never the problem — which is exactly what happened here when the
      // API was down and sign-in returned 500.
      // Only when the status positively says so. A missing status is absence of
      // evidence, not evidence of a transport failure, and defaulting it to
      // "unreachable" would answer a plain rejected credential — which is what
      // Better Auth returns with no status in some paths — by blaming the
      // network.
      const status = error.status;
      const unreachable =
        typeof status === "number" && (status === 0 || status >= 500);

      setServerError(
        unreachable
          ? "Can't reach the ticket manager. Check your connection, or try again in a moment."
          : (error.message ?? "Invalid email or password"),
      );
      return;
    }

    navigate("/", { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      {/* The login card is the app's first frame, so it gets the panel entrance
          rather than the flatter page one — there is no previous screen for it
          to feel continuous with. The mark rides the same animation because it
          is part of that frame, not a decoration laid over it. */}
      <div className="flex w-full max-w-sm flex-col items-center gap-6 animate-panel-in">
        {/* The one screen that had no brand mark at all was the only one seen
            by someone not yet signed in — the sidebar carries it everywhere
            else. `aria-hidden` is on the mark itself, so the name beside it is
            what gets read. */}
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">
            Ticket Manager
          </span>
        </div>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use your email and password to access the ticket manager.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit(onSubmit)}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  disabled={isSubmitting}
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  disabled={isSubmitting}
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.password.message}
                  </p>
                )}
              </div>
              {serverError && (
                <p className="text-sm text-destructive" role="alert">
                  {serverError}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
