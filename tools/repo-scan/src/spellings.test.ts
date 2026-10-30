import { describe, expect, test } from "bun:test";
import { inEveryQuote, key, literal } from "./spellings.ts";

describe("literal", () => {
  const ROLE = new RegExp(literal("admin", "agent"));

  test("matches each value whole, in every quote", () => {
    for (const line of [`"admin"`, `'agent'`, "`admin`"]) {
      expect(ROLE.test(line)).toBe(true);
    }
  });

  test("passes a value that only contains one, and an unquoted word", () => {
    expect(ROLE.test(`"administrator"`)).toBe(false);
    expect(ROLE.test(`USER_ROLE.admin`)).toBe(false);
  });

  test("escapes a value's regex characters", () => {
    expect(new RegExp(literal("a.b")).test(`"axb"`)).toBe(false);
  });
});

describe("key", () => {
  const ROLE_KEY = new RegExp(`${key("role")}\\s*1`);

  test("matches a bare, a quoted and an optional key", () => {
    for (const line of [
      "role: 1",
      `"role": 1`,
      "'role': 1",
      "`role`: 1",
      "role?: 1",
      `"role"?: 1`,
    ]) {
      expect(ROLE_KEY.test(line)).toBe(true);
    }
  });

  test("passes a key that only ends in the name", () => {
    expect(ROLE_KEY.test("userRole: 1")).toBe(false);
    expect(ROLE_KEY.test("$role: 1")).toBe(false);
  });
});

describe("inEveryQuote", () => {
  test("returns the line as typed, then in single quotes and in backticks", () => {
    expect(inEveryQuote(`f("a", "b");`)).toEqual([
      `f("a", "b");`,
      `f('a', 'b');`,
      "f(`a`, `b`);",
    ]);
  });

  test("returns a line with no double-quoted literal alone", () => {
    expect(inEveryQuote("f(USER_ROLE.admin);")).toEqual([
      "f(USER_ROLE.admin);",
    ]);
  });

  test("leaves out a spelling that would need escaping", () => {
    expect(inEveryQuote(`f("it's");`)).toEqual([`f("it's");`, "f(`it's`);"]);
    expect(inEveryQuote('f("${x}");')).toEqual(['f("${x}");', "f('${x}');"]);
  });

  test("keeps an escaped double quote inside its literal", () => {
    expect(inEveryQuote(String.raw`f("a\"b");`)[1]).toBe(
      String.raw`f('a\"b');`,
    );
  });
});
