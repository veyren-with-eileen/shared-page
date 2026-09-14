import { render } from "preact";
import { App } from "./app/App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./styles/global.css";

render(<App />, document.getElementById("app")!);
registerServiceWorker();
