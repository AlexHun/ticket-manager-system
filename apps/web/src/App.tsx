import { useEffect, useState } from "react";
import type { HealthResponse } from "@ticket/shared";

export function App() {
  const [status, setStatus] = useState<string>("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthResponse>)
      .then((d) => setStatus(d.status))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Ticket Manager</h1>
      <p>
        API status: <strong>{status}</strong>
      </p>
    </main>
  );
}
