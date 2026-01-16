import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadLastPdf, saveLastPdf } from "../src/storage.js";

describe("storage", () => {
  it("saves and loads last session bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const saved = await saveLastPdf(bytes);
    expect(saved).toBe(true);
    const loaded = await loadLastPdf();
    expect(Array.from(loaded)).toEqual([1, 2, 3, 4]);
  });
});
