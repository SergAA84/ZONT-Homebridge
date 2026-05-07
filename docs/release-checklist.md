# Release Checklist

## Before Publishing

Update `package.json`:

- Confirm `private` is absent from `package.json`.
- Confirm package name: `homebridge-zont-thermostat`.
- Confirm `keywords` contains `homebridge-plugin`.
- Confirm `homepage` points to the GitHub README.
- Confirm `repository` points to the GitHub repository.
- Confirm `bugs` points to GitHub issues.
- Confirm engines:

```json
{
  "node": "^22.12.0 || ^24.0.0",
  "homebridge": "^2.0.0"
}
```

## Required Files

Package must include:

```text
index.js
config.schema.json
lib/
homebridge-ui/
README.md
docs/
package.json
LICENSE
```

Package must not include local secrets:

```text
.env
```

## Manual Verification

On a Homebridge 2 installation:

1. Install package.
2. Confirm plugin appears with no warning badge.
3. Open settings and confirm custom UI loads.
4. Generate token.
5. Discover devices.
6. Select at least one non-technical circuit.
7. Save and restart.
8. Confirm Thermostat accessories appear.
9. Change target temperature from Home app.
10. Confirm ZONT receives target temperature change.
11. Confirm no warning appears for accessory names.

## Smoke Commands

Syntax check:

```bash
npm run lint
```

Automated tests:

```bash
npm test
```

All local checks:

```bash
npm run check
```

Live ZONT API smoke-test, if credentials are available:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" npm test
```

Schema discovery:

```bash
node -e "const fs=require('fs'); const p=require.resolve('homebridge-zont-thermostat/package.json'); console.log(p); console.log(fs.existsSync(p.replace('package.json','config.schema.json')));"
```

## Versioning

Suggested pre-release versions while testing:

```text
0.1.x
```

Suggested first public stable version:

```text
1.0.0
```

## Publishing

Publish:

```bash
npm publish
```

Dry-run first:

```bash
npm publish --dry-run
```

If the package name changes, update all occurrences of `PLUGIN_NAME`, installation docs, and smoke-check commands.

## Homebridge Verified Requirements

Before requesting verification, confirm:

- Plugin is published to npm.
- Source code is available on GitHub with issues enabled.
- GitHub release exists for the published version.
- Plugin is a dynamic platform.
- Plugin implements Homebridge Plugin Settings GUI.
- Plugin supports currently required Node.js LTS versions, Node 22 and 24.
- Plugin installs successfully and does not start unless configured.
- Plugin has no analytics or tracking.
- Plugin has no post-install scripts that modify user systems.
- Runtime errors are caught and logged.
- CI passes on Node.js 22 and 24.
