# ZONT Widget API v3 mapping

Checked against official schema **26.11.2 (2026-11-18)**:
[OpenAPI source](https://my.zont.online/api/widget/v3/docs).

Base URL is fixed to `https://my.zont.online/api/widget/v3`. Redirects are rejected. The plugin does not use API v1/v2.

## Authentication and 2FA

All requests require `X-ZONT-Client: <clientEmail>`. Runtime uses `X-ZONT-Token`. Token creation uses HTTP Basic authentication:

```http
POST /authtokens
Content-Type: application/json
Authorization: Basic base64(login:password)
X-ZONT-Client: user@example.com

{
  "client_name": "Homebridge ZONT Plugin UI",
  "totp_code": "012345"
}
```

`totp_code` is optional only when the account has no 2FA. Since schema **26.11.1 (2026-11-09)**, 2FA-enabled accounts require a current TOTP or backup code to issue a token. The code is a string (leading zeros matter). The UI never persists it, and clears it after every attempt. Each issued token can generate a ZONT push/email notification. Existing token authentication does not require adding a code to polling requests.

Login/password are cleared from the draft after successful generation. Saving with Homebridge's standard Save persists the token; the token is not an encrypted vault entry.

## Discovery and state

```http
GET /devices?fields=circuits&fields=modes&fields=sensors
X-ZONT-Client: user@example.com
X-ZONT-Token: token
```

Array query arguments are repeated, not comma-joined. `connection` is a base device field and is not included in `fields`. `modes` is requested for discovery compatibility but mode activation is not implemented.

`devices` must be an array. Device IDs must be non-negative safe integers or digit strings. ZONT `EntityID` has no non-negative restriction: circuit and sensor IDs accept signed safe integers or signed integer strings, including negative IDs and `0`. Preserve their sign in selections, commands and accessory identity; do not silently discard negative sensor IDs as 0.2.0 did. Invalid device/circuit structures fail the refresh before reconciliation; invalid individual sensor IDs are ignored. Booleans, null/blank IDs, fractions, non-finite numbers and unsafe integers are rejected. Only `online === true` counts as online. Missing entity arrays mean no entities in that snapshot, not an instruction to delete selected accessories.

## Circuit mapping

| ZONT field | Use |
| --- | --- |
| `id`, `name`, `type` | Stable identity, display, heating/cooling service configuration |
| `actual_temp`, `target_temp` | HomeKit current/target temperature; missing/invalid values are unavailable |
| `min`, `max`, `step` | Explicit ordered distinct bounds allow writes; missing/equal bounds expose a read-only target; contradictory bounds invalidate it. Display-only fallback bounds never reverse or relax a supplied constraint. Step falls back to 0.5. |
| `active`, `is_off`, `in_summer_mode` | Current active state; `status: ok` alone is not proof of heating |
| `is_dependent` | Read-only target, blocked writes |
| `status` | `failure` makes the runtime unavailable and is logged even without error details |
| `error` | `{ oem, text }`, normalized as strings and logged |
| `current_mode`, `time_left` | Mapped diagnostics/future mode support; not exposed as controls |

Types `consumer`, `boiler`, `dhw` use `HEAT`; `cooling` uses `COOL`. Boiler/DHW circuits are technical and not recommended by default. Technical circuits can still be selected explicitly. There is no circuit on/off control. Offline is a communication error, not current state `OFF`.

## Target write

```http
POST /devices/{device_id}/circuits/{entity_id}/actions/target-temp
Content-Type: application/json
X-ZONT-Client: user@example.com
X-ZONT-Token: token

{"target_temp": 21.5}
```

This command puts the circuit into **manual target mode**, replacing its active preset. ZONT waits for device confirmation and returns an updated `device` (`{ ok, device }`). Apply only the changed circuit; do not reconcile accessory removal from a command response. If necessary, confirm using a scoped devices read for that device and `fields=circuits`.

The confirmed server target is returned to HAP through `WRITE_RESPONSE`, including any server rounding. If applying the response removes write-response permissions (new dependency or incomplete bounds), the outstanding HomeKit write fails read-only but the confirmed reading is retained; otherwise HAP would restore the requested value. This does not undo a delivered ZONT command and must not trigger a retry. Dependent circuits reject new writes locally. No POST is automatically retried. The runtime command budget is eight seconds including queue waiting and confirmation; uncertainty marks the circuit unavailable until polling recovers. A timeout does **not** prove the heating controller did not execute the command.

## Sensors

Implemented services: `temperature` → `TemperatureSensor`, `humidity` → `HumiditySensor`. Device online state, data age, a finite/in-range value, and sensor status all affect availability. Allowed ranges are -50…100 °C and 0…100 %; invalid values are unavailable, not clamped into fabricated readings. Humidity is rounded to whole percent.

ZONT statuses are `unknown`, `ok`, `failure`, `alarm`, `silent_alarm`. `unknown`, absent status and `failure` are unavailable; other listed statuses are valid readings. An alarm on a temperature sensor may indicate a threshold, not loss of the measurement. HomeKit `StatusActive` and `StatusFault` reflect effective availability.

`triggered`, `battery`, `rssi`, `signal_strength` and `limits` are mapped but not published as separate HomeKit functions. Signal strength accepts `no_signal`, `weak`, `fair`, `good`, `excellent`. The raw discovery data includes these fields; the current UI displays name/type/value/status, not a separate diagnostics panel.

Other ZONT sensor types are currently ignored. HomeKit has standard contact/motion/leak/smoke services, so these may be added after trigger semantics and hardware behavior are tested. Voltage, pressure, modulation and similar values do not have equivalent ordinary Apple Home sensor tiles.

## HTTP and error behavior

Successful requests require HTTP 2xx **and** JSON `ok: true`. Errors preserve HTTP status, machine code and a bounded `Retry-After` delay. JSON errors commonly include `error` and `error_ui`; response text/HTML and authorization headers are not logged.

The abort timer covers the whole response body read. Runtime requests use an eight-second timeout; UI requests default to 30 seconds. Shutdown cancels active runtime requests. Poll errors cause bounded exponential backoff, while commands are not retried. Malformed/incomplete snapshots cannot trigger accessory deletion.

## Changes since the previous project baseline

- **26.8.2:** `BoilerErrorReport.oem_code` may be a string (`A21`); that actuator model is not consumed by this plugin. Circuit errors already preserve strings.
- **26.11.1:** mandatory token-issuance 2FA when enabled, and issuance notifications; supported by the ephemeral code UI.
- **26.11.2:** numeric `readout` in `Status`/`ToggleButton`. These control models are not implemented, so this is not a breaking change to existing functions.
