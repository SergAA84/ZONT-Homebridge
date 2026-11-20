# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [0.2.0] - Unreleased

### Reliability and compatibility review (2026-11-20)

- Updated ZONT schema baseline to 26.11.2 and added ephemeral TOTP/backup-code support for token issuance with 2FA; code is never persisted, duplicate actions are blocked, and credentials clear from the draft after successful issuance.
- Fixed a real-HAP failure by using `api.hap.Perms`; writable targets use `WRITE_RESPONSE` so HAP retains the server-confirmed value, including rounding.
- Preserved Homebridge `_bridge`, `_disabled`, unknown options and other config blocks when saving settings; serialized drafts disable Save until a valid current draft succeeds.
- Initialized restored accessory handlers before network discovery. Offline, failed, stale, missing and invalid readings now return communication errors rather than fabricated values or an incorrect OFF state.
- Retained selected accessories during partial/empty/malformed snapshots and cloud outages; explicit deselection remains the removal mechanism.
- Serialized per-circuit commands within a shared eight-second queue/request/confirmation budget; discarded late pre-command polls and cancelled work safely on shutdown. Control POSTs are never automatically retried.
- Added strict HTTP/JSON success validation, machine-readable errors, bounded `Retry-After`/exponential polling backoff, fixed-origin redirect rejection, ID validation and finite-reading validation.
- Added proper COOL state/constraints for cooling circuits and logging of circuit failure without error details. Removed fabricated target-temperature fallback.
- Fixed sensor opt-out on rediscovery, retained missing selections, and prevented implicit includeAll opt-in when checking every visible circuit.
- Independent review follow-up: synchronously locked selection/form controls throughout discovery/auth to prevent stale rerendering from undoing deselection; added delayed-IPC/real-click regression tests and correct per-device unlocking.
- Independent review follow-up: stopped swapping real temperature limits with fallback defaults. Missing/equal limits are read-only, contradictory limits invalidate the target, and high-temperature setpoints remain readable with display-only bounds. Rechecked bounds at queued-command execution and added real-HAP regressions.
- Independent review follow-up: fail an outstanding HAP write read-only when its confirmed response removes `WRITE_RESPONSE`, retaining the authoritative setpoint rather than emitting the requested value; covered rounded responses and queued writes on real HAP.
- Updated UI-utils to 2.3.0, added Node 26 support and minimum-Node/current-LTS CI, refreshed GitHub Actions and synchronized the lock file.
- Added real HAP-NodeJS, jsdom DOM, UI-server IPC and fault/race/auth regression tests, with enforced coverage thresholds; clarified that coverage does not replace physical HomeKit validation.
- Updated all project documentation, including iOS 27/updated Apple Home, HAP-only scope, security and manual release gates.

### Earlier local improvements

- Aligned with ZONT Widget API v3 schema 26.8.1.
- Added support for dependent circuits (`is_dependent`): their HomeKit target temperature is now read-only and write attempts are rejected before hitting the API.
- Mapped the updated circuit `error` structure (`{ oem, text }`) and `status: failure`, and logged circuit/boiler errors (circuits do not use HomeKit `StatusFault`, which is not valid for the Thermostat service).
- Mapped circuit `time_left` and sensor `triggered` fields; normalized sensor `signal_strength` to the ZONT enum.
- Removed the non-schema `connection` value from the `fields` query. `connection` is a base device field returned without being listed in `fields`, so requesting it was incorrect.
- Added HomeKit `StatusFault`/`StatusActive` to temperature and humidity sensors based on ZONT sensor status.
- Added an `AccessoryInformation` service (Manufacturer/Model/SerialNumber) to every accessory.
- Applied the updated device returned by the target-temperature command for an immediate UI refresh instead of an extra poll; removed the redundant pre-write device read.
- Hardened the polling lifecycle: interval is clamped to 10–300s with a non-finite fallback, and a shutdown flag prevents in-flight polls from registering/unregistering accessories during teardown.
- `CurrentTemperature` keeps its last known value when ZONT reports no actual temperature instead of showing the setpoint.
- Sensors and thermostats no longer publish a fabricated default reading before the first real measurement; a sensor without a value is reported as inactive (`StatusActive = false`), and `CurrentTemperature`/humidity `onGet` returns a HAP "not available" error until a real value arrives.
- Discovery now includes devices that have supported temperature/humidity sensors even when they have no heating circuits, so their sensors can be selected in the UI.
- The request timeout now covers the response body read, so a server that stalls mid-body times out instead of hanging polling/UI requests.
- Sensors whose ZONT type changes while keeping the same id are migrated to the correct HomeKit service (the stale service is removed), including after a Homebridge restart when no runtime exists yet.
- `AccessoryInformation` (Model) is refreshed on every sync, so a circuit type change is reflected without a restart.
- `time_left` only accepts numeric values; `null`/empty strings are treated as absent instead of being coerced to `0`.
- Serialized the custom UI config staging with a version guard so a slow save cannot overwrite a newer draft (token, selected circuits/sensors); a failed save no longer permanently blocks subsequent saves, and the device checkbox handler surfaces save errors.
- Rounded humidity readings to whole percent to match the HomeKit step.
- Marked dependent circuits in the custom settings UI.
- Extracted the custom UI discovery/auth logic into `lib/uiDiscovery.js` so it can be unit tested; `homebridge-ui/server.js` is now a thin wrapper.
- Replaced the hand-maintained lint file list with `scripts/lint.js`, which syntax-checks all JavaScript files automatically.
- Expanded automated test coverage (ZONT client error branches, UI discovery helpers, runtime lifecycle, poll clamping/shutdown, dependent read-only writes, sensor status, AccessoryInformation, HAP getters); line coverage across `lib/` is above 98%.
- Updated all documentation (README, architecture, ZONT API v3 mapping, Homebridge integration, testing, release checklist) for schema 26.8.1 and the new behaviour.

## [0.1.2] - 2026-06-16

- Added optional HomeKit temperature and humidity sensor accessories for selected ZONT sensors.
- Added sensor selection to the custom Homebridge settings UI.
- Recommended outdoor sensors by name (`Улица`, `outdoor`, `outside`) while leaving internet weather sensors optional.
- Fixed ZONT Widget API v3 `fields` query formatting to request multiple fields correctly.
- Added network access documentation for security scanners and users.
- Removed the duplicate logo asset from the npm package.
- Updated ZONT API v3 documentation and tests.

## [0.1.1] - 2026-05-07

- Added project logo assets.
- Updated README branding.

## [0.1.0] - 2026-05-07

- Initial public package preparation.
- Added ZONT Widget API v3 device/circuit discovery.
- Added HomeKit thermostat accessories for selected ZONT circuits.
- Added target temperature write-back through ZONT Widget API v3.
- Added Homebridge custom settings UI.
