import { App } from "./app/App";
import { routeForPathname } from "./app/entryRoute";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root element");
}

let cleanup = (): void => undefined;

if (routeForPathname(window.location.pathname) === "catalog") {
  const { CatalogPage } = await import("./catalog/CatalogPage");
  const page = new CatalogPage(root);
  page.mount();
} else {
  const app = new App(root);
  cleanup = () => app.destroy();
  void app.start();
}

window.addEventListener("pagehide", cleanup, { once: true });

if (import.meta.hot) {
  import.meta.hot.dispose(cleanup);
}
