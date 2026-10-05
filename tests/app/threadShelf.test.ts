// The user's own thread colours (§6.3).
import { describe, expect, it } from "vitest";
import { addToShelf, normalizeShelf, removeFromShelf, SHELF_MAX } from "../../src/app/threadShelf.ts";

describe("the personal thread list", () => {
  it("reads only valid entries from storage", () => {
    expect(normalizeShelf("nonsense")).toEqual([]);
    expect(normalizeShelf([{ name: "navy", hex: "#1a2b3c" }, { hex: "red" }, null, { name: 7, hex: "#FFFFFF" }, { name: "navy", hex: "#1A2B3C" }])).toEqual([
      { name: "navy", hex: "#1A2B3C" },
      { name: "", hex: "#FFFFFF" },
    ]);
  });

  it("puts the newest thread first, without duplicates, and has a limit", () => {
    let list = addToShelf([], { name: "navy", hex: "#1a2b3c" });
    list = addToShelf(list, { name: "rust", hex: "#B04A20" });
    list = addToShelf(list, { name: "navy", hex: "#1A2B3C" });
    expect(list).toEqual([{ name: "navy", hex: "#1A2B3C" }, { name: "rust", hex: "#B04A20" }]);
    // the same colour under another name is another thread
    expect(addToShelf(list, { name: "night", hex: "#1A2B3C" })).toHaveLength(3);
    for (let i = 0; i < 60; i++) list = addToShelf(list, { name: `t${i}`, hex: "#000000" });
    expect(list).toHaveLength(SHELF_MAX);
    expect(list[0]!.name).toBe("t59");
  });

  it("removes by position", () => {
    const list = [{ name: "a", hex: "#000000" }, { name: "b", hex: "#111111" }, { name: "c", hex: "#222222" }];
    expect(removeFromShelf(list, 1).map((t) => t.name)).toEqual(["a", "c"]);
    expect(removeFromShelf(list, 9)).toEqual(list);
  });
});
