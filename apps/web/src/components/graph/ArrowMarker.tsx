/**
 * The arrowhead every connection on a How it works drawing ends in. Rendered
 * inside the drawing's `<defs>`; a line points at it with
 * `markerEnd={`url(#${id})`}`.
 */
export function ArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="10"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
      </marker>
    </defs>
  );
}
