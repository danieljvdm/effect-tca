# Repository toolchain

Vite+ owns repository commands; Bun owns installation and the lockfile.
The root `package.json` catalog pins shared versions copied from
[Sync](https://github.com/yielded-dev/sync/tree/cfae88bdd717e5c82b82ddf0592e1337816eabb8).
Dependencies use `catalog:` and local packages use `workspace:*`.

| Command                | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `vp install`           | Install dependencies and configure Git hooks        |
| `vp run build`         | Build ESM, declarations, and the search application |
| `vp fmt`               | Format owned files                                  |
| `vp lint`              | Type-aware linting                                  |
| `vp run typecheck`     | TypeScript and Effect diagnostics                   |
| `vp run test`          | Run any existing package suites                     |
| `vp run release:check` | Inspect the tarball and typecheck a clean consumer  |
| `vp run ready`         | Build, check, test, and verify package consumption  |

Build before typechecking: workspace imports resolve the same built exports that
consumers use. No source aliases or compiler patches are required. CI installs
the frozen lockfile with optional platform binaries and runs `vp run ready`.
Use `vp env doctor` for toolchain issues and `node_modules/vite-plus/docs` for
command and configuration details.

Public modules use direct Effect module imports, explicit package exports, and
JSDoc with category and since metadata. Private helpers stay under `internal`.
React depends on the Atom entry point; core never depends on React or platforms.

Follow the [testing policy](../AGENTS.md#testing-policy). New code does not imply
new tests. The test command permits packages without suites. Use real workflows,
static checks, and package verification first.
TestStore is a library feature and does not depend on a test runner.

Contributor skills are copied unchanged from Sync, including their origin
receipts. Keep local policy in `AGENTS.md`; don't edit the pinned skill copies.
The repository requires no Dev Kit command to install, develop, build, or check.

Changesets are configured for version management. Publishing, pushing, and merging
remain explicit user actions; the checked-in CI only verifies the repository.
