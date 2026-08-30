import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  createUserSchema,
  updateUserSchema,
  type UpdateUserValues,
} from "@ticket/core";
import { USER_ROLE } from "@ticket/shared";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  User,
  UserRole,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { activityKeys } from "@/lib/activity-queries";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/errors";
import { ticketAssigneesKey, ticketKeys } from "@/lib/ticket-queries";

interface UserDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The create form has no role control — a new account is always an `agent`, and
 * `createUserSchema` strips this field back off on the way out, so the POST body
 * is still name and email alone. It is in the defaults rather than left
 * undefined because one `useForm` serves both modes and react-hook-form wants a
 * value for every field it renders.
 */
const EMPTY_VALUES: UpdateUserValues = {
  name: "",
  email: "",
  role: USER_ROLE.agent,
};

/**
 * How each role reads in the picker; the values are the roles themselves.
 *
 * A full `Record` over `UserRole` rather than a lookup with a fallback — the
 * same forcing function `ACTIVITY_ACTION_LABEL` uses: a third role would be a
 * compile error here until somebody decides how it reads, rather than a raw
 * enum key reaching the dropdown.
 */
const ROLE_LABEL: Record<UserRole, string> = {
  [USER_ROLE.admin]: "Admin",
  [USER_ROLE.agent]: "Agent",
};

export function UserDialog({ user, open, onOpenChange }: UserDialogProps) {
  const isEdit = user !== null;
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  /**
   * Editing your own account. The role picker is disabled here rather than
   * removed, so the row still says what you are — and the API refuses a
   * self role change whatever this control does (`PATCH /api/users/:id`).
   * That refusal is the only thing standing between this desk and having no
   * admins left, so it lives on the server; this is the courtesy half.
   */
  const isSelf = isEdit && user.id === session?.user?.id;

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateUserValues>({
    // One form, two schemas. The cast goes through `unknown` because the create
    // schema is now a strict subset — it has no `role` at all — so the two
    // resolver types no longer overlap enough for a direct assertion. That
    // narrowness is the point: on the create path zod strips `role` back off,
    // which is what keeps the POST body name-and-email even though the form
    // state carries a third field.
    resolver: zodResolver(
      isEdit ? updateUserSchema : createUserSchema,
    ) as unknown as Resolver<UpdateUserValues>,
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      user
        ? { name: user.name, email: user.email, role: user.role }
        : EMPTY_VALUES,
    );
    setServerError(null);
  }, [open, user, reset]);

  const mutation = useMutation({
    mutationFn: async (values: UpdateUserValues) => {
      if (user) {
        const { data } = await api.patch<UpdateUserResponse>(
          `/api/users/${user.id}`,
          values,
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
      // Both branches write to the audit trail — a create logs `user_created`
      // and the invitation beside it, an edit logs one row per field that
      // moved — so a feed left open in another tab is now behind.
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
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

  const onSubmit = (values: UpdateUserValues) => {
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
    ? "Update this user's details."
    : "They will be sent a link to choose their own password.";
  const submitLabel = isEdit
    ? isSubmitting
      ? "Saving…"
      : "Save changes"
    : isSubmitting
      ? "Creating…"
      : "Create user";

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
          {/* Edit only. Every account starts as an agent and is promoted, if
              ever, from here — offering the choice at creation would make the
              role a thing you decide before you know the person. */}
          {isEdit && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-role`}>Role</Label>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting || isSelf}
                  >
                    <SelectTrigger id={`${idPrefix}-role`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(USER_ROLE).map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  You cannot change your own role — ask another admin. This is
                  what stops the desk being left with nobody who can administer
                  it.
                </p>
              )}
            </div>
          )}
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
