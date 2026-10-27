import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vp = join(root, "node_modules/.bin/vp");
const releaseDir = join(root, ".release");
const fromRegistry = process.argv.includes("--registry");

const packages = [["tca", "@yielded/tca"]];

const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });

const output = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });

const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const version = JSON.parse(await readFile(join(root, "packages/tca/package.json"), "utf8")).version;

assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
if (!fromRegistry) {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir);
}

for (const [directory, name] of packages) {
  const archive = join(releaseDir, `${directory}.tgz`);

  const manifest = JSON.parse(
    await readFile(join(root, "packages", directory, "package.json"), "utf8"),
  );

  assert.equal(manifest.version, version, `${name} must share the beta version`);

  if (fromRegistry) continue;
  run(vp, ["-C", join(root, "packages", directory), "pm", "pack", "--out", archive]);

  const entries = output("tar", ["-tzf", archive]).trim().split("\n");

  for (const file of ["LICENSE", "README.md", "dist/index.mjs", "dist/index.d.mts"]) {
    assert(entries.includes(`package/${file}`), `${name} is missing ${file}`);
  }
  assert(!entries.some((file) => file.startsWith("package/src/")), `${name} packed source`);

  const packed = JSON.parse(output("tar", ["-xOf", archive, "package/package.json"]));

  assert.equal(packed.version, version);
  assert.equal(packed.private, undefined);
  assert(
    !/"(?:workspace|catalog):/.test(JSON.stringify(packed)),
    `${name} has unresolved dependencies`,
  );
}

const consumer = await mkdtemp(join(tmpdir(), "yielded-tca-release-"));

try {
  const dependencies = Object.fromEntries(
    packages.map(([directory, name]) => [
      name,
      fromRegistry ? version : `file:${join(releaseDir, `${directory}.tgz`)}`,
    ]),
  );

  dependencies.effect = rootManifest.catalog.effect;

  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "yielded-tca-release-consumer",
        private: true,
        type: "module",
        packageManager: rootManifest.packageManager,
        scripts: { typecheck: "tsrs --noEmit", build: "vp pack" },
        dependencies,
        overrides: {
          ...Object.fromEntries(
            Object.keys(rootManifest.overrides).map((name) => [name, rootManifest.catalog[name]]),
          ),
          ...(!fromRegistry &&
            Object.fromEntries(packages.map(([, name]) => [name, dependencies[name]]))),
        },
        devDependencies: {
          typescript: rootManifest.catalog.typescript,
          tsrs: rootManifest.catalog.tsrs,
          "vite-plus": rootManifest.catalog["vite-plus"],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "vite.config.ts"),
    'import { defineConfig } from "vite-plus";\nexport default defineConfig({ pack: { entry: ["src/index.ts"], format: ["esm"], dts: true } });\n',
  );
  await mkdir(join(consumer, "src"));
  await writeFile(
    join(consumer, "src/index.ts"),
    [
      'export { Feature, FeatureEffect, Store, TestStore, StoreError } from "@yielded/tca";',
      'export * as DirectFeature from "@yielded/tca/Feature";',
      'export * as DirectFeatureEffect from "@yielded/tca/FeatureEffect";',
      'export { FeatureAtom } from "@yielded/tca/atom";',
      'export * as DirectAtom from "@yielded/tca/atom/FeatureAtom";',
      "",
    ].join("\n"),
  );

  run(vp, ["install", "--ignore-scripts"], consumer);
  run(vp, ["run", "typecheck"], consumer);
  run(vp, ["run", "build"], consumer);
  console.log(`${fromRegistry ? "Registry" : "Packed"} consumer checks passed for ${version}`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
