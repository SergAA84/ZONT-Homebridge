# Homebridge and Apple Home integration

## Supported environment

- Homebridge `^2.0.0`; current reference release **2.5.0** uses HAP-NodeJS **2.3.0**.
- Node.js `^22.12.0 || ^24.0.0 || ^26.0.0`. Install current security updates for the chosen LTS branch.
- Homebridge UI 5, with `@homebridge/plugin-ui-utils ^2.3.0` (reference UI **5.30.1**).
- Plugin package `homebridge-zont-thermostat`, platform alias `ZontPlatform`.

The plugin is CommonJS. Node 22.12 supports synchronous ESM dependencies via `require()` but may print an experimental interoperability warning; later supported LTS patches do not require suppressing warnings. Production receives HAP from `api.hap`; HAP-NodeJS is only a development dependency for tests.

Package keywords include `homebridge-plugin` and **`supports-hap`**. Do not declare `supports-matter` unless the plugin actually registers Matter accessories.

## iOS 27 and updated Apple Home

As checked on 20 November 2026, Apple's published iOS 27 changes focus on combined activity alerts, AI descriptions/search of HomeKit Secure Video and 4K video on compatible cameras. No mandatory replacement of ordinary thermostat/temperature/humidity HAP services was identified. This is a Node.js bridge, not an iOS app linking the HomeKit SDK; iOS application entitlements do not apply to it.

Apple ended support for the previous Apple Home architecture on **10 February 2026**. Use updated Apple Home and up-to-date HomePod/Apple TV software. A home hub is required for remote access, shared control and Home notifications; iPad is not a hub on the updated architecture.

Homebridge 2 also supports **opt-in Matter APIs** (`api.matter`), but this plugin remains HAP-only. Enabling Matter on a bridge does not convert HAP services automatically. A Matter-only bridge with HAP disabled cannot publish these accessories. Native Matter support, energy features and new sensor types are separate future projects, not required iOS 27 compatibility fixes.

Official references:

- [Apple iOS 27](https://www.apple.com/os/ios/)
- [iOS 27 release notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes)
- [Update Apple Home](https://support.apple.com/en-us/102287)
- [Homebridge developer documentation and transport declarations](https://developers.homebridge.io/)
- [Homebridge 2.5.0](https://github.com/homebridge/homebridge/releases/tag/v2.5.0)
- [UI-utils releases](https://github.com/homebridge/plugin-ui-utils/releases)

## HAP services

Every accessory includes `AccessoryInformation` (ZONT manufacturer, entity-type model, stable serial).

### Service.Thermostat

- `Name`: whitespace-normalized display name. Paired names may remain customized in Apple Home.
- `CurrentTemperature` and `TargetTemperature`: independently require valid fresh readings.
- `CurrentHeatingCoolingState`: `HEAT`/`COOL` when active, `OFF` when idle; unavailable when offline/failed/stale.
- `TargetHeatingCoolingState`: heating circuits declare `HEAT`, cooling declares `COOL`. This is not a circuit enable/disable control.
- Target bounds/step come from ZONT. Dependent targets are read/notify only, and writes fail with `READ_ONLY_CHARACTERISTIC`.
- Missing/equal limits also make the target read-only. Contradictory limits invalidate target reads/writes; they are not swapped into an invented valid range. Display-only fallbacks retain supplied bounds and include a valid known setpoint so higher-temperature circuits remain readable.
- Ordinary targets use `api.hap.Perms` including `WRITE_RESPONSE`, returning the server-confirmed setpoint.
- If a command response makes the target read-only before HAP completes its setter, that outstanding HAP write fails read-only instead of succeeding without `WRITE_RESPONSE`. The confirmed reading remains intact; no second command is sent.

`StatusFault` is **not** a valid optional Thermostat characteristic and is not added. Circuit failures are logged and surfaced through communication errors on getters. Target write failures are mapped to HAP communication errors rather than escaping as unhandled exceptions.

### Service.TemperatureSensor / Service.HumiditySensor

Supported sensors have value getters and `StatusFault`/`StatusActive`. Offline devices, missing readings, unknown/failure status and stale data are unavailable. Humidity is rounded to the characteristic's whole-percent step. Binary sensors and battery characteristics are not implemented.

## Custom UI and cache

`config.schema.json` is at package root and enables custom UI. Required fields are an object-level JSON Schema array, not `required: true` on individual properties. Server routes are handled through UI-utils IPC, not an arbitrary HTTP listener.

The custom UI uses `homebridge.updatePluginConfig()` to stage drafts; it does not call `savePluginConfig()`. The standard Save button commits them. Save is disabled while staging, during network actions or after invalid input/staging failure, and re-enabled after a current draft succeeds. Network actions synchronously lock form/selection controls, including during discovery's initial config flush and after rerendering, preventing edits from being lost to an older snapshot. Unlocking preserves the disabled circuits of unchecked devices. `_bridge`, `_disabled`, unrelated options and other config blocks are preserved.

Selected accessories absent from a ZONT snapshot are kept unavailable to preserve Home rooms and automations. Explicit deselection removes them on a successful refresh. Sensor service-type migrations and circuit information changes retain UUIDs.

## Troubleshooting

For a missing custom UI, check package/schema discovery:

```bash
node -e "const fs=require('fs'); const p=require.resolve('homebridge-zont-thermostat/package.json'); console.log(p); console.log(fs.existsSync(p.replace('package.json','config.schema.json')));"
```

Use the package manager/Homebridge UI to reinstall missing dependencies. Do not add a separate production HAP dependency to fix permissions. Repeated poll errors cause backoff, so reconnecting may not update instantly. Check account token validity, outbound HTTPS/DNS and the next retry after an outage.

Physical HomeKit pairing, read-only rendering, Siri and automation behavior must still be checked on real Apple devices before a public release; automated HAP/DOM tests are not certification.
