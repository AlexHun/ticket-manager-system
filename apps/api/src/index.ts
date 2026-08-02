import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import type { HealthResponse } from "@ticket/shared";
import { toNodeHandler } from "better-auth/node";
import { prisma } from "./db";
import { auth, trustedOrigins } from "./auth";
import { usersRouter } from "./routes/users";
import { inboundEmailRouter } from "./routes/webhooks/inbound-email";

const app = express();

app.use(
  cors({
    origin: trustedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ status: "ok" });
});

app.use("/api/users", usersRouter);
app.use("/api/webhooks/inbound-email", inboundEmailRouter);

const port = Number(process.env.PORT ?? 3001);

async function start() {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Connected to Postgres");

  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
