/// <reference types="vite/client" />

/**
 * `vite/client` types every `VITE_*` key as `any` through an index signature, so
 * these are declared for the sake of the three that decide where an error lands
 * in Sentry — a typo in any of them fails silently, in the tool whose whole job
 * is to not fail silently.
 *
 * `VITE_SENTRY_RELEASE` is not one you set: `vite.config.ts` fills it in from git
 * unless something already has.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
