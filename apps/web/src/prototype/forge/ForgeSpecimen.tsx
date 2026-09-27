/**
 * PROTOTYPE — /__dev/forge. Every candidate side by side, so the choice is made
 * by comparison rather than by memory of the last variant flipped past.
 *
 * Sections 1 and 2 render in whatever palette the bar has on <html>; section 3
 * shows all four palettes at once, each scoped to its own wrapper.
 */
import type { ReactNode } from "react";
import { Inbox, LayoutDashboard, BookOpen } from "lucide-react";
import {
  TICKET_CATEGORY,
  TICKET_STATUS,
  type TicketStatus,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, CategoryBadge } from "@/components/TicketBadges";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { cn } from "@/lib/utils";
import { TicketMark } from "@/components/layout/Logo";
import { ForgeMark } from "./ForgeMarks";
import {
  FORGE_AXES,
  optionsOf,
  useForge,
  type ForgeChoice,
} from "./forge-proto";

const SIZES = [16, 24, 32, 128] as const;

function SizedMark({
  variant,
  size,
}: {
  variant: ForgeChoice["logo"];
  size: number;
}) {
  return (
    <span
      className="inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      {variant === "current" ? (
        <TicketMark className="size-full" />
      ) : (
        <ForgeMark variant={variant} className="size-full" />
      )}
    </span>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}

