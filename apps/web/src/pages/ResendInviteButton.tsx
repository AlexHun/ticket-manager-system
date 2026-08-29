import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import type { User } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";

/**
 * Send this colleague their invitation again.
 *
 * The roster's door onto `POST /api/users/:id/invite` — the answer to an
 * expired link, an invitation sent to an address that has since been
 * corrected, or a plain lockout. See the route's own comment in
 * `apps/api/src/routes/users.ts` for why this is the only way an admin can
 * help: there is no password box on the edit form, so the person who ends up
 * knowing the password is always the person it belongs to.
 *
 * The mutation lives per row rather than on the page, so the spinner belongs
 * to the button that was clicked — one shared `isPending` on `UsersPage` would
 * put every row's button in a loading state at once.
 *
 * No confirmation dialog, unlike delete: this creates nothing and removes
 * nothing on the roster, and the worst outcome of a stray click is one extra
 * email to somebody who is entitled to it. A dialog would only put a second
 * click in front of the least dangerous action in the row.
 */
export function ResendInviteButton({ user }: { user: User }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/api/users/${user.id}/invite`);
    },
    onSuccess: () => {
      // The route writes a `user_invited` row, so an activity feed already on
      // screen is one entry behind. Nothing on the roster itself moves — the
      // 204 carries no user, and no field of one changed.
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast.success(`Invitation resent to ${user.email}`);
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Failed to resend invitation"));
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label={`Resend invitation to ${user.name}`}
    >
      {mutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
    </Button>
  );
}
