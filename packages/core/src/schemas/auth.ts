import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type LoginValues = z.infer<typeof loginSchema>;

/** Asking for a link, from the public "forgot password" form. */
export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/**
 * Choosing a password from a link, which is both halves of the same screen: a
 * colleague accepting an invitation and a colleague who forgot theirs.
 *
 * Eight characters is Better Auth's own `minPasswordLength` default, restated
 * here so the browser says so before a round trip rather than after one. The
 * confirmation field is checked with `refine` and reported against
 * `confirmPassword`, so the message lands under the box that is wrong.
 */
export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
