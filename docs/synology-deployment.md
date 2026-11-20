# Synology Deployment

This document is platform-specific. Normal users should install the plugin from the Homebridge UI Plugins page.

## Recommended Installation

1. Open Homebridge UI.
2. Go to `Plugins`.
3. Search for `homebridge-zont-thermostat`.
4. Click `Install`.
5. Open plugin settings.
6. Generate a ZONT token (enter a TOTP/backup code if the account uses 2FA) and select circuits/sensors.
7. Save and restart Homebridge when prompted.

No manual file copying or path editing is required.

## Package Name

```text
homebridge-zont-thermostat
```

## Typical Synology Paths

These paths are informational only and are not required for normal installation:

```text
Config File Path: /volume1/homebridge/config.json
Storage Path:     /volume1/homebridge
Plugin Path:      /volume1/homebridge/node_modules
```

Homebridge UI/npm determines the actual plugin installation path. Do not hard-code plugin paths in configuration.

## Verify Installation

Check package and schema discovery from the Homebridge environment:

```bash
node -e "const fs=require('fs'); const p=require.resolve('homebridge-zont-thermostat/package.json'); console.log('package:', p); console.log('schema exists:', fs.existsSync(p.replace('package.json','config.schema.json')));"
```

Expected:

```text
schema exists: true
```

## Logs

View logs from the Homebridge UI or with `hb-service logs` where available.

Useful expected log lines:

```text
Loaded plugin: homebridge-zont-thermostat@0.2.0
Registering platform 'homebridge-zont-thermostat.ZontPlatform'
[homebridge-zont-thermostat] Custom UI server ready
```

## Common Problems

### Custom UI Spins Forever

Check Homebridge logs for:

```text
Cannot find module '@homebridge/plugin-ui-utils'
```

Fix through Homebridge UI by reinstalling or updating the plugin. For local development only, run `npm install` in the project folder.

### Manual Config Message

Cause: schema not found or package name mismatch.

The package name and `PLUGIN_NAME` must both be:

```text
homebridge-zont-thermostat
```

### Stale Accessories

Selected accessories temporarily missing from ZONT are intentionally kept as unavailable to preserve Apple Home rooms/automations. Explicit deselection removes them on a successful refresh. To remove an entity that is no longer discoverable, remove its ID in the JSON configuration and restart. A failed cloud refresh never serves as evidence that an accessory should be deleted.

### Child Bridge and Node versions

Use the latest patched Node 22, 24 or 26 release supported by the Synology/Homebridge installation, and HAP enabled on the bridge. The plugin settings UI preserves Homebridge's `_bridge`/`_disabled` fields. Matter-only bridges do not expose this HAP-only plugin. Back up the Homebridge configuration and pairing storage before upgrading the package or changing bridge topology.

### No Response after an outage

Offline, failed, missing or stale readings are reported unavailable rather than showing an old temperature as current. Poll failures trigger exponential backoff up to 30 minutes and may honor a ZONT `Retry-After` delay. Check network connectivity/token validity and allow the next retry; do not repeatedly generate new tokens to troubleshoot a temporary outage.
