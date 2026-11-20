# Homebridge ZONT Thermostat

<p align="center">
  <img src="https://raw.githubusercontent.com/SergAA84/ZONT-Homebridge/main/assets/icon.png" alt="Homebridge ZONT Thermostat" width="256" />
</p>

Homebridge 2 dynamic platform plugin that exposes ZONT heating/cooling circuits as HomeKit thermostats and selected temperature/humidity sensors.

The plugin uses ZONT Widget API v3 and the Homebridge plugin settings UI. It does not use analytics, tracking, post-install system modifications, or legacy ZONT API endpoints.

## Requirements

- Homebridge `^2.0.0`
- Node.js `^22.12.0`, `^24.0.0`, or `^26.0.0` (use the latest security-patched release of your LTS line)
- ZONT account with access to supported heating devices
- ZONT Widget API v3 access
- Updated Apple Home architecture; Apple TV/HomePod is needed for remote access, shared control and Home notifications

## Features

- Custom Homebridge settings page.
- ZONT token generation from login/password via `POST /authtokens`, with an ephemeral TOTP/backup-code field for accounts using 2FA.
- Device discovery via `GET /devices?fields=circuits&fields=modes&fields=sensors`.
- Per-device and per-circuit selection.
- HomeKit `Thermostat` creation for selected circuits: `HEAT` for heating and `COOL` for cooling.
- Optional HomeKit `TemperatureSensor` and `HumiditySensor` creation for selected ZONT sensors, including `StatusFault`/`StatusActive` derived from the ZONT sensor status.
- Target temperature write-back via `POST /devices/{device_id}/circuits/{entity_id}/actions/target-temp`, with the server-confirmed value returned to HomeKit (including ZONT rounding).
- Dynamic HomeKit target temperature `min`, `max`, and `step` from ZONT circuit data.
- Target writes require both reliable ordered bounds; missing/equal bounds expose a read-only target, while contradictory bounds make the target unavailable without affecting valid current-temperature readings.
- Dependent circuits (`is_dependent`) are exposed as read-only thermostats; write attempts are rejected.
- Boiler errors reported by ZONT are logged.
- Technical circuits (`boiler`, `dhw`) are not selected by default.
- Accessory name format can be either `Device - Circuit` or `Circuit only`.
- Unavailable/stale readings fail HomeKit reads instead of fabricating temperatures or reporting an offline thermostat as off.
- Per-circuit serialized writes, protection against late poll responses, bounded polling backoff and `Retry-After` handling.
- Preserves Child Bridge settings and selected accessories during partial discovery/cloud outages.
- Aligned with ZONT Widget API v3 schema **26.11.2** (18 November 2026).

## Compatibility and Scope

The plugin publishes **HAP/HomeKit accessories**, not Matter accessories. Homebridge 2's Matter support does not automatically convert this plugin. The existing HAP services remain appropriate for iOS 27; the Home app's new AI/video features do not require changes to this thermostat integration. See [Homebridge Integration](docs/homebridge-integration.md) for official sources and limitations.

Thermostat mode enable/disable, heating-mode presets, temporary modes, battery reporting and binary alarm/contact sensors are not implemented. Do not rely on a cloud polling plugin as a primary heating safety controller or alarm system.

## Installation

Install from the Homebridge UI Plugins page by searching for:

```text
homebridge-zont-thermostat
```

Or install with npm in your Homebridge environment:

```bash
npm install -g homebridge-zont-thermostat
```

Restart Homebridge after installation.

Platform-specific notes are available in [Synology Deployment](docs/synology-deployment.md).

## Configuration

Open the plugin settings in Homebridge UI.

1. Fill `Client Email (X-ZONT-Client)`.
2. Fill ZONT `Login` and `Password`.
3. If 2FA is enabled, enter a current TOTP code or a backup code, then click `Get Token by Login/Password`.
4. Click `Load Devices and Circuits`.
5. Select devices and circuits to expose to HomeKit.
6. Optionally select temperature and humidity sensors to expose to HomeKit.
7. Choose accessory naming mode.
8. Click the standard Homebridge `Save` button.
9. Restart Homebridge when prompted.

