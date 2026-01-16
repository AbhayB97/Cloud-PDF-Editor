import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("service worker", () => {
  it("defines install and fetch handlers", () => {
    const content = readFileSync(resolve("public/sw.js"), "utf-8");
    expect(content).toContain("install");
    expect(content).toContain("fetch");
    expect(content).toContain("caches");
  });
});
