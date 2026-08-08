import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LAYER_VISUAL } from "./layer-visuals";
import type { Layer } from "./protocol";

/**
 * A layer, named and coloured.
 *
 * The dot carries the hue and the word carries the meaning — which is the rule
 * the whole page follows, and the reason eight categorical colours are legal
 * here. Never render the swatch without the label.
 *
 * The label is the badge's own text rather than the layer colour so it keeps
 * foreground contrast; `outline` is the only badge variant that leaves the text
 * token alone.
 */
export function LayerBadge({
  layer,
  className,
}: {
  layer: Layer;
  className?: string;
}) {
  const visual = LAYER_VISUAL[layer];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: visual.color }}
      />
      {visual.label}
    </Badge>
  );
}
