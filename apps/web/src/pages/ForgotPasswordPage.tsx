import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@ticket/core";
import { authClient } from "@/lib/auth-client";
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

/**
 * Where a locked-out colleague goes.
 *
 * This screen exists because the admin-typed password is gone. Until it did,
 * the answer to "I can't get in" was an admin typing a new password and reading
 * it out — so the last person to know your password was never you.
 */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  /**
   * Always reports success, whatever happened.
   *
   * Not laziness about error handling: this form is public and unauthenticated,
   * so a message that distinguished "sent" from "no such account" would be an
   * endpoint for testing which of a company's email addresses have accounts.
   * Better Auth answers the same way for the same reason. A real failure is
   * reported server-side — see the Sentry call in `sendResetPassword`.
   */
  const onSubmit = async (values: ForgotPasswordValues) => {
    await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSent(true);
  };

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
            <CardTitle>{sent ? "Check your email" : "Forgot password"}</CardTitle>
            <CardDescription>
              {sent
                ? "If that address has an account, a link to choose a new password is on its way. It is good for 24 hours."
                : "Enter your email address and we will send you a link to choose a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="flex flex-col gap-4">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MailCheck className="size-4 shrink-0" />
                  You can close this page.
                </p>
                <Button asChild variant="outline">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </div>
            ) : (
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
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                  {isSubmitting ? "Sending…" : "Send reset link"}
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
