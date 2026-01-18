import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  clearSessionHistory,
  clearSignatureProfile,
  loadLastPdf,
  loadSessionHistory,
  loadSignatureProfile,
  saveLastPdf,
  saveSessionHistory,
  saveSignatureProfile
} from "../src/storage.js";

describe("storage", () => {
  it("saves and loads last session bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const saved = await saveLastPdf(bytes);
    expect(saved).toBe(true);
    const loaded = await loadLastPdf();
    expect(Array.from(loaded)).toEqual([1, 2, 3, 4]);
  });

  it("saves and clears signature profiles", async () => {
    const profile = { name: "Ada Lovelace", initials: "AL", fontId: "sig-allura" };
    await saveSignatureProfile(profile);
    const loaded = await loadSignatureProfile();
    expect(loaded).toEqual(profile);
    await clearSignatureProfile();
    const cleared = await loadSignatureProfile();
    expect(cleared).toBeNull();
  });

  it("stores session history entries", async () => {
    const entries = [
      {
        id: "session-1",
        fileName: "demo.pdf",
        fileHash: "hash-1",
        lastOpened: Date.now(),
        annotations: [{ type: "text", id: "text-1" }]
      }
    ];
    await saveSessionHistory(entries);
    const loaded = await loadSessionHistory();
    expect(loaded.length).toBe(1);
    expect(loaded[0].fileName).toBe("demo.pdf");
    await clearSessionHistory();
    const cleared = await loadSessionHistory();
    expect(cleared.length).toBe(0);
  });
});
