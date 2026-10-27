# Changesets

Use `vp run changeset` for a consumer-visible change and
`vp run changeset status` to inspect pending notes.

The Release workflow verifies and opens a version PR from changesets on `main`.
A maintainer reviews and merges that PR when ready to publish. The next run
verifies the package, publishes the resulting tarball to npm, and creates its
Git tag and GitHub release. Version PRs are never merged automatically.

Publishing uses npm trusted publishing for `danieljvdm/effect-tca`, workflow
`release.yml`, and the `npm` GitHub environment, restricted to `main`. Configure
that publisher to allow direct publication, and allow GitHub Actions to create
pull requests in the repository settings. No npm token secret is required.

For an explicitly authorized manual release, run `vp run ready`, inspect
`vp run release:plan`, then run `vp run release:publish` with an authenticated
npm session. `vp run release:check` only builds local tarballs and verifies
consumption; it does not publish or create tags.
