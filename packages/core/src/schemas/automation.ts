import { z } from "zod";
import { HANDOFF_TARGET, HANDOFF_TARGETS } from "@ticket/shared";

/**
 * Changing who picks up a ticket the assistant hands back.
 *
 * The `superRefine` is the whole schema. `target` and `userId` are only
 * meaningful together — `user` without an id names nobody, and an id under any
 * other target is a value that would sit in the database looking like a
 * decision — so the pair is validated as one thing rather than as two fields
 * that happen to arrive in the same body. The error is attached to `userId`,
 * which is the control the admin has to touch to fix it.
 */
export const updateHandoffSchema = z
  .object({
    target: z.enum(HANDOFF_TARGETS, { error: "Choose who picks these up" }),
    /**
     * Null on every target but `user`. Not `.optional()`: a missing key and an
     * explicit null are the same intent here, and requiring the key means the
     * client cannot change the target while quietly leaving a stale id behind.
     */
    userId: z.string().trim().min(1).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.target === HANDOFF_TARGET.user && value.userId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["userId"],
        message: "Choose a person",
      });
    }
    if (value.target !== HANDOFF_TARGET.user && value.userId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["userId"],
        message: "Only the 'a specific person' target takes a user",
      });
    }
  });

export type UpdateHandoffValues = z.infer<typeof updateHandoffSchema>;
