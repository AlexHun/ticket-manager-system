/**
 * A thread of light running right to left around its parent's border, for as
 * long as a model is working on that thing.
 *
 * Drop it inside any element that is `relative` and has a radius; the ring
 * inherits the radius and traces the edge, so the same component fits a card and
 * a 28px button without either one knowing about the other. Nothing is rendered
 * at all when `active` is false — this is a busy indicator, not a decoration
 * that happens to be switched off.
 *
 * The parent needs `relative`. It does **not** need `overflow-hidden`: the ring
 * clips its own light, which is what lets it sit on a Button, where clipping the
 * whole element would cut the focus outline.
 *
 * `aria-hidden` throughout. This says the same thing as the "Summarising…" label
 * beside it, and a screen reader does not need it twice.
 */
export function AiShine({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <span aria-hidden="true" className="ai-shine-ring">
      {/* Half the width of what it travels across; `ai-shine-beam` is the
          gradient painted across it, and the reason that lives in `index.css`
          rather than as Tailwind colour classes here is written beside it.
          `w-1/2` and the keyframe's 200% → -100% travel are a pair: change one
          without the other and the beam either idles off-screen or starts
          mid-edge. */}
      <span className="ai-shine-beam absolute inset-y-0 left-0 w-1/2 animate-ai-shine" />
    </span>
  );
}
