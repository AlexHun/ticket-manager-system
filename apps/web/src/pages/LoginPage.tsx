import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { loginSchema, type LoginValues } from "@ticket/core";
import {
  BRAND_NAME,
  DEMO_MODE_OFF_MESSAGE,
  DEMO_START_LIMIT_MESSAGE,
} from "@ticket/shared";
import { signIn, useSession } from "@/lib/auth-client";
import { failureMessage, UNREACHABLE_RESULT } from "@/lib/auth-failure";
import { useDemoStatus } from "@/lib/demo-queries";
import { ROUTE } from "@/lib/routes";
import { LoginLockup } from "@/components/layout/LoginLockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const SIGN_IN_REFUSED = "Couldn't sign you in. Check your email and password.";
const SIGN_IN_RATE_LIMITED =
  "Couldn't sign you in — too many attempts. Try again later.";

export function LoginPage() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: demoEnabled } = useDemoStatus();
  const [serverError, setServerError] = useState<string | null>(null);
  const [startingDemo, setStartingDemo] = useState(false);

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
  // A demo being started lands on the welcome, whichever arrives first: this
  // render with the new session, or `startDemo`'s own navigation. Otherwise a
  // session reaching the page first would carry the visitor past the welcome.
  if (session) {
    return (
      <Navigate
        to={startingDemo ? ROUTE.welcome.path : ROUTE.dashboard.path}
        replace
      />
    );
  }

  const onSubmit = async (values: LoginValues) => {
    setServerError(null);
    const { error } = await signIn
      .email(values)
      .catch(() => UNREACHABLE_RESULT);

    if (error) {
      setServerError(
        error.status === 429
          ? SIGN_IN_RATE_LIMITED
          : failureMessage(error, SIGN_IN_REFUSED),
      );
      return;
    }

    void navigate(ROUTE.dashboard.path, { replace: true });
  };

  /**
   * One click, no credential: the API mints a fresh demo identity and sets its
   * session cookie (#319). A fresh identity every time, which is what makes
   * every visitor a first-time user (R12). It lands on the welcome rather than
   * the Dashboard (demo-welcome R1), and this click is the only way there:
   * nothing redirects to it, so a reload never brings a visitor back (R8).
   *
   * A 403 is demo mode switched off between this page loading and the click.
   * It gets words of its own, because the fallback would describe a form
   * nobody filled in. A 429 is this address's starts for the hour (#322, R9),
   * read off the status rather than the body: Better Auth's own limiter
   * answers the same path in production with a 429 worded its own way.
   */
  const startDemo = async () => {
    setServerError(null);
    setStartingDemo(true);
    const { error } = await signIn.anonymous().catch(() => UNREACHABLE_RESULT);

    if (error) {
      setStartingDemo(false);
      setServerError(
        error.status === 403
          ? DEMO_MODE_OFF_MESSAGE
          : error.status === 429
            ? DEMO_START_LIMIT_MESSAGE
            : failureMessage(
                error,
                "Couldn't start a demo session. Try again.",
              ),
      );
      return;
    }

    void navigate(ROUTE.welcome.path, { replace: true });
  };

  const busy = isSubmitting || startingDemo;

  return (
    // The lockup beside the form; below `lg` it is a banner above it. The
    // scene may strike, but the form never enters or animates: it is the one
    // thing a visitor came to use, so it is there, focusable, on first paint.
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]">
      <LoginLockup />

      {/* Cast iron: a solid surface, so every word on it has one backdrop
          the contrast check can measure. The glow stays on the scene's side. */}
      <section
        aria-labelledby="sign-in-title"
        className="flex flex-col justify-center border-t bg-card px-6 py-10 text-card-foreground shadow-[0_-30px_70px_rgb(0_0_0/0.55)] sm:px-10 lg:border-t-0 lg:border-l lg:shadow-[-40px_0_90px_rgb(0_0_0/0.55)]"
      >
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 id="sign-in-title" className="text-xl font-semibold">
              Sign in
            </h2>
            <p className="text-sm text-muted-foreground">
              Use your email and password to access {BRAND_NAME}.
            </p>
          </div>
          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
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
                disabled={busy}
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
                disabled={busy}
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
            <Button type="submit" disabled={busy}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
            {/* The only route back in. An admin cannot type a colleague a new
                  password any more, so this link is not a convenience — for
                  anyone locked out, it is the whole recovery path. */}
            <Link
              to={ROUTE.forgotPassword.path}
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot your password?
            </Link>
          </form>
          {/* Only while the API says demo mode is on; absent, not disabled,
                otherwise. The refusal that matters is the API's — this only
                decides whether to offer. */}
          {demoEnabled && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void startDemo()}
              >
                {startingDemo && <Loader2 className="size-4 animate-spin" />}
                {startingDemo ? "Starting demo session…" : "Start demo session"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Look around as a demo visitor. No account needed.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
