import { CheckCircle2, Pencil, Trash2, XCircle } from "lucide-react";
import { USER_ROLE, type User, type UserRole } from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 5;

interface UsersTableProps {
  users: User[];
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

export function UsersTable({ users, onEdit, onDelete }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No users found.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Verified</th>
            <th className="px-4 py-2 font-medium">Created</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className="border-t border-border transition-colors hover:bg-muted/50"
            >
              <td className="px-4 py-2">{u.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
              <td className="px-4 py-2">
                <RoleBadge role={u.role} />
              </td>
              <td className="px-4 py-2">
                <VerifiedBadge verified={u.emailVerified} />
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(u)}
                    aria-label={`Edit ${u.name}`}
                  >
                    <Pencil />
                  </Button>
                  {u.role !== USER_ROLE.admin ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(u)}
                      aria-label={`Delete ${u.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  ) : (
                    <span aria-hidden className="size-7" />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsersTableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg ring-1 ring-border"
      aria-busy="true"
      aria-label="Loading users"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Verified</th>
            <th className="px-4 py-2 font-medium">Created</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-32" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-48" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-5 w-16 rounded-md" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-5 w-24 rounded-md" />
              </td>
              <td className="px-4 py-2">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Skeleton className="size-7 rounded-md" />
                  <Skeleton className="size-7 rounded-md" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={role === USER_ROLE.admin ? "default" : "secondary"} className="capitalize">
      {role}
    </Badge>
  );
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <Badge variant="secondary">
        <CheckCircle2 />
        Verified
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <XCircle />
      Unverified
    </Badge>
  );
}
