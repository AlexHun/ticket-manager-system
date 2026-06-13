import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email"),
  password: z.string().trim().min(8, "Password must be at least 8 characters"),
});

export type CreateUserValues = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email"),
  password: z
    .string()
    .trim()
    .refine(
      (v) => v.length === 0 || v.length >= 8,
      "Password must be at least 8 characters",
    )
    .optional(),
});

export type UpdateUserValues = z.infer<typeof updateUserSchema>;
