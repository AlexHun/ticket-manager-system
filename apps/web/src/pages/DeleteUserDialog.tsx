import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { User } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";

interface DeleteUserDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
}: DeleteUserDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) setServerError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/users/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setServerError(null);
      onOpenChange(false);
      if (user) toast.success(`User "${user.name}" deleted`);
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Failed to delete user");
      setServerError(message);
      toast.error(message);
    },
  });

  const handleConfirm = () => {
    if (!user) return;
    setServerError(null);
    mutation.mutate(user.id);
  };

  const isSubmitting = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user</DialogTitle>
          <DialogDescription>
            {user
              ? `Are you sure you want to delete "${user.name}" (${user.email})? This will revoke their sessions and hide them from the users list.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {serverError && (
          <p className="text-sm text-destructive" role="alert">
            {serverError}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSubmitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || !user}
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isSubmitting ? "Deleting…" : "Delete user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
