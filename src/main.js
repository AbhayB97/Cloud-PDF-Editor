import { initApp } from "./app.js";

const root = document.getElementById("app");
initApp(root);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  const installEvent = new CustomEvent("pwa-install-available", { detail: event });
  window.dispatchEvent(installEvent);
});
