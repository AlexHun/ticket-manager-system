import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { User, UserRole, UsersListResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { Badge } from "@/components/ui/badge";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: User[] };

export function UsersPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/users`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) {
          setState({
            status: "error",
            message: `Failed to load users (${res.status})`,
          });
          return;
        }

        const data = (await res.json()) as UsersListResponse;
        setState({ status: "ready", users: data.users });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load users",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Users</h1>

        {state.status === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading users…
          </div>
        )}

        {state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}

        {state.status === "ready" && <UsersTable users={state.users} />}
      </main>
    </div>
  );
}

function UsersTable({ users }: { users: User[] }) {
  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No users found.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Verified</th>
            <th className="px-4 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-foreground/10">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"} className="capitalize">
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
