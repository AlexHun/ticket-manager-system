import type { ReactNode } from "react";
import { Bot, Pencil, Trash2 } from "lucide-react";
import { USER_ROLE, type User, type UserRole } from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TABLE_FRAME } from "@/lib/table-frame";
import { cn } from "@/lib/utils";
import { ResendInviteButton } from "./ResendInviteButton";

const SKELETON_ROW_COUNT = 5;

/**
 * `w-full` fills the frame on a wide screen; `min-w-2xl` is what makes the
 * frame scroll instead of squeezing on a narrow one. Without a floor the five
 * columns just keep compressing — at 375px the email column wraps to one word
 * per line and the row grows taller than the viewport. 42rem is roughly where
 * an address still fits on one line, and it is under the page's `max-w-5xl`
 * cap of 64rem — so on a full-width desktop window there is nothing to scroll,
 * and the floor only engages once the frame itself is narrower than 42rem.
 */
const TABLE = "w-full min-w-2xl text-sm";

/** One source for the header row, shared by the table and its skeleton. */
const USERS_TABLE_COLUMNS: { label: string; className?: string }[] = [
  { label: "Name" },
  { label: "Email" },
  { label: "Role" },
  { label: "Created" },
  { label: "Actions", className: "text-right" },
];

/**
 * One `<thead>` implementation for both the loaded table and its skeleton,
 * so a header cell's label or classes can't drift between the two the way
 * TicketsTable's `aria-label` once did (00b7468) — see the comment on
 * `HeaderCell` there.
 */
function UsersTableHead() {
  return (
    <thead className="bg-muted text-left text-muted-foreground">
      <tr>
        {USERS_TABLE_COLUMNS.map(({ label, className }) => (
          <th
            key={label}
            scope="col"
            className={cn("px-4 py-2 font-medium", className)}
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * One slot in the actions column: the control, or a gap the same size holding
 * its place.
 *
 * Every row draws all three slots whether or not it can use them, so the
 * buttons stay in one vertical line down the column — the assistant can use
 * none of them, and an admin cannot be deleted. Without the placeholder those
 * rows pull their remaining buttons rightwards and nothing lines up.
 *
 * `size-7` is `icon-sm`, and it lives here rather than at each call site
 * because it was copied four times before this existed: a fourth action should
 * cost one more slot, not one more copy of a magic number that has to agree
 * with the button variant three files away.
 */
function RowAction({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return <span aria-hidden className="size-7" />;
  return <>{children}</>;
}

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
    <div className={TABLE_FRAME}>
      <table className={TABLE}>
        <UsersTableHead />
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className="border-t border-border transition-colors hover:bg-muted/50"
            >
              <td className="px-4 py-2">{u.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
              <td className="px-4 py-2">
                {/* The assistant's row is on the roster because tickets are
                    filed under it and somebody has to be able to see what that
                    name is. Its `role` is `agent` and saying so would be
                    misleading — it is not a colleague with an agent's
                    permissions, it is an account nothing can sign into. */}
                {u.automated ? <AssistantBadge /> : <RoleBadge role={u.role} />}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1">
                  {/* No actions on the assistant, matching the API rather than
                      duplicating its reasoning: all three routes 403 on this
                      row. Editing it would offer to resend an invitation, and
                      accepting one creates the credential record it deliberately
                      has none of; deleting it would clear the assignee on every
                      ticket it has ever resolved, and only the seed can make
                      another. */}
                  <RowAction show={!u.automated}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEdit(u)}
                      aria-label={`Edit ${u.name}`}
                    >
                      <Pencil />
                    </Button>
                  </RowAction>
                  {/* Every real account, not just the ones that never signed in.
                      #84 asked for `emailVerified === false` here, which was
                      written against a schema that has since been decided
                      against: `POST /api/users` forces the column true and
                      nothing reads it, so that test now excludes everybody. The
                      cases this button exists for — an expired link, a corrected
                      address, a lockout — are things that happen to established
                      colleagues, and the API gates it on nothing but
                      `requireAdmin` and the assistant. See
                      `docs/adr/0010-no-email-verification.md`. */}
                  <RowAction show={!u.automated}>
                    <ResendInviteButton user={u} />
                  </RowAction>
                  <RowAction show={!u.automated && u.role !== USER_ROLE.admin}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(u)}
                      aria-label={`Delete ${u.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </RowAction>
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
      className={TABLE_FRAME}
      aria-busy="true"
      aria-label="Loading users"
    >
      <table className={TABLE}>
        <UsersTableHead />
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
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1">
                  {/* Three: edit, resend invite, delete. */}
                  <Skeleton className="size-7 rounded-md" />
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

function AssistantBadge() {
  return (
    <Badge variant="outline">
      <Bot />
      Assistant
    </Badge>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={role === USER_ROLE.admin ? "default" : "secondary"} className="capitalize">
      {role}
    </Badge>
  );
}

/*
 * There was a Verified / Unverified badge in this column until this app decided
 * it had no verification flow and was not getting one. It was worse than
 * useless: `emailVerified` defaulted false on every account an admin created,
 * and nothing anywhere could ever set it true, so the roster showed a permanent
 * warning against every real colleague and a clean tick against the assistant —
 * the one account with no mailbox at all. See
 * `docs/adr/0010-no-email-verification.md`.
 */
