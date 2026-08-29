// First import in the process, before Express, Prisma or pg-boss are pulled in:
// the SDK patches what it instruments at import time, so anything loaded ahead
// of it is instrumented not at all. No `SENTRY_DSN` means this is inert.
import { Sentry } from "./instrument";

import express from "express";
import type { Request, Response } from "express";
import type { Server } from "node:http";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import type { HealthResponse } from "@ticket/shared";
import { toNodeHandler } from "better-auth/node";
import { prisma } from "./db";
import { auth, trustedOrigins } from "./auth";
import { closeAll } from "./events/hub";
import { startJobs, stopJobs } from "./jobs";
import { activityRouter } from "./routes/activity";
import { aiRouter } from "./routes/ai";
import { automationRouter } from "./routes/automation";
import { dashboardLayoutRouter } from "./routes/dashboard-layout";
import { eventsRouter } from "./routes/events";
import { knowledgeRouter } from "./routes/knowledge";
import { newFeaturesRouter } from "./routes/new-features";
import { outboxRouter } from "./routes/outbox";
import { pipelineRouter } from "./routes/pipeline";
import { ticketsRouter } from "./routes/tickets";
import { tutorialsRouter } from "./routes/tutorials";
import { usersRouter } from "./routes/users";
import { inboundEmailRouter } from "./routes/webhooks/inbound-email";

const app = express();

// One proxy in front of this process: Railway's edge, which terminates TLS and
// forwards. Without this, `req.protocol` reads "http" behind a request the
// browser made over HTTPS and `req.ip` is the edge's address for every caller.
// The number is a hop count, not a boolean — `true` would trust an
// `X-Forwarded-For` chain a caller can extend at will.
app.set("trust proxy", 1);

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

// Above `compression()`, and that is the entire reason this line is here rather
// than beside the other routers below.
//
// `compression` would gzip `text/event-stream`: there is no mime-db entry for it,
// so it falls through to the `/^text\//` fallback and compresses, and the
// below-the-threshold escape never fires because a streamed response has no
// known length at `writeHead` time. Every `res.write` would then sit in a zlib
// buffer until it filled. **The stream would still work** — events arriving in
// clumps, minutes late — which is the worst version of this bug, because it
// reads as "SSE is unreliable" rather than as a middleware in the way.
//
// The route sets `Cache-Control: no-transform` as well, so a future re-order of
// this stack degrades to "correct" rather than to "mysteriously laggy". It needs
// no body parser: it is a `GET`. Same move, and the same kind of reason, as the
// inbound webhook sitting above `express.json` below.
app.use("/api/events", eventsRouter);

// Below the auth handler, which writes its own responses, and above everything
// that answers with JSON. The dashboard payload is the reason: it is one
// response carrying volume buckets, workload rows, top customers and the
// attention list, all of it repetitive keys and short strings, which is the
// shape gzip does best on.
app.use(compression());

// Above the app-wide JSON parser, and therefore not covered by it: the inbound
// webhook parses its own body behind its own auth check, with a limit sized for
// a mail provider rather than for an API client. See the note on the route.
app.use("/api/webhooks/inbound-email", inboundEmailRouter);

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ status: "ok" });
});

app.use("/api/tickets", ticketsRouter);
app.use("/api/users", usersRouter);
app.use("/api/ai", aiRouter);
// Mixed guards inside: both roles read/dismiss a page's tutorial, only an
// admin edits what it says — see the router's own comment.
app.use("/api/tutorials", tutorialsRouter);
// requireAuth throughout — no admin-only half, unlike the tutorial next to it,
// because there's no admin-editable content: just the code-level
// NEW_FEATURE_VERSIONS registry a developer bumps by hand.
app.use("/api/new-features", newFeaturesRouter);
// requireAuth throughout, same reasoning as the "new" badge above: a personal
// preference with no admin-editable half and no account-management audit
// trail — see the router's own comment.
app.use("/api/dashboard-layout", dashboardLayoutRouter);
// Admin-only on every route inside it, which is worth knowing here as well as
// there: this one edits the prompt of the feature that writes to customers
// unattended.
app.use("/api/knowledge-articles", knowledgeRouter);
// Admin-only throughout, like the one above it, and for two reasons rather than
// one: it reads back how the unattended pipeline is behaving, and — behind
// `PIPELINE_SIMULATOR_ENABLED` — it can post an email into it.
app.use("/api/pipeline", pipelineRouter);
// Admin-only as well: it decides where every ticket the assistant hands back
// lands, which is a staffing decision rather than something an agent picks.
app.use("/api/automation", automationRouter);

// Admin-only, and read-only. On a deployment with no mail provider this is how
// an invitation actually reaches somebody — see the note in routes/outbox.ts.
app.use("/api/outbox", outboxRouter);

// Admin-only, and read-only: a query-time merge of the trails above plus
// sent replies. Registered last among these because it reads across all of
// them rather than owning a domain of its own.
app.use("/api/activity", activityRouter);

// After every route, which is the only place it works: it is an Express error
// middleware, and it can only see what routes registered before it throw.
// Express 5 forwards rejected promises from `async` handlers here by itself, so
// this covers the `await` calls the codebase deliberately leaves untried.
Sentry.setupExpressErrorHandler(app);

const port = Number(process.env.PORT ?? 3001);

// Captured rather than discarded, so `shutdown` can stop taking connections
// before it starts ending the open ones. Only matters since `/api/events` — a
// process whose responses all complete in milliseconds has nothing to close.
let server: Server | undefined;

async function start() {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Connected to Postgres");

  // Before `listen`, so no request can enqueue onto a queue nobody is working
  // yet. A failure here takes the boot with it on purpose — see the note in
  // `jobs/boss.ts`: an API that is up but silently running no background work is
  // the hardest kind of broken to notice.
  await startJobs();

  server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);

  // Stop accepting, then end what is open. Both are needed and neither replaces
  // the other: `close()` waits for in-flight responses, and an event stream is
  // in-flight forever by definition, so on its own it would simply hang.
  server?.close();

  // Before `stopJobs`, which waits up to 30s for a graceful pg-boss stop. A slow
  // job must not hold every open tab's stream for half a minute — the browser
  // reconnects on its own, and the sooner it is told to, the sooner it lands on
  // whatever process replaces this one.
  closeAll();

  // Before the Prisma disconnect: a job finishing gracefully still needs the
  // database to write its result. Work that does not finish in time is not
  // lost — it returns to the queue for whatever starts next.
  await stopJobs();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch(async (err) => {
  console.error("Failed to start API:", err);
  // Flushed rather than fired: `process.exit` does not wait for an in-flight
  // HTTP request, and the report of a process that failed to boot is exactly
  // the one that has no second chance to arrive. Two seconds, then leave
  // regardless — a hung Sentry must not turn a failed boot into a hung one.
  Sentry.captureException(err, { tags: { phase: "startup" } });
  await Sentry.flush(2000);
  process.exit(1);
});
