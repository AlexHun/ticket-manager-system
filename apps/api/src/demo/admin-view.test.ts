import { describe, expect, test } from "bun:test";
import { USER_ROLE } from "@ticket/shared";
import { mayUseAdminView, seesAdminScreens } from "./admin-view";

const admin = { role: USER_ROLE.admin, isAnonymous: false };
const agent = { role: USER_ROLE.agent, isAnonymous: false };
// What the anonymous plugin mints: the admin plugin's `defaultRole`, never
// `admin` (ADR-0022).
const demo = { role: USER_ROLE.agent, isAnonymous: true };

describe("seesAdminScreens", () => {
  test("an admin and a demo visitor see them; an agent does not", () => {
    expect(seesAdminScreens(admin)).toBe(true);
    expect(seesAdminScreens(demo)).toBe(true);
    expect(seesAdminScreens(agent)).toBe(false);
  });

  // Rows created before the plugin was loaded read `null`, not `false`.
  test("a null isAnonymous is not a demo", () => {
    expect(seesAdminScreens({ role: USER_ROLE.agent, isAnonymous: null })).toBe(
      false,
    );
  });
});

describe("mayUseAdminView", () => {
  test.each(["GET", "HEAD"])("a demo visitor may %s", (method) => {
    expect(mayUseAdminView(demo, method)).toBe(true);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])(
    "a demo visitor may not %s, even where the guard is misapplied",
    (method) => {
      expect(mayUseAdminView(demo, method)).toBe(false);
    },
  );

  test.each(["GET", "POST", "PATCH", "DELETE"])("an admin may %s", (method) => {
    expect(mayUseAdminView(admin, method)).toBe(true);
  });

  test.each(["GET", "POST"])("an agent may not %s", (method) => {
    expect(mayUseAdminView(agent, method)).toBe(false);
  });
});
