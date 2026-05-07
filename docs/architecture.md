# Architecture

## Overview

The plugin is a Homebridge 2 dynamic platform plugin.

Main responsibilities:

- Authenticate with ZONT Widget API v3.
- Discover user devices and heating circuits.
- Persist selected devices/circuits in Homebridge `config.json`.
- Register selected circuits as HomeKit `Thermostat` accessories.
- Poll ZONT for current state and update HomeKit characteristics.
- Write HomeKit target temperature changes back to ZONT.

## Runtime Files

- `index.js`: Homebridge entry point. Registers platform alias `ZontPlatform`.
- `lib/settings.js`: plugin constants.
- `lib/zontClient.js`: ZONT Widget API v3 client and data mapping.
- `lib/platform.js`: dynamic platform lifecycle, discovery, polling, accessory registration.
- `lib/platformAccessory.js`: HomeKit `Thermostat` service and characteristics.
- `config.schema.json`: Homebridge UI schema and custom UI enablement.
- `homebridge-ui/server.js`: server-side endpoints for the custom settings UI.
- `homebridge-ui/public/index.html`: custom settings UI.
- `test/`: automated unit tests and optional live ZONT API smoke-test.

## Homebridge Platform Lifecycle

1. Homebridge loads `index.js`.
2. `index.js` registers `ZontPlatform`.
3. `ZontPlatform` validates `clientEmail` and `token`.
4. On `didFinishLaunching`, the platform performs initial refresh.
5. Selected circuits are registered with `api.registerPlatformAccessories`.
6. Polling starts at `pollInterval` seconds.
7. On shutdown, polling timer is cleared.

## Accessory Identity

Accessory UUIDs are generated from:

```text
homebridge-zont-thermostat-{deviceId}:{circuitId}
```

The UUID namespace matches the package name and is stable for accessory identity.

## Package Name

`package.json.name` and `PLUGIN_NAME` must be:

```text
homebridge-zont-thermostat
```

Homebridge UI uses package name to locate `config.schema.json` and custom UI assets.

## Polling

The platform polls:

```text
GET /devices?fields=circuits,modes,sensors,connection
```

Polling is guarded by `pollInProgress` to avoid overlapping refreshes if the ZONT API is slow.

## Circuit Selection

Config stores selected circuits as:

```json
{
  "id": 123456,
  "includeAll": false,
  "includeCircuitIds": [1111, 2222]
}
```

`includeAll: true` exposes all circuits from that device. `includeAll: false` exposes only IDs in `includeCircuitIds`.

## Accessory Names

Names are normalized before HomeKit exposure:

- duplicate whitespace collapsed,
- leading/trailing whitespace removed,
- fallback used if empty.

This avoids HAP-NodeJS warnings for names like `"2 СУ "`.
