import { useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import type { User, UsersListResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
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

  const openCreate = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Users</h1>
          <Button onClick={openCreate}>New user</Button>
        </div>

        {isPending && <UsersTableSkeleton />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {formatError(error)}
          </p>
        )}

        {users && <UsersTable users={users} onEdit={openEdit} />}

        <UserDialog
          user={editingUser}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </main>
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
