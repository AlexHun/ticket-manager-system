import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { USER_ROLE } from "@ticket/shared";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: [USER_ROLE.admin, USER_ROLE.agent] },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
