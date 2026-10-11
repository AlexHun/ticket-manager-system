# Design standards (states, motion and markup)

What a screen in `apps/web` does while you use it: interaction states, loading, empty and error screens, motion, and the markup underneath. Adopted from the same taste-skill audit as [design.md](design.md), on the same terms: not measured, and [frontend.md](frontend.md) wins where they conflict. The wording of every state is [copy.md](copy.md)'s.

## Interaction states

- **Every control has hover, pressed, focus and disabled states, and the shadcn primitive already draws them.** A hand-styled clickable element (`div` with `onClick`, a restyled `<button>`) has to supply all four itself. Usually that means it should have been a shadcn `Button` or `Toggle`.
- **The focus ring stays visible.** `outline-ring/50` is the base style and the primitives add `focus-visible:` rings. Never remove an outline without replacing it. A keyboard user has nothing else to go on (see `TableFrame` in frontend.md for the measured case).
- **The current page is marked in the navigation.** The sidebar's active item is how a person knows where they are (`isNavItemActive` in `AppSidebar.tsx`). A new route must make it match.
- **No dead controls.** A button that does nothing yet is left out or rendered `disabled`, with a tooltip saying why.

## Loading, empty and error

These are the three states a generated screen most often forgets. A page that fetches has all three.

- **Loading matches the shape of what's coming.** A list or card waiting for its first data shows `Skeleton` rows in the layout it will fill (`apps/web/src/components/ui/skeleton.tsx`, used across `src/`). A pending action shows `Loader2` with `animate-spin` on the button that started it (frontend.md). A route that prefetches mounts with data, so it shows neither (`prefetchLoader`, frontend.md).
- **Empty says what will fill it**, in words (copy.md). A table with no rows keeps its frame and headers, so the page doesn't jump when the first row arrives. An empty state caused by a filter appears below the filter bar, never in place of it, so the filter can still be cleared.
- **An error appears where the failure happened.** A form error sits beside its field or above the submit button. A failed load replaces the content it was loading, with a retry. A failed mutation shows inline _and_ as a toast (frontend.md). Never `window.alert()`.
- **Every screen has a way back.** A detail page links to its list. A record that isn't found says so and links back to its list rather than leaving a blank page.

## Motion

- **Motion explains a change; it doesn't decorate.** It's for opening and closing a layer, revealing the content of a row or panel, and confirming an action. Nothing animates on page load just to arrive, and nothing animates on scroll.
- **Use the primitives' timings.** shadcn overlays animate through `tw-animate-css` (the dialog and sheet overlays at `duration-100`). A custom transition stays short, around 100–200ms, and animates `opacity` and `transform`, never `width`, `height`, `top` or `left`.
- **Reduced motion is one global switch.** It's the `prefers-reduced-motion` block in `apps/web/src/index.css`. A component doesn't need its own `motion-reduce:` variant, and must not undo the switch with an `!important` duration of its own.
- **No animation library.** GSAP, Framer Motion and smooth-scroll libraries are new dependencies ([conventions.md](conventions.md)), and nothing on this desk needs them.

## Markup

- **Use landmarks and semantic elements.** Use `<main>`, `<nav>`, `<section>` with a heading, a real `<table>` for tabular data, and `<button>` for an action. A `div` with a click handler is missing keyboard support and a role.
- **A meaningful image has `alt` text.** A decorative image gets `alt=""` and `aria-hidden`.
- **Styling goes through Tailwind classes and tokens.** An inline `style` only carries a value computed at runtime, such as a measured width or a chart colour, not a fixed look.
