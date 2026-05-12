import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: ["admin", "agent"] },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
