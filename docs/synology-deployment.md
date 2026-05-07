# Synology Deployment

This document is platform-specific. Normal users should install the plugin from the Homebridge UI Plugins page.

## Recommended Installation

1. Open Homebridge UI.
2. Go to `Plugins`.
3. Search for `homebridge-zont-thermostat`.
4. Click `Install`.
5. Open plugin settings.
6. Generate a ZONT token and select circuits.
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
Loaded plugin: homebridge-zont-thermostat@0.1.1
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

If selected circuits were removed but still appear, save plugin config and restart Homebridge. The platform unregisters stale accessories during refresh.
