# Releasing slack-axi

slack-axi uses the JarvusInnovations release automation (same as gws-axi): **`develop` is the working
branch, `main` is the release branch.** The workflow files in `.github/workflows/` (`release-prepare`,
`release-validate`, `release-publish`, `publish-npm`) are in place. This doc covers how the flow works
and the **manual setup it still depends on**.

## The automated flow (once set up)

1. Merge work into **`develop`**.
2. Push to `develop` → **`release-prepare`** opens/updates a "Release" PR `develop → main` with the
   version bump + changelog (via `JarvusInnovations/infra-components`).
3. **`release-validate`** runs on that PR (and on every PR to `main`) to confirm it's a valid release PR.
4. Merge the release PR → **`release-publish`** runs on PR-close: creates the tag + GitHub Release.
5. Release published → **`publish-npm`** builds and runs `npm publish --provenance --access public`.

So day-to-day you only ever merge to `develop`; everything downstream is automated.

## Manual steps remaining (need your repo access / accounts)

1. **Branch model.** Create a `develop` branch from `main` and make it the **default branch** (work
   happens there; `main` only receives release PRs). Add branch protection on `main`: require the
   `build-and-test` check, disallow direct pushes.

2. **Actions permissions.** Repo → Settings → Actions → General → **Workflow permissions** →
   "Read and write permissions" **and** check "Allow GitHub Actions to create and approve pull
   requests" — so `release-prepare` can open the release PR using the default `GITHUB_TOKEN`.

3. **`BOT_GITHUB_TOKEN` secret.** `release-publish` uses a bot token, not the default `GITHUB_TOKEN`,
   because actions taken with `GITHUB_TOKEN` don't trigger downstream workflows (the tag/release → npm
   publish chain would never fire). Add it under Settings → Secrets and variables → Actions, matching
   whatever bot/scopes gws-axi uses (typically `repo` + `workflow`).

4. **npm trusted publishing** (for `publish-npm.yml`):
   - The package name `slack-axi` must be claimable/owned on npm under your org. The **first** publish
     may need a one-time manual `npm publish --access public` to claim the name.
   - Configure npm **Trusted Publisher (OIDC)** for the package, pointing at `JarvusInnovations/slack-axi`
     and the `publish-npm.yml` workflow. With trusted publishing there's **no `NPM_TOKEN` needed**
     (`id-token: write` is already set, and `repository` is now in `package.json` for provenance).
   - Confirm org 2FA / publish-access settings permit automated publishes.

5. **`infra-components` access.** `release-prepare`/`validate`/`publish` use the private
   `JarvusInnovations/infra-components@channels/github-actions/.../latest` actions. Ensure this repo's
   Actions can resolve them (the same org-internal access gws-axi has).

## Bootstrapping (do this first)

`release-validate` enforces that **every PR targeting `main` must be titled `Release: vX.Y.Z`**
(verified live: it fails any other title with `PR title must match format "Release: vX.Y.Z(-rc.#)?"`).
That's the whole point of the develop→main model — only the auto-generated release PRs ever target
`main`. But it creates a one-time bootstrap wrinkle:

1. **This repo-hygiene/release PR will show `release-validate` red** because its title isn't a release
   title. That's expected. Merge it anyway (admin override) to land the workflows on `main` — do **not**
   make `release-validate` a required status check until the develop flow is live.
2. Create `develop` from `main` and switch day-to-day work there.
3. From then on the only PRs to `main` are `release-prepare`'s "Release: vX.Y.Z" PRs, which pass
   `release-validate` — so the red check never recurs for normal work.

## Caveats / things I couldn't verify

- I **could not inspect** the private `infra-components` actions, so all four workflows are copied
  **verbatim from gws-axi** (the proven, working reference). The version tooling keys on
  conventional-commit messages (which we already use). If gws-axi's release flow has since diverged
  (action refs, version-bump convention, changelog location), re-sync from it.

## Summary

| Automated | Manual (once) |
| --- | --- |
| version bump, changelog, release PR | create `develop` + branch protection |
| tag + GitHub Release | Actions write + PR-create permission |
| npm publish (provenance) | `BOT_GITHUB_TOKEN` secret |
| | npm trusted-publisher config (+ first-publish name claim) |
| | confirm `infra-components` access |
