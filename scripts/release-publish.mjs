import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vp = join(root, "node_modules/.bin/vp");
const releaseDir = join(root, ".release");
const planPath = join(releaseDir, "publish-plan.json");

const changeset = (...args) =>
  execFileSync(vp, ["run", "changeset", ...args], { cwd: root, stdio: "inherit" });

changeset("publish-plan", "--output", planPath);

const plan = JSON.parse(await readFile(planPath, "utf8"));
const releases = plan.plan.flat().filter((release) => release.kind === "publish");

if (releases.length > 0) {
  const manifest = JSON.parse(await readFile(join(root, "packages/tca/package.json"), "utf8"));
  const archive = join(releaseDir, "tca.tgz");

  const packed = JSON.parse(
    execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }),
  );

  assert.equal(releases.length, 1, "Only the prepared effect-tca package may be published");
  assert.equal(releases[0].name, manifest.name);
  assert.equal(releases[0].version, manifest.version);
  assert.equal(packed.name, manifest.name, "Run vp run ready to prepare the package");
  assert.equal(packed.version, manifest.version, "Run vp run ready to refresh the package");
  assert(!packed.private, "The prepared package must be publishable");
  assert(!/"(?:workspace|catalog):/.test(JSON.stringify(packed)), "Unresolved dependencies");

  // Use the same Vite/Bun tarball that release:check verified. npm's source
  // packing does not resolve the repository's catalog dependency specifiers.
  releases[0].tarball = {
    path: "tca.tgz",
    integrity: `sha256-${createHash("sha256")
      .update(await readFile(archive))
      .digest("base64")}`,
  };
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
}

if (!process.argv.includes("--plan-only")) {
  changeset("publish", "--from-pack-dir", releaseDir);
}
