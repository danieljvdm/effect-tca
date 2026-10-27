import { RegistryProvider } from "@effect/atom-react";
import { Component, type ReactNode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { Fieldnotes } from "./App.tsx";

import "./style.css";

class AppBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      <main>
        <h1>Something went wrong</h1>
        <p>Please reload to start a fresh session.</p>
      </main>
    ) : (
      this.props.children
    );
  }
}

const element = document.getElementById("root");

if (element !== null) {
  const root = createRoot(element);

  root.render(
    <RegistryProvider>
      <AppBoundary>
        <Suspense
          fallback={
            <main aria-busy="true">
              <p>Opening your notebook…</p>
            </main>
          }
        >
          <Fieldnotes />
        </Suspense>
      </AppBoundary>
    </RegistryProvider>,
  );
  import.meta.hot?.dispose(() => root.unmount());
}
