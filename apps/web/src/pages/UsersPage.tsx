import { useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import type { User, UsersListResponse } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { UserDialog } from "./UserDialog";
import { UsersTable, UsersTableSkeleton } from "./UsersTable";

function useUsersQuery() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<UsersListResponse>("/api/users", { signal });
      return data.users;
    },
  });
}

export function UsersPage() {
  const { data: users, isPending, error } = useUsersQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  const openCreate = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const openDelete = (user: User) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={openCreate}>New user</Button>
      </div>

      {isPending && <UsersTableSkeleton />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {formatError(error)}
        </p>
      )}

      {users && (
        <UsersTable users={users} onEdit={openEdit} onDelete={openDelete} />
      )}

      <UserDialog
        user={editingUser}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <DeleteUserDialog
        user={deletingUser}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}

function formatError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `Failed to load users (${err.response?.status ?? err.message})`;
  }
  if (err instanceof Error) return err.message;
  return "Failed to load users";
}
