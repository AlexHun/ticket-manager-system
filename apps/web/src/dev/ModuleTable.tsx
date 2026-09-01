import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { Hint } from "@/components/Hint";
import { TableFrame } from "@/lib/table-frame";
import { cn } from "@/lib/utils";
import { LayerBadge } from "./LayerBadge";
import type { ModuleNode } from "./protocol";

/**
 * Every module in the filtered set, as a sortable table.
 *
 * The non-visual twin of the graph, and the only view that ranks: sorting by
 * "imported by" is how you find the modules the whole app leans on, and by "code"
 * how you find the ones that have grown. A plain `<table>` rather than a
 * component, matching `TicketsTable` — this repo has no shadcn table, and a table
 * is markup, not a control.
 */

const SORT_KEY = {
  path: "path",
  code: "code",
  fanIn: "fanIn",
  fanOut: "fanOut",
} as const;

type SortKey = (typeof SORT_KEY)[keyof typeof SORT_KEY];

interface Column {
  key: SortKey;
  label: string;
  /** Right-aligned, tabular figures — the numeric columns. */
  numeric?: boolean;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: SORT_KEY.path, label: "Module" },
  { key: SORT_KEY.code, label: "Code", numeric: true, title: "Lines that are neither blank nor comment" },
  { key: SORT_KEY.fanIn, label: "In", numeric: true, title: "Modules importing this one" },
  { key: SORT_KEY.fanOut, label: "Out", numeric: true, title: "Internal modules this one imports" },
];

function valueOf(module: ModuleNode, key: SortKey): string | number {
  if (key === SORT_KEY.code) return module.code;
  if (key === SORT_KEY.fanIn) return module.importedBy.length;
  if (key === SORT_KEY.fanOut) return module.imports.length;
  return module.id;
}

interface ModuleTableProps {
  modules: ModuleNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ModuleTable({ modules, selectedId, onSelect }: ModuleTableProps) {
  const [key, setKey] = useState<SortKey>(SORT_KEY.fanIn);
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...modules];
    rows.sort((a, b) => {
      const left = valueOf(a, key);
      const right = valueOf(b, key);
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      // Ties fall back to the path, so the order is total and a re-render never
      // reshuffles equal rows.
      return (descending ? -order : order) || a.id.localeCompare(b.id);
    });
    return rows;
  }, [modules, key, descending]);

  const toggle = (next: SortKey) => {
    if (next === key) {
      setDescending((prev) => !prev);
      return;
    }
    setKey(next);
    // Numbers are interesting from the top, names from the start.
    setDescending(next !== SORT_KEY.path);
  };

  if (modules.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg ring-1 ring-border">
        <p className="text-sm text-muted-foreground">
          No modules match the current filters.
        </p>
      </div>
    );
  }

  return (
    <TableFrame label="Modules">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  key === column.key
                    ? descending
                      ? "descending"
                      : "ascending"
                    : "none"
                }
                className={cn(
                  "sticky top-0 z-10 bg-muted px-3 py-2 text-left font-medium",
                  column.numeric && "text-right",
                )}
              >
                <Hint content={column.title}>
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className={cn(
                      "flex cursor-pointer items-center gap-1 select-none hover:text-foreground",
                      column.numeric && "ml-auto",
                    )}
                  >
                    {column.label}
                    {key === column.key &&
                      (descending ? (
                        <ArrowDown aria-hidden="true" className="size-3" />
                      ) : (
                        <ArrowUp aria-hidden="true" className="size-3" />
                      ))}
                  </button>
                </Hint>
              </th>
            ))}
            <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left font-medium">
              Layer
            </th>
            <Hint content="Has a *.test.* file beside it">
              <th
                scope="col"
                className="sticky top-0 z-10 bg-muted px-3 py-2 text-center font-medium"
              >
                Test
              </th>
            </Hint>
          </tr>
        </thead>
        <tbody>
          {sorted.map((module) => {
            const cut = module.id.lastIndexOf("/");
            return (
              <tr
                key={module.id}
                onClick={() => onSelect(module.id)}
                aria-selected={module.id === selectedId}
                className={cn(
                  "cursor-pointer border-t border-border transition-colors",
                  module.id === selectedId ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <td className="max-w-0 px-3 py-1.5">
                  {/* max-w-0 on the cell is what lets this truncate at all:
                      without a definite width to shrink against, the path forces
                      the table wider instead of clipping.

                      The *directory* is what truncates, not the whole path —
                      `truncate` on one string would eat the filename, which is
                      the part you are reading the column for. Flex does the work:
                      the leading span shrinks, the filename cannot. */}
                  <Hint content={module.id} className="font-mono">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-baseline font-mono text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {module.id.slice(0, cut + 1)}
                      </span>
                      <span className="shrink-0">{module.id.slice(cut + 1)}</span>
                    </button>
                  </Hint>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{module.code}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {module.importedBy.length}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {module.imports.length}
                </td>
                <td className="px-3 py-1.5">
                  <LayerBadge layer={module.layer} />
                </td>
                <td className="px-3 py-1.5 text-center">
                  {module.testFile ? (
                    <Check
                      aria-label="has a test"
                      className="mx-auto size-3.5 text-status-good"
                    />
                  ) : (
                    <span className="text-muted-foreground" aria-label="no test">
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
