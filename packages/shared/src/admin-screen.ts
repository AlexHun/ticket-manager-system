/**
 * The admin screens, by name. A key of its own rather than a route path or a
 * tutorial page key, because neither covers them all: paths live in the web
 * app, and the tutorial editor has no tutorial of its own.
 */
export const ADMIN_SCREEN = {
  users: "users",
  knowledge: "knowledge",
  outbox: "outbox",
  pipeline: "pipeline",
  evals: "evals",
  activity: "activity",
  tutorials: "tutorials",
} as const;

export type AdminScreen = (typeof ADMIN_SCREEN)[keyof typeof ADMIN_SCREEN];
