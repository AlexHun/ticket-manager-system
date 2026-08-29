import { describe, expect, test } from "bun:test";
import { diffToEntries } from "./activity-diff";

type Fields = {
  status: string;
  category: string | null;
  assignee: string | null;
};

describe("diffToEntries", () => {
  test("returns nothing when no field changed", () => {
    const before: Fields = { status: "Open", category: "Billing", assignee: "Alex" };
    const after: Fields = { ...before };

    expect(
      diffToEntries(before, after, [
        { field: "status", action: "status_changed" },
        { field: "category", action: "category_changed" },
        { field: "assignee", action: "assignee_changed" },
      ]),
    ).toEqual([]);
  });

  test("emits one entry per changed field, in field-map order, skipping unchanged ones", () => {
    const before: Fields = { status: "New", category: null, assignee: null };
    const after: Fields = { status: "Open", category: "Billing", assignee: null };

    expect(
      diffToEntries(before, after, [
        { field: "status", action: "status_changed" },
        { field: "category", action: "category_changed" },
        { field: "assignee", action: "assignee_changed" },
      ]),
    ).toEqual([
      { action: "status_changed", fromValue: "New", toValue: "Open" },
      { action: "category_changed", fromValue: null, toValue: "Billing" },
    ]);
  });

  test("passes null through as null rather than the string \"null\"", () => {
    const before: Fields = { status: "Open", category: "Billing", assignee: "Alex" };
    const after: Fields = { status: "Open", category: "Billing", assignee: null };

    expect(
      diffToEntries(before, after, [{ field: "assignee", action: "assignee_changed" }]),
    ).toEqual([{ action: "assignee_changed", fromValue: "Alex", toValue: null }]);
  });

  test("prefixes the value with the label when one is given", () => {
    const before = { name: "Ada", email: "ada@example.com" };
    const after = { name: "Ada Lovelace", email: "ada@example.com" };

    expect(
      diffToEntries(before, after, [
        { field: "name", action: "user_edited", label: "Name" },
        { field: "email", action: "user_edited", label: "Email" },
      ]),
    ).toEqual([
      { action: "user_edited", fromValue: "Name: Ada", toValue: "Name: Ada Lovelace" },
    ]);
  });
});
