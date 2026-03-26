# Publishing Updates to npm

This document describes the workflow for publishing a new
version of `in-memory-db-table` to npm.

## Prerequisites

- npm account with publish access to the package
- logged in locally: `npm login`
- clean working tree recommended: `git status`

## Release Workflow

1. Update the code and docs

- make your changes
- update `README.md` if the public API or behavior changed

2. Install dependencies

```bash
npm install
```

3. Validate the package locally

```bash
npm run build
```

Recommended additional checks:

```bash
npm test
npm run lint
```

Notes:

- `prepublishOnly` already runs `npm run clean && npm run build`
- if package structure changes, review the `files` field in `package.json`

4. Bump the version

Choose one:

```bash
npm version patch
npm version minor
npm version major
```

This updates `package.json` and creates a git commit and
tag by default.

5. Review what will be published

```bash
npm publish --dry-run
```

Check that only the expected files are included.

6. Publish to npm

```bash
npm publish
```

If the package is ever moved to a scoped name and needs a
public first publish, use:

```bash
npm publish --access public
```

## After Publishing

1. Push commits and tags

```bash
git push
git push --tags
```

2. Verify the published package

- check the package page on npm
- optionally install it in a separate project:

```bash
npm i in-memory-db-table@latest
```

## Troubleshooting

- `403 Forbidden`: your npm account may not have publish access
- `You cannot publish over the previously published versions`: bump the version and publish again
- missing build output: run `npm run build` and confirm `dist/` exists before publishing
