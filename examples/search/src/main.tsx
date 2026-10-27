import { RegistryProvider } from "@effect/atom-react";
import { createRoot } from "react-dom/client";

import { Fieldnotes } from "./App.tsx";

import "./style.css";

const element = document.getElementById("root");

if (element !== null) {
  const root = createRoot(element);

  root.render(
    <RegistryProvider>
      <Fieldnotes />
    </RegistryProvider>,
  );
  import.meta.hot?.dispose(() => root.unmount());
}
