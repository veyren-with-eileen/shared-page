import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker() {
  registerSW({
    immediate: true,
    onRegisterError(error) {
      console.error("Unable to register the shared-page service worker", error);
    }
  });
}
