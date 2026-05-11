import express from "express";
import type { Request, Response } from "express";
import type { HealthResponse } from "@ticket/shared";

const app = express();

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
