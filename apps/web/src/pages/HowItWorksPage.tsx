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
    <div>
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
