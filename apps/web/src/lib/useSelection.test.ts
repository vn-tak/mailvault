import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSelection } from "./useSelection";

/**
 * The selection a bulk action is applied to. The behaviours worth pinning are the ones a
 * person judges by feel: a shift-click covering the rows in between, a range that adds rather
 * than replaces, and ids that come out in list order so the action hits what the eye was on.
 */

const ROWS = ["a", "b", "c", "d"];

const setup = () => renderHook(() => useSelection(ROWS));

describe("picking rows", () => {
  it("toggles one row", () => {
    const { result } = setup();
    act(() => result.current.toggle("b"));
    expect(result.current.ids).toEqual(["b"]);
    expect(result.current.has("b")).toBe(true);
    act(() => result.current.toggle("b"));
    expect(result.current.count).toBe(0);
  });

  it("returns ids in list order, not click order", () => {
    const { result } = setup();
    act(() => {
      result.current.toggle("d");
      result.current.toggle("a");
    });
    expect(result.current.ids).toEqual(["a", "d"]);
  });

  it("extends from the last plain click when shift is held", () => {
    const { result } = setup();
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("c", true));
    expect(result.current.ids).toEqual(["a", "b", "c"]);
  });

  it("adds to a selection on a second shift-drag instead of replacing it", () => {
    const { result } = setup();
    act(() => {
      result.current.toggle("a");
      result.current.toggle("b", true);
    });
    act(() => {
      result.current.toggle("d");
      result.current.toggle("c", true);
    });
    expect(result.current.ids).toEqual(["a", "b", "c", "d"]);
    expect(result.current.allSelected).toBe(true);
  });

  it("takes the whole page and lets go of it again", () => {
    const { result } = setup();
    act(() => result.current.toggleAll());
    expect(result.current.ids).toEqual(ROWS);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
  });

  it("forgets the anchor when cleared, so a shift-click cannot reach a row that is gone", () => {
    const { result } = setup();
    act(() => {
      result.current.toggle("a");
      result.current.clear();
    });
    // Nothing to count from any more: the shift-click has to behave as a plain one.
    act(() => result.current.toggle("c", true));
    expect(result.current.ids).toEqual(["c"]);
  });
});
