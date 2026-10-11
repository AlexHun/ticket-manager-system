# Design standards (type, colour, layout, icons)

How a screen in `apps/web` looks. The audit items below came from the taste-skill redesign audit (Leonxlnx/taste-skill, 2026-10-11). We kept the items that guard a dense, dark, internal tool against generic AI-made UI, and dropped the ones written for marketing pages: hero sections, testimonials, grain overlays, scroll-driven effects. **They are adopted, not measured.** Where one conflicts with a measured rule in [frontend.md](frontend.md), frontend.md wins. States, motion and markup are in [design-states.md](design-states.md). Words are in [copy.md](copy.md).

**The system already exists. Extend it; don't restyle it.** Fonts, colours and radius are tokens in `apps/web/src/index.css`, and its comments give the reason for each one. A screen uses those tokens. A new font, accent, hex value or shadow style is a design decision: ask before adding it, as you would before inventing a control.

## Type

- **Three faces behind four tokens. Each token stays in its job.**
  - `--font-sans` (Geist) is for every word the system writes.
  - `--font-display` (Source Serif 4) is for the customer's subject line only.
  - `--font-brand` (Big Shoulders Display) is for the lockup and the page titles `PageHeader` draws.
  - `--font-heading` is the sans, used for card titles, dialogs and section headings.
  - Using the serif or the brand face anywhere else spends a distinction the app relies on.
- **Figures that line up in a column use `tabular-nums`.** That covers counts, durations, token totals and table cells, and most tables already do it. Proportional digits make a column of numbers jitter.
- **Hierarchy comes from weight and size, not from capitals.** Use Medium (500) and SemiBold (600) between Regular and Bold. Headings are sentence case (copy.md). Reserve all-caps for tiny labels with positive tracking, and never use it on a whole subheading row.
- **Prose is capped at about 65 characters per line**, for example in the How it works page, the welcome page, empty states and dialog bodies. A paragraph that runs the full width of a 1440px table view is unreadable.
- **Keep a short heading's last word off a line of its own.** `text-balance` on headings and `text-pretty` on short prose stop a single word wrapping alone. Neither is used anywhere yet, so treat this as an improvement, not a defect to sweep.

## Colour and surfaces

- **One theme, dark.** `:root` sets it, and sonner is pinned to it ([frontend.md](frontend.md)). A section with a light background in the middle of a dark screen looks like a paste accident. Use a step of the same palette instead (`--card`, `--muted`, `--accent`).
- **One accent family.** `--primary`, `--ring` and the chart scale are a single cool hue. Three other families each carry a meaning:
  - `--ember-*` means elapsed silence on a ticket.
  - `--status-*` means good, warning or critical.
  - `--ai-shine` marks machine-written work (see `AiShine`).
  - A colour used for decoration dilutes all four meanings. So the purple-to-blue "AI gradient" and a second accent "for variety" are both defects.
- **Colours come from tokens, never literals.** A hex or `oklch()` value in a component, or a pure `black`/`white` fill, bypasses the theme. The known exceptions:
  - `bg-black/10` on the shadcn dialog and sheet overlays.
  - The `#000` mask layers in `index.css`, which are masks, not paint.
- **Elevation means something.** A shadcn `Card` is `bg-card` with a `ring-1` and no shadow. Add a shadow, a heavier border or another nested card only to show what is above what, not to decorate. A card inside a card inside a card is the commonest generic layout.
- **Keep one light direction.** A shadow points down. A highlight is on the top edge, if anywhere.

## Layout and spacing

- **Spacing comes from Tailwind's scale.** Arbitrary values like `p-[13px]` or `mt-[7px]` drift. One appears only where a measured layout needs it, as `TicketsTable`'s column widths do.
- **Things side by side line up.** In a row of cards or panels, the titles, figures and actions sit on shared lines. An action in a card is pinned to its bottom, so card actions form one row however long the content above is.
- **Radius steps down inward.** A container takes `--radius`, and an element inside it is tighter, so the two corners nest. Matching radii on nested boxes look pasted together.
- **Wide screens get a cap, not a stretch.** Tables may use the full width, since that's where columns go. A form, prose or a settings page sits in a max-width column.
- **Dense is right here.** The taste-skill advice to "double the whitespace" is for marketing pages. This is a desk that agents scan all day. Spacing should separate groups, not pad rows.
- **Use grid for two dimensions, flex for one.** Avoid percentage-width flex arithmetic for columns.
- **Avoid arbitrary `z-[…]` values.** There are none in `src/` today. Layers come from the shadcn primitives (`z-50` overlays). A new stacking need goes through them, not a bigger number.

## Icons

- **lucide-react, at one stroke width** ([frontend.md](frontend.md)). The taste-skill advice to replace Lucide doesn't apply: shadcn/ui is built on it, and a second icon set would put two stroke styles on one screen.
- **An icon names the action, not a metaphor for it.** Don't use a rocket for "launch", a shield for "security" or sparkles on every AI control. `AiShine` already marks machine-written work.
- **An icon-only button has an `aria-label`.** Its wording follows copy.md.