function MarkRow({ variant }: { variant: ForgeChoice["logo"] }) {
  return (
    <div className="grid grid-cols-[10rem_1fr_1fr_16rem] items-center gap-4 rounded-lg border p-3">
      <div className="text-sm">
        <div className="font-medium">
          {variant === "current" ? "Current" : variant}
        </div>
        <div className="text-muted-foreground">{FORGE_AXES.logo[variant]}</div>
      </div>
      {/* On the page background */}
      <div className="flex items-end gap-4">
        {SIZES.map((size) => (
          <SizedMark key={size} variant={variant} size={size} />
        ))}
      </div>
      {/* On the sidebar surface */}
      <div className="flex items-end gap-4 rounded-md bg-sidebar p-3">
        {SIZES.slice(0, 3).map((size) => (
          <SizedMark key={size} variant={variant} size={size} />
        ))}
        <span className="ml-2 flex items-center gap-2 text-sm">
          <SizedMark variant={variant} size={16} />
          <span className="forge-wordmark font-semibold">Forge Desk</span>
        </span>
      </div>
      {/* A browser tab, light and dark chrome */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-t-md bg-[#dee1e6] px-3 py-1.5 text-xs text-[#1f1f1f]">
          <SizedMark variant={variant} size={16} />
          Tickets · Forge Desk
        </div>
        <div className="flex items-center gap-2 rounded-t-md bg-[#35363a] px-3 py-1.5 text-xs text-[#e8eaed]">
          <SizedMark variant={variant} size={16} />
          Tickets · Forge Desk
        </div>
      </div>
    </div>
  );
}

function FontRow({ font }: { font: ForgeChoice["font"] }) {
  const { logo } = useForge();
  return (
    <div
      data-forge-font={font}
      className="grid grid-cols-[10rem_1fr_1fr] items-center gap-6 rounded-lg border p-4"
    >
      <div className="text-sm">
        <div className="font-medium">
          {font === "current" ? "Current" : font}
        </div>
        <div className="text-muted-foreground">{FORGE_AXES.font[font]}</div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <SizedMark variant={logo} size={32} />
          <span className="forge-wordmark text-lg font-semibold tracking-tight">
            The Great Forge Desk
          </span>
        </div>
        <div className="flex w-56 items-center gap-2 rounded-md bg-sidebar px-2 py-1.5 text-sm">
          <SizedMark variant={logo} size={16} />
          <span className="forge-wordmark font-semibold">Forge Desk</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="forge-title text-2xl font-semibold tracking-tight">
          Tickets
        </h3>
        <h3 className="forge-title text-2xl font-semibold tracking-tight">
          Knowledge base
        </h3>
        <p className="font-display text-[15px]">
          Re: invoice #4471 was charged twice
          <span className="ml-2 font-sans text-xs text-muted-foreground">
            (customer subject — stays Source Serif)
          </span>
        </p>
      </div>
    </div>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const ROWS: {
  subject: string;
  status: TicketStatus;
  category: (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];
  quiet: number;
}[] = [
  {
    subject: "Charged twice for March",
    status: TICKET_STATUS.New,
    category: TICKET_CATEGORY.Refund,
    quiet: 9 * DAY,
  },
  {
    subject: "SSO login loops back to start",
    status: TICKET_STATUS.Open,
    category: TICKET_CATEGORY.Technical,
    quiet: 4 * DAY,
  },
  {
    subject: "Where do I change my address?",
    status: TICKET_STATUS.Open,
    category: TICKET_CATEGORY.General,
    quiet: 1.5 * DAY,
  },
  {
    subject: "Export to CSV is empty",
    status: TICKET_STATUS.New,
    category: TICKET_CATEGORY.Technical,
    quiet: 2 * 60 * 60 * 1000,
  },
  {
    subject: "Drafting a reply…",
    status: TICKET_STATUS.Processing,
    category: TICKET_CATEGORY.Other,
    quiet: 0,
  },
  {
    subject: "Thanks, all sorted",
    status: TICKET_STATUS.Resolved,
    category: TICKET_CATEGORY.General,
    quiet: 0,
  },
  {
    subject: "Old duplicate",
    status: TICKET_STATUS.Closed,
    category: TICKET_CATEGORY.Other,
    quiet: 0,
  },
];

function silenceClass(row: (typeof ROWS)[number]) {
  if (row.status !== TICKET_STATUS.New && row.status !== TICKET_STATUS.Open)
    return null;
  if (row.quiet >= 7 * DAY) return "bg-ember-3";
  if (row.quiet >= 3 * DAY) return "bg-ember-2";
  if (row.quiet >= 1 * DAY) return "bg-ember-1";
  return null;
}

const SWATCHES = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["primary", "bg-primary"],
  ["bronze", "bg-[var(--forge-bronze)]"],
  ["calm", "bg-calm"],
  ["ember-1", "bg-ember-1"],
  ["ember-2", "bg-ember-2"],
  ["ember-3", "bg-ember-3"],
  ["processing", "bg-viz-processing"],
] as const;

function PalettePanel({ palette }: { palette: ForgeChoice["palette"] }) {
  const { logo } = useForge();
  return (
    <div
      data-forge-palette={palette}
      className="flex flex-col gap-3 rounded-xl border bg-background p-3 text-foreground"
    >
      <div className="text-sm">
        <span className="font-medium">
          {palette === "current" ? "Current" : palette}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · {FORGE_AXES.palette[palette]}
        </span>
      </div>

      <div className="flex gap-3">
        {/* Mini sidebar */}
        <div
          data-slot="sidebar-container"
          className="flex w-36 shrink-0 flex-col gap-1 rounded-md border bg-sidebar p-2 text-sm text-sidebar-foreground"
        >
          <div className="mb-1 flex items-center gap-2 px-1.5 py-1">
            <SizedMark variant={logo} size={16} />
            <span className="forge-wordmark truncate font-semibold">
              Forge Desk
            </span>
          </div>
          {[
            [LayoutDashboard, "Dashboard", false],
            [Inbox, "Tickets", true],
            [BookOpen, "Knowledge", false],
          ].map(([Icon, label, active]) => {
            const I = Icon as typeof Inbox;
            return (
              <div
                key={label as string}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1.5 py-1",
                  active && "bg-sidebar-accent font-medium",
                )}
              >
                <I className="size-4" />
                {label as string}
              </div>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 className="forge-title text-2xl font-semibold tracking-tight">
              Tickets
            </h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline">
                Assign
              </Button>
              <Button size="sm">Send reply</Button>
            </div>
          </div>
          <Card size="sm" className="py-0">
            <CardContent className="px-0">
              {ROWS.map((row) => {
                const silence = silenceClass(row);
                return (
                  <div
                    key={row.subject}
                    className="relative flex items-center gap-2 border-t border-border px-3 py-2 text-sm first:border-t-0"
                  >
                    {silence && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-y-px left-0 w-[3px] rounded-r-sm",
                          silence,
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-display">
                      {row.subject}
                    </span>
                    <CategoryBadge category={row.category} />
                    <StatusBadge status={row.status} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            <StatusPill status="good" label="On target" />
            <StatusPill status="warning" label="Slipping" />
            <StatusPill status="critical" label="Breached" />
            <Button size="sm" variant="link" className="h-auto p-0">
              A link
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map(([name, cls]) => (
          <div
            key={name}
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span
              className={cn("size-4 rounded-sm ring-1 ring-white/10", cls)}
            />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ForgeSpecimen() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[110rem] flex-col gap-10 p-6 pb-24">
        <div>
          <h1 className="text-lg font-semibold">
            The Great Forge Desk — prototype
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Pick one of each: a mark, a wordmark face, a palette. Sections 1–2
            follow the palette on the bar below; section 3 shows every palette
            at once. The real app follows the bar too — open any page and flip
            with ← / →.
          </p>
        </div>

        <Section
          title="1 · Mark"
          note="16 / 24 / 32 / 128px on the page, on the sidebar, and in a browser tab (light and dark chrome). The real tab icon follows the bar."
        >
          {optionsOf("logo").map((variant) => (
            <MarkRow key={variant} variant={variant} />
          ))}
        </Section>

        <Section
          title="2 · Wordmark and page titles"
          note="Login wordmark, sidebar wordmark, and page titles. Customer subjects keep Source Serif in every option."
        >
          {optionsOf("font").map((font) => (
            <FontRow key={font} font={font} />
          ))}
        </Section>

        <Section
          title="3 · Palette"
          note="Temper-blue action, bronze decoration, verdigris settled — ember untouched in all of them. Eyeballed, not measured yet."
        >
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {optionsOf("palette").map((palette) => (
              <PalettePanel key={palette} palette={palette} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
