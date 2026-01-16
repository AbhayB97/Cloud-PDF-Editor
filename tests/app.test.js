import { describe, expect, it } from "vitest";
import { initApp } from "../src/app.js";

function setupDom() {
  document.body.innerHTML = "<div id=\"app\"></div>";
  return document.getElementById("app");
}

describe("app shell", () => {
  it("bootstraps without errors", () => {
    const root = setupDom();
    expect(() => initApp(root)).not.toThrow();
  });

  it("renders the app title", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Cloud PDF Editor");
  });

  it("renders load and merge controls", () => {
    const root = setupDom();
    initApp(root);
    expect(root.querySelector("input[type=\"file\"]")).toBeTruthy();
    expect(root.textContent).toContain("Merge PDFs");
  });

  it("renders export and image controls", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Insert Image");
    expect(root.textContent).toContain("Download PDF");
  });
});
