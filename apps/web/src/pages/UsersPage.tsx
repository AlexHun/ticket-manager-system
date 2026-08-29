import { useState } from "react";
import axios from "axios";
import { TUTORIAL_PAGE_KEY, type User } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Tutorial } from "@/components/Tutorial";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUsersQuery } from "@/lib/use-users";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { UserDialog } from "./UserDialog";
import { UsersTable, UsersTableSkeleton } from "./UsersTable";

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
      <Tutorial pageKey={TUTORIAL_PAGE_KEY.users} />

      {/* A measure cap, and the only page that needs one.

          Five columns of short values — a name, an address, a role, a date —
          stretched to whatever width the window happened to be, so on a wide
          screen a two-person team read as five words stranded at the far left
          and a delete button a foot away at the far right. The dashboard's
          panels earn their width by plotting into it and the ticket table has
          subjects to fill it; this has neither. 64rem is where the address
          column stops growing and the row still tracks left-to-right. Not
          centred: the sidebar is the left edge of the app, and a block floating
          in the middle of the frame would only move the void rather than close
          it. */}
      <div className="max-w-5xl">
        <PageHeader
          title="Users"
          description="Everyone who can sign in to the ticket manager."
        >
          <div data-tutorial-anchor="new" className="contents">
            <Button onClick={openCreate}>New user</Button>
          </div>
        </PageHeader>

        {isPending && <UsersTableSkeleton />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {formatError(error)}
          </p>
        )}

        {users && (
          <div data-tutorial-anchor="list" className="contents">
            <UsersTable users={users} onEdit={openEdit} onDelete={openDelete} />
          </div>
        )}
      </div>

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