After successful token generation, login/password are cleared from the draft. The 2FA code is never saved and is cleared after every attempt. ZONT can notify the account owner by push/email for every issued token. Token generation and discovery buttons are locked while a request is running. Save with Homebridge's standard button to persist the new token.

The token remains a secret stored in Homebridge's configuration and backups, not an encrypted vault. Protect those files and access to Homebridge UI.

## Config Example

```json
{
  "platform": "ZontPlatform",
  "name": "ZONT",
  "clientEmail": "user@example.com",
  "token": "zont-token",
  "pollInterval": 30,
  "accessoryNameMode": "circuit_only",
  "selectedDevices": [
    {
      "id": 123456,
      "includeAll": false,
      "includeCircuitIds": [1111, 2222]
    }
  ],
  "selectedSensors": [
    {
      "deviceId": 123456,
      "sensorIds": [3333, 4444]
    }
  ]
}
```

## Configuration Fields

- `platform`: must be `ZontPlatform`.
- `name`: display name for the platform.
- `clientEmail`: value for the required ZONT `X-ZONT-Client` header.
- `login`: optional after token is saved; used to create a token.
- `password`: optional after token is saved; used to create a token.
- `token`: ZONT API token.
- `pollInterval`: integer seconds, default 30. Runtime is clamped to 10–300 seconds; non-finite values fall back to 30. The UI rejects invalid values.
- `accessoryNameMode`: `device_and_circuit` or `circuit_only`.
- `selectedDevices`: selected ZONT devices and circuits.
- `selectedSensors`: selected ZONT temperature and humidity sensors.

## Sensor Selection

The custom settings UI shows supported ZONT sensors after device discovery. Devices that only have sensors (no heating circuits) are included so their sensors can be selected. The plugin can expose:

- `temperature` sensors as HomeKit `TemperatureSensor` accessories.
- `humidity` sensors as HomeKit `HumiditySensor` accessories.

ZONT sensor IDs may be signed integers, including negative IDs and `0`; their sign is preserved in discovery, selection and accessory identity. Version 0.2.0 incorrectly filtered negative IDs before display; the 0.2.1 fix restores support without changing existing UUIDs.

Outdoor sensors are recommended by name only when the sensor name contains `Улица`, `outdoor`, or `outside`, and only on first discovery if no sensor selection was saved. Explicitly empty selections are respected on subsequent discoveries. Internet weather sensors such as `Погода из интернета` are optional and are not selected by default.

Only temperature and humidity are currently implemented. HomeKit does have standard services for opening/contact, motion, leakage and smoke; adding them requires verifying ZONT trigger semantics and is a future feature, not an API limitation.

The UI stores explicit circuit IDs for new selections: selecting every visible circuit does not automatically include future circuits. Advanced JSON configuration may opt into `includeAll: true`. Previously selected IDs absent from discovery are retained. To permanently remove a missing device/sensor, edit its selection in JSON; temporarily missing cloud data does not delete accessories or their automations.

## Availability and Commands

- Cached accessories have safe read/write handlers immediately at startup, before discovery succeeds.
- Network/API failures, device offline state, circuit `failure`, unknown/failed sensor status, absent/non-finite/out-of-range readings and stale snapshots produce a HomeKit communication error for affected readings.
- Sensor `StatusActive`/`StatusFault` also reflect availability. Freshness expires after three configured poll intervals; last values may be retained internally for diagnosis, but are not returned as current readings.
- Selected accessories omitted by ZONT are retained as unavailable. Explicit deselection removes them after a successful synchronization.
- Poll failures increase the retry delay exponentially up to 30 minutes. `Retry-After` is honored within the same bound. A successful poll resets backoff.
- Writes are serialized per circuit; their shared eight-second budget includes queue waiting and any confirmation read. A late pre-command poll is discarded. Commands are never automatically retried after uncertain delivery.
- A target change puts ZONT into manual temperature mode and can replace a ZONT heating preset. The returned server target, not a local optimistic value, is authoritative. If confirmation is unavailable, the write fails and the accessory is marked unavailable until a good poll.
- If a successful ZONT response makes the target read-only (dependency or incomplete limits), the outstanding HomeKit write returns a read-only error while retaining the confirmed reading. This prevents HAP from overwriting it with the requested value; do not retry an already delivered command.

