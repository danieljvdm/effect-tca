# Repository guidance

Read `README.md` and `docs/TOOLCHAIN.md` before changing repository structure or
tooling. Settle the [public API contracts](docs/PUBLIC_API.md) before extracting
runtime implementations. Keep documentation independent of issue trackers and
ticket identifiers; describe behavior, boundaries, and implementation stages directly.

## Documentation

Documentation teaches humans how to use the current API. Keep it terse and edit
whole pages for a clear reading path. A feature or fix usually needs a small change
to existing guidance; it does not justify appending another section.

- Guides explain the mental model, ownership, and essential usage. Use one focused
  example and link to runnable examples for complete setup.
- References describe public options, defaults, and caller-visible limitations in
  a scannable form. Keep essential security and recovery caveats beside their API.
- Source, schemas, and API comments own implementation contracts. Keep SQL query
  plans, predicate inventories, internal state-machine walkthroughs, and exhaustive
  failure explanations out of guides and reference pages.
- PRs and release notes own release history, package-version availability,
  `main`/unreleased warnings, old-version fallbacks, migration stories, investigation
  findings, and verification results. Do not put these in product documentation,
  including banners, callouts, compatibility sections, or annotated examples.
- Review every changed page as a whole before handoff. Remove repetition and material
  that does not help a reader use the API or avoid a concrete usage pitfall. Preserve
  the actual constraint in a short explanation; move its implementation rationale
  to source or the PR. Documentation is not a work log or a feature inventory.

Use `bun add` for consumer package installation examples.
Use small diagrams only when they clarify ownership or usage.
Use the rich MDX diagram components from `@yielded/starlight-theme/components`
for flows, traces, and ownership comparisons. Keep their accessible labels and descriptions.
The shared Starlight theme owns rendering and colors.

Never hardcode Effect's current version in documentation, including READMEs,
guides, reference pages, contributor docs, and installation commands. Use plain
`effect` without a version or release tag in install examples. Package manifests
and the root catalog own exact versions and peer compatibility; refer to them
instead of repeating version numbers in prose or tables.

## Effect

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and
follow its relevant links. For APIs not covered there, inspect
`node_modules/effect/src`. Do not copy library guidance into this file.

Use [Effect](.agents/skills/effect/SKILL.md) for focused setup, Atom, API, and CLI work.
Keep asynchronous public operations in `Effect` or `Stream`, with typed errors and
requirements. Effect Schema owns transported and persisted values. Resources must
be bounded and scoped.

Public modules follow Effect's namespace conventions and have explicit package
exports. Keep runtime helpers in `internal` modules and public contracts independent
of inferred implementation return types. Document public declarations with useful
JSDoc, `@category`, and `@since`; put defaults, errors, and resource ownership beside
the relevant API. Use direct Effect module imports in library source.

## Commands

Vite+ is the command authority; Bun is the package manager and script runtime.
Use `vp install`, `vp fmt`, `vp lint`, `vp test`, and `vp run <task>`.
Do not invoke wrapped compilers, formatters, linters, or test runners directly.
Run `vp help` for available commands and consult `node_modules/vite-plus/docs`.
Use `vp env doctor` for toolchain troubleshooting.

The root catalog owns exact shared dependency versions. Use `catalog:` for shared
dependencies and `workspace:*` for internal packages. After dependency changes,
run `vp install` and the relevant verification. Fix and release owning libraries;
consume released runtime versions without dependency patches. The Rust compiler
platform binaries are installed as optional dependencies.

Before handoff, run `vp run ready`. CI runs the same command after a frozen install
with optional platform binaries enabled.

## Compiler diagnostics

Keep `preferTypedSchemaDecoder` and these simplification diagnostics at error
severity in the shared Effect language-service configuration:

- `catchAllTagDispatchToCatchTag`
- `catchConditionalRefailToCatchIf`
- `provideLayerSucceedToProvideService`
- `allOfMapToForEach`
- `flatMapConditionalToFilterOrFail`
- `optionMatchToFromOption`
- `timeoutCatchTagToTimeoutOrElse`
- `runOfExitToRunExit`

Keep unconfigured simplification rules at their default severity,
`schemaSync` off, and `unsafeEffectTypeAssertion` at error severity. Apply
suggested rewrites only when they preserve failure, interruption, and resource
behavior. The root catalog owns compiler versions.

## Boundaries

