import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserValues,
} from "@ticket/core";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  User,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { ticketAssigneesKey, ticketKeys } from "@/lib/ticket-queries";

interface UserDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_VALUES: CreateUserValues = { name: "", email: "", password: "" };

export function UserDialog({ user, open, onOpenChange }: UserDialogProps) {
  const isEdit = user !== null;
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(
      isEdit ? updateUserSchema : createUserSchema,
    ) as Resolver<CreateUserValues>,
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      user
        ? { name: user.name, email: user.email, password: "" }
        : EMPTY_VALUES,
    );
    setServerError(null);
  }, [open, user, reset]);

  const mutation = useMutation({
    mutationFn: async (values: CreateUserValues) => {
      if (user) {
        const payload: { name: string; email: string; password?: string } = {
          name: values.name,
          email: values.email,
        };
        if (values.password.length > 0) {
          payload.password = values.password;
        }
        const { data } = await api.patch<UpdateUserResponse>(
          `/api/users/${user.id}`,
          payload,
        );
        return data;
      }
      const { data } = await api.post<CreateUserResponse>("/api/users", values);
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      // Every active user is assignable, so creating one changes the picker's
      // roster and renaming one changes how they read in it. The roster lives
      // outside the `tickets` prefix and has its own key — without this, a
      // tickets page already mounted in this session keeps its cached list and
      // the new user is missing until a reload.
      void queryClient.invalidateQueries({ queryKey: ticketAssigneesKey });
      // A rename also changes the assignee shown on tickets this user already
      // holds. A brand new user holds none, so there is nothing to refetch.
      if (isEdit) {
        void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      }
      setServerError(null);
      onOpenChange(false);
      toast.success(
        isEdit
          ? `User "${data.user.name}" updated`
          : `User "${data.user.name}" created`,
      );
    },
    onError: (err) => {
      const message = extractErrorMessage(
        err,
        isEdit ? "Failed to update user" : "Failed to create user",
      );
      setServerError(message);
      toast.error(message);
    },
  });

  const onSubmit = (values: CreateUserValues) => {
    setServerError(null);
    mutation.mutate(values);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setServerError(null);
    onOpenChange(next);
  };

  const idPrefix = isEdit ? "edit-user" : "new-user";
  const title = isEdit ? "Edit user" : "Create user";
  const description = isEdit
    ? "Update this user's details. Leave the password blank to keep it unchanged."
    : "Add a new agent to the system.";
  const submitLabel = isEdit
    ? isSubmitting
      ? "Saving…"
      : "Save changes"
    : isSubmitting
      ? "Creating…"
      : "Create user";
  const passwordLabel = isEdit ? "New password" : "Password";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-name`}>Name</Label>
            <Input
              id={`${idPrefix}-name`}
              type="text"
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              disabled={isSubmitting}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-email`}>Email</Label>
            <Input
              id={`${idPrefix}-email`}
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
            <Label htmlFor={`${idPrefix}-password`}>{passwordLabel}</Label>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              disabled={isSubmitting}
              placeholder={
                isEdit ? "Leave blank to keep current password" : undefined
              }
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
            {submitLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
