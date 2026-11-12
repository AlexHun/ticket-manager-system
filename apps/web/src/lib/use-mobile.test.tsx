import { render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useIsMobile } from "./use-mobile";

/** Every value the hook returned, in render order. */
function renderedValues(): boolean[] {
  const values: boolean[] = [];
  function Probe() {
    values.push(useIsMobile());
    return null;
  }
  render(<Probe />);
  return values;
}

describe("useIsMobile", () => {
  const desktopWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = desktopWidth;
  });

  // The first render is what paints first. Answering "desktop" there put the
  // tickets filter bar's desktop layout on a phone for a frame (#402).
  test("answers for a phone on its first render", () => {
    window.innerWidth = 390;

    expect(renderedValues()[0]).toBe(true);
  });

  test("answers for a desktop on its first render", () => {
    window.innerWidth = 1280;

    expect(renderedValues()[0]).toBe(false);
  });
});
