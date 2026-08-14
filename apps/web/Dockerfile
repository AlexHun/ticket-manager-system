# The web service: build the SPA with Bun, serve the result with Caddy.
#
# Build context is the **repository root** (see the note in apps/api/Dockerfile);
# Railway is pointed at this file by `dockerfilePath` in apps/web/railway.json.

FROM oven/bun:1-slim AS build

WORKDIR /app

# Manifests first for layer caching. The API's manifest is here for the same
# reason the web one is in the API image: `--frozen-lockfile` resolves the whole
# workspace graph.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile

COPY packages packages
COPY apps/web apps/web

# --- Build-time configuration -----------------------------------------------
# Everything Vite bakes into the bundle. `ARG` is what opts a Railway service
# variable into the build; without these lines the variables exist at runtime
# and are invisible here, which for a static bundle means invisible forever.
#
# VITE_API_URL is the one that must be right. It becomes the axios baseURL *and*
# the `connect-src` entry of the CSP, so a wrong value produces a page that
# looks fine and cannot talk to anything. There is no runtime override: changing
# it means rebuilding this service, not just redeploying it.
ARG VITE_API_URL=""
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=""
ARG VITE_SENTRY_ENVIRONMENT=""
# `.git` is excluded from the build context, so releaseName() in vite.config.ts
# cannot ask git for the commit and falls back to `web@0.0.0`. Pass Railway's
# RAILWAY_GIT_COMMIT_SHA through this to get identifiable releases in Sentry.
ARG VITE_SENTRY_RELEASE=""

ENV VITE_API_URL=$VITE_API_URL \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE

# `tsc -b && vite build`. Emits `dist/` and, from cspCaddyPlugin, `csp.caddy`.
RUN cd apps/web && bun run build

# --- Runtime ----------------------------------------------------------------
# Nothing from the build stage travels except the two artefacts below: no Bun,
# no node_modules, no source.
FROM caddy:2-alpine

WORKDIR /app

COPY apps/web/Caddyfile ./Caddyfile
COPY --from=build /app/apps/web/dist ./dist
# The generated Content-Security-Policy header field, imported by the Caddyfile.
# It is produced by the build immediately above, so it always describes the
# bundle sitting next to it.
COPY --from=build /app/apps/web/csp.caddy ./csp.caddy

# Fails the build on a malformed Caddyfile — including a broken `import
# csp.caddy` — instead of on the first request after a deploy.
RUN caddy fmt Caddyfile --overwrite \
    && caddy validate --config Caddyfile --adapter caddyfile

CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]