## Dependent Circuits

Some ZONT circuits are dependent (`is_dependent`): their target temperature is inherited from a master circuit and cannot be changed directly. The plugin still exposes these circuits as thermostats so you can read their state, but the target temperature is read-only in HomeKit and any write attempt is rejected. Dependent circuits are marked in the settings UI.

## Network Access

The plugin requires network access to communicate with the official ZONT Widget API v3:

```text
https://my.zont.online/api/widget/v3
```

Network requests are limited to ZONT API operations needed for setup, discovery, polling, and thermostat control:

- `POST /authtokens` to create a ZONT API token from login/password.
- `GET /devices` to discover devices and read circuit state.
- `POST /devices/{device_id}/circuits/{entity_id}/actions/target-temp` to change target temperature.

The API base URL is fixed in the plugin code. Users cannot configure an arbitrary remote endpoint. ZONT login, password, token, and `X-ZONT-Client` email are only used for requests to the ZONT API. The plugin does not use analytics, tracking, telemetry, or third-party services.

## Troubleshooting

### Plugin UI Shows Manual Config Instead Of Custom UI

Check package/schema discovery in the Homebridge environment:

```bash
node -e "const fs=require('fs'); const p=require.resolve('homebridge-zont-thermostat/package.json'); console.log(p); console.log(fs.existsSync(p.replace('package.json','config.schema.json')));"
```

Expected output includes the package path and `true`.

### Missing `@homebridge/plugin-ui-utils`

Run inside the plugin directory:

```bash
npm install --omit=dev
```

### `No loaded plugin could be found for the name`

This means the plugin name used for accessory registration does not match `package.json.name`. For this package, both must use `homebridge-zont-thermostat`.

### HomeKit Invalid Name Warning

ZONT circuit names may contain trailing or duplicate spaces. The plugin trims and normalizes accessory names before exposing them to HomeKit.

### ZONT Network Errors

Network errors are logged with operation and low-level cause when Node provides it, for example DNS or connection reset information.

## Development

This project is plain CommonJS JavaScript.

Install dependencies:

```bash
npm ci
```

Run syntax checks:

```bash
npm run lint
```

Run automated tests:

```bash
npm test
```

Run all local checks:

```bash
npm run check
```

Coverage with enforced thresholds:

```bash
npm run test:coverage
```

Tests include the real HAP-NodeJS 2.3.0 API and the actual settings HTML executed in jsdom, not only hand-written mocks. See [Testing](docs/testing.md) for coverage scope and manual checks.

The test suite includes a live ZONT Widget API v3 discovery smoke-test. It is skipped unless credentials are provided through environment variables:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" npm test
```

Optionally limit the live smoke-test to one device:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" ZONT_DEVICE_ID="123456" npm test
```

Do not commit ZONT credentials or tokens.

Check package contents before publishing:

```bash
npm pack --dry-run
```

## Homebridge Verified Readiness

The plugin is designed to follow Homebridge Verified requirements:

- dynamic platform plugin,
- Homebridge plugin settings GUI,
- Node.js 22, 24 and 26 support,
- no analytics or tracking,
- no post-install scripts that modify the user's system,
- no required TTY or non-standard Homebridge startup parameters,
- runtime errors are caught and logged by the plugin.

## Documentation

- [Architecture](docs/architecture.md)
- [ZONT API v3 Mapping](docs/zont-api-v3.md)
- [Homebridge Integration](docs/homebridge-integration.md)
- [Testing](docs/testing.md)
- [Synology Deployment](docs/synology-deployment.md)
- [Release Checklist](docs/release-checklist.md)

## License

MIT
