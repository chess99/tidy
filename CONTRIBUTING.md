# Contributing

Thanks for your interest in contributing to Tidy.

## Scope

- This project is a local file organizer, not a cloud album.
- Changes should keep the file-system-first, recoverable workflow intact.

## Development

- Follow the docs in `docs/开发指南.md`.
- Keep code style consistent with existing files.
- Run `npm run doc:check` if you add/rename source files.

## Branching and Releases

- Treat `main` as the default integration branch.
- Prefer short-lived feature branches or direct work on the current task branch; avoid using a long-lived `dev` branch as the real trunk.
- Merges or pushes to `main` should run validation/build workflows, but should not publish a desktop release.
- Create desktop releases explicitly from GitHub Actions `Release` workflow after bumping `desktop/package.json`; the release tag must match that version, for example `v0.1.0`.
- Keep GitHub Pages deployment separate from desktop releases. The Pages workflow may deploy `site/**` changes from `main`.

## Pull Requests

- Explain the problem and the reasoning.
- Keep changes focused and cohesive.
- Update affected docs and README indexes.

## Issues

- Provide steps to reproduce.
- Include OS, version, and logs if available.
