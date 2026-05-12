import { NavBar } from "@/components/NavBar";

export function UsersPage() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
      </main>
    </div>
  );
}
