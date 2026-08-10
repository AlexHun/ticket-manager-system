import express from "express";
import type { Request, Response } from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import type { HealthResponse } from "@ticket/shared";
import { toNodeHandler } from "better-auth/node";
import { prisma } from "./db";
import { auth, trustedOrigins } from "./auth";
import { aiRouter } from "./routes/ai";
import { ticketsRouter } from "./routes/tickets";
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

/**
 * Security headers on everything this process answers with — above the Better
 * Auth handler, which writes its own responses and would otherwise escape them.
 *
 * The CSP here is the strictest one there is because this server only ever
 * returns JSON: nothing it sends should be permitted to run a script, pull in a
 * frame or load an image. It is *not* the policy that protects the app's UI —
 * that one ships with the page and is built in `apps/web/vite.config.ts`. This
 * one covers the case where a browser is talked into treating an API response
 * as a document anyway (a response opened directly in a tab, a stray content
 * type, an error page rendered by something upstream); with `default-src
 * 'none'` there is nothing for injected markup to execute.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // Helmet defaults this to SAMEORIGIN, which contradicts the
    // `frame-ancestors 'none'` above. Modern browsers read the CSP and ignore
    // this header, so the disagreement only surfaces on a browser old enough to
    // support neither — the one case where the weaker rule would win.
    xFrameOptions: { action: "deny" },
    // CORS decides who may read these responses, and the allowed origins are
    // already pinned in `trustedOrigins`. Helmet's `same-origin` default is a
    // rule about a different threat (a cross-origin page loading this as a
    // subresource) and states the wrong thing about a server whose whole job is
    // to be called from another origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

// Below the auth handler, which writes its own responses, and above everything
// that answers with JSON. The dashboard payload is the reason: it is one
// response carrying volume buckets, workload rows, top customers and the
// attention list, all of it repetitive keys and short strings, which is the
// shape gzip does best on.
app.use(compression());

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ status: "ok" });
});

app.use("/api/tickets", ticketsRouter);
app.use("/api/users", usersRouter);
app.use("/api/ai", aiRouter);
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
