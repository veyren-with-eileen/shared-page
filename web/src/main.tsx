import { render } from "preact";
import { App } from "./app/App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./styles/global.css";

async function bootstrap() {
  const runtimeConfigUrl = "/runtime-config.js";

  try {
    await import(/* @vite-ignore */ runtimeConfigUrl);
  } catch {
    // Runtime config is optional; the in-app connection form remains available.
  }

  render(<App />, document.getElementById("app")!);
  registerServiceWorker();
}

void bootstrap();
