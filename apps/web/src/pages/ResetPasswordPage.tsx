import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordValues } from "@ticket/core";
import { authClient } from "@/lib/auth-client";
import { failureMessage } from "@/lib/auth-failure";
import { ROUTE } from "@/lib/routes";
import { BrandName, LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const LINK_REFUSED =
  "That link is no longer valid. Ask an admin to send you another.";
export const RESET_RATE_LIMITED =
  "Couldn't set your password — too many attempts. Try again later.";

/**
 * Choosing a password from a link — the only way anyone gets one.
 *
 * **One screen for two arrivals.** A new colleague accepting an invitation and
 * a returning one who forgot their password land here on the same token, which
 * is what makes it a single flow rather than two that drift apart. The words
 * change and nothing else does.
 *
 * The token arrives as `?token=`, put there by Better Auth's redirect. It also
 * redirects here with `?error=INVALID_TOKEN` when the link has expired or been
 * used, which is a case worth handling on its own: somebody who waited two days
 * to open their invitation should be told to ask for another, not shown a form
 * that will fail when they submit it.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

  const token = params.get("token");
  const linkError = params.get("error");
  // An invitation and a reset are the same token; only the framing differs, and
  // the sender tells us which by way of the redirect it built.
  const inviting = params.get("invite") === "1";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (values: ResetPasswordValues) => {
    setServerError(null);
    if (!token) return;

    // A server that cannot be reached at all is no `error`: the client rejects,
    // with fetch's own TypeError. Any rejection is read as status 0, since a
    // request that never got an answer says nothing about the link either.
    const { error } = await authClient
      .resetPassword({ newPassword: values.password, token })
      .catch(() => ({ error: { status: 0 } }));

    // Only a refusal of the token blames the link: an unreachable server or a
    // rate limit says nothing about it, and an admin cannot help with either
    // (#537). Better Auth's own `message` ("Invalid token") is never shown
    // (#502).
    if (error) {
      setServerError(
        error.status === 429
          ? RESET_RATE_LIMITED
          : failureMessage(error, LINK_REFUSED),
      );
      return;
    }

    toast.success("Password set — you can sign in now");
    void navigate(ROUTE.login.path, { replace: true });
  };

  const unusable = !token || linkError !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 animate-panel-in">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-8" />
          <BrandName />
        </div>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              {unusable
                ? "That link has expired"
                : inviting
                  ? "Welcome — choose a password"
                  : "Choose a new password"}
            </CardTitle>
            <CardDescription>
              {unusable
                ? `${inviting ? "Invitation" : "Reset"} links are good for 24 hours and can only be used once. Ask an admin to send you a new one, or request one yourself.`
                : inviting
                  ? "Your account is ready. Choose a password and you are in."
                  : "Choose a new password for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {unusable ? (
              <div className="flex flex-col gap-2">
                <Button asChild>
                  <Link to={ROUTE.forgotPassword.path}>Request a new link</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to={ROUTE.login.path}>Back to sign in</Link>
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(event) => void handleSubmit(onSubmit)(event)}
                noValidate
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
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
                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.confirmPassword)}
                    disabled={isSubmitting}
                    {...register("confirmPassword")}
                  />
                  {errors.confirmPassword && (
                    <p className="text-sm text-destructive" role="alert">
                      {errors.confirmPassword.message}
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
                  {isSubmitting ? "Saving…" : "Set password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
