# The API service. Build context is the **repository root**, not this
# directory — `@ticket/core` and `@ticket/shared` are workspace dependencies and
# a context scoped to `apps/api` could not see them. Railway is told where this
# file lives via `dockerfilePath` in `apps/api/railway.json`; leave the service's
# Root Directory unset so the context stays at the root.
#
# A Dockerfile rather than Railway's automatic builder because Railpack does not
# detect Bun projects — a Bun app on Railway has to bring its own image.

FROM oven/bun:1-slim

# Prisma's schema engine — which `prisma migrate deploy` runs as the pre-deploy
# command — is a native binary that needs OpenSSL. It is absent from the slim
# image, and its absence shows up as a migration failure at deploy time rather
# than as a build failure here, which is the worse place to find out.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, so the dependency layer is only rebuilt when a package.json
# or the lockfile changes rather than on every source edit. Every workspace's
# manifest has to be here — including the web app's, which this image otherwise
# has no use for — because `bun install --frozen-lockfile` resolves the whole
# workspace graph and fails if one is missing.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/

# devDependencies are installed on purpose: the Prisma CLI is one, and it is
# needed twice — for `prisma generate` below and for `prisma migrate deploy` as
# the pre-deploy command on every release.
RUN bun install --frozen-lockfile

# Every workspace's tsconfig extends this one, and it lives at the root rather
# than inside any of them. `prisma generate` is what finds out: `prisma.config.ts`
# is TypeScript, so loading it resolves `apps/api/tsconfig.json` and its
# `extends` chain, and a missing base file fails the build here with
# "File '../../tsconfig.base.json' not found" — nothing to do with Prisma.
COPY tsconfig.base.json ./

COPY packages packages
COPY apps/api apps/api

WORKDIR /app/apps/api

# The generated client is gitignored and platform-specific, so it is built here
# rather than copied. `prisma generate` does not connect to anything, but
# `prisma.config.ts` resolves `env("DATABASE_URL")` while loading, so it needs
# *a* value — this placeholder is never used to open a connection and never
# reaches the running process, which gets the real one from Railway.
#
# `--bun` is not optional. Plain `bunx` honours the CLI's `#!/usr/bin/env node`
# shebang, and there is no Node in this image; `--bun` runs it on Bun instead.
# Measured rather than assumed: under `--bun` the Prisma CLI reports Bun's
# `process.version`, and both `generate` and `migrate deploy` work from there.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    bunx --bun prisma generate

# Not a Railway service variable: this decides whether Better Auth marks the
# session cookie `Secure`, whether Prisma logs warnings, and whether the rate
# limiter is enabled at all. Those must not depend on someone remembering to
# set a variable in a dashboard.
ENV NODE_ENV=production

# Documentation only — Railway routes to whatever the process binds, and
# `src/index.ts` reads PORT. Kept in step with the default in that file.
EXPOSE 3001

CMD ["bun", "run", "start"]
