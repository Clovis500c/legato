import { expect, it } from "vitest";
import { practicePatch } from "./practice";

it("slows the song down, and normal speed never switches bypassed effects back on", () => {
  expect(practicePatch({ on: false, tempo: 1 }, 0.75)).toEqual({
    tempo: 0.75,
    on: true,
  });
  expect(practicePatch({ on: true, tempo: 0.75 }, 1)).toEqual({ tempo: 1 });
  // Already heard at that speed: nothing changes, no draft.
  expect(practicePatch({ on: false, tempo: 1 }, 1)).toBeNull();
  expect(practicePatch({ on: false, tempo: 0.5 }, 1)).toBeNull();
  expect(practicePatch({ on: true, tempo: 0.9 }, 0.9)).toBeNull();
});
