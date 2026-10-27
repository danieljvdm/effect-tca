import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      Command: "src/Command.ts",
      Feature: "src/Feature.ts",
      Store: "src/Store.ts",
      TestStore: "src/TestStore.ts",
      StoreError: "src/StoreError.ts",
      atom: "src/atom.ts",
      "atom/FeatureAtom": "src/atom/FeatureAtom.ts",
    },
    dts: { tsconfig: "tsconfig.build.json" },
    format: ["esm"],
    sourcemap: true,
  },
  test: { cache: false, silent: "passed-only" },
});
