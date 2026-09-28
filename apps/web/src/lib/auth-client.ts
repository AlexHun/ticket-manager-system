import { createAuthClient } from "better-auth/react";
import {
  anonymousClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { USER_ROLE } from "@ticket/shared";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: [USER_ROLE.admin, USER_ROLE.agent] },
      },
    }),
    // `signIn.anonymous()` — "Use demo session" on the login page (#319). The
    // server refuses it unless demo mode is on; see `apps/api/src/auth.ts`.
    anonymousClient(),
  ],
});

export const { signIn, signOut, useSession } = authClient;