- Framework code lives in `packages/*`; runnable consumers live in `examples/*`.
- Core owns state transitions, action routing, effect lifetime, and scoped stores.
- Core must not import React, platform implementations, or application code.
- Atom bindings live under the explicit `effect-tca/atom` entry point.
- Effects send actions; only reducers change feature state. Reducers are synchronous.
- Child identity owns cancellation. Removed or replaced instances cannot emit into new ones.
- Stores are in-memory. Persistence, network delivery, and durable execution are host concerns.

## Testing policy

Default to no new tests or test infrastructure. Verify requested behavior with
existing checks and direct workflow evidence. Prefer E2E for complex features;
this does not require writing an E2E suite or a larger substitute for a rejected
unit test. Save a verifiable, repeatable artifact without building reporting machinery.

Mirror public module paths in runtime tests, such as `test/Store.test.ts`.
Keep helpers beside their suites and browser or Worker entry points in `test/fixtures`.
Use `@effect/vitest` and `it.effect` for Effect programs; keep native browser and
Worker interactions at their existing Vitest boundary. Put compile-only public
contract checks in the owning package's `typetest` tree as `*.tst.ts`, included in
its normal typecheck. Use `expectTypeOf` for type assertions.

Never write unit tests after implementation. If isolation is necessary, first
write the scoped failure inventory, then the necessary failing tests, then the
code. New or expanded committed automation requires a current regression or an
explicit human test request, plus a concrete gap existing proof cannot cover.
Being a library does not waive this bar or require tests for every transition.

Load [testing](.agents/skills/testing/SKILL.md) before planning proof or adding,
retaining, or removing tests. It owns selection, failure-first isolation,
artifacts, evidence reuse and placement. Keep useful public-contract, atomicity,
recovery and authority checks at their strongest boundary; remove redundant
matrices and implementation mirrors. Preserve blocked required proof explicitly.
The final `vp run ready` gate still applies.

For a new regression, cite its pre-existing public issue or offending commit beside the test. For an explicit human test request, record the requested seam before implementation. A current PR, invented incident, or private customer identifier is not evidence; provenance does not waive necessity or failure-first order. Keep runtime tests under the owning package's `test/` directory and reuse its runner and the actual runtime boundary. Every E2E run, including a failed or interrupted run, must leave sanitized, inspectable evidence and concise replay instructions with the tested revision, environment, setup/cleanup, and expected and observed results. Keep evidence in the task artifacts or approved store, link it from the handoff, and keep credentials, cookies, private payloads, and capability URLs out of it.

## Skills and pull requests

Implement the minimum behavior the current request requires. Preserve required contracts, authority, durability and retry guarantees; avoid unrelated cleanup and machinery for hypothetical uses. Load [simplify](.agents/skills/simplify/SKILL.md) only when explicitly requested; ordinary changes do not require a separate simplification pass.

Use [pull-requests](.agents/skills/pull-requests/SKILL.md) for concise PR
descriptions. Include diagrams only for meaningful architecture changes and code
examples only when they clarify the change. Opening a PR does not authorize merging it.

This is a public library. Keep PR descriptions self-contained and follow any
required PR template. Omit private tracker links and issue IDs, including Linear
references; link to public code or guides when useful. Keep company/customer
names, account identifiers, and private workspace links out of PR text and linked
evidence unless the user explicitly requests them.

Shared contributor skills are authored in [danieljvdm/skills](https://github.com/danieljvdm/skills); Dev Kit distributes them into `.agents/skills`. These are repository tooling, not runtime modules. Keep committed copies identical to their pinned source, with provenance in each `.dev-kit-origin.json` receipt. Use `bunx @danieljvdm/dev-kit@latest skills status` before an explicit update; put repository-specific commands, gates, and constraints in this file or linked guidance, and upstream reusable improvements before refreshing a locally modified copy. The repository does not depend on Dev Kit for installation, checks, builds, or CI.

Load the exact repository skill paths linked here, including [Cloudflare](.agents/skills/cloudflare/SKILL.md). User and project skill catalogs may expose the same names; do not assume either scope overrides the other. Keep contributor skills committed so fresh checkouts are self-contained.

## Worktree startup

Create worktrees from cached refs; fetch explicitly when a newer base is needed.
Run `vp install` when dependencies or `node_modules/effect/AGENTS.md` are needed.
Installation uses Bun's shared store and keeps project-specific packages local.
Start only the development services needed for the task, explicitly. Worktree
creation itself should not install dependencies or start servers.

## Public library publication

Never merge this public repository or publish releases without explicit user
confirmation covering this repository and action. Preparing changes does not
provide publication or merge authorization.
