import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordValues } from "@ticket/core";
import { authClient } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";
import { LogoMark } from "@/components/layout/Logo";
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

    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    });

    if (error) {
      setServerError(
        error.message ??
          "That link is no longer valid. Ask an admin to send you another.",
      );
      return;
    }

    toast.success("Password set — you can sign in now");
    navigate(ROUTE.login.path, { replace: true });
  };

  const unusable = !token || linkError !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 animate-panel-in">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">
            Ticket Manager
          </span>
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
                ? "Reset links are good for 24 hours and can only be used once. Ask an admin to send you a new one, or request one yourself."
                : inviting
                  ? "Your account is ready. Pick a password and you are in."
                  : "Pick a new password for your account."}
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
                onSubmit={handleSubmit(onSubmit)}
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
