import { PageHeader } from "@/components/layout/PageHeader";
import { ArchitectureView } from "@/components/graph/ArchitectureView";
import { LifecycleView } from "@/components/graph/LifecycleView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOW_IT_WORKS_LABEL } from "@/lib/how-it-works/dom";

/**
 * How it works: what the system is built from, and what happens to a ticket.
 * The same for every signed-in user, and it reads no ticket data — it renders
 * in full against an empty database (R12).
 *
 * Loaded on its own through `lazy` in `App.tsx`, which is what keeps d3 out of
 * the entry chunk.
 */
export function HowItWorksPage() {
  return (
    // Scrolls inside the shell's frame, as every page root does (`AppShell`):
    // below 2xl the panel sits under the drawing, and without its own scroller
    // the panel, and the screen link in it, were past the bottom of the window
    // with nothing able to scroll to them.
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title="How it works"
        description="What the desk is built from, how its parts talk to each other, and what happens to a ticket from the email that opens it to the agent who closes it."
      />
      <Tabs defaultValue="architecture">
        <TabsList>
          <TabsTrigger value="architecture">
            {HOW_IT_WORKS_LABEL.architectureTab}
          </TabsTrigger>
          <TabsTrigger value="lifecycle">
            {HOW_IT_WORKS_LABEL.lifecycleTab}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="architecture">
          <ArchitectureView />
        </TabsContent>
        <TabsContent value="lifecycle">
          <LifecycleView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
