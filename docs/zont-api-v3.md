# ZONT API v3 Mapping

## Base URL

```text
https://my.zont.online/api/widget/v3
```

The plugin intentionally uses Widget API v3 only.

## Authentication

Supported methods from ZONT API v3:

- Basic Auth: login/password.
- Token Auth: `X-ZONT-Token` header.

All requests include:

```text
X-ZONT-Client: <clientEmail>
```

## Token Creation

Endpoint:

```http
POST /authtokens
Authorization: Basic base64(login:password)
Content-Type: application/json
X-ZONT-Client: <clientEmail>

{
  "client_name": "Homebridge ZONT Plugin UI"
}
```

The response token is stored in Homebridge config and used at runtime.

## Device Discovery

Endpoint:

```http
GET /devices?fields=circuits&modes&sensors&connection
X-ZONT-Token: <token>
X-ZONT-Client: <clientEmail>
```

The plugin requests these fields:

```text
circuits,modes,sensors,connection
```

Currently only `circuits` and basic device fields are used by HomeKit runtime. The extra fields are requested to keep UI/runtime ready for future features.

## Circuit Model

ZONT `Circuit` fields used:

- `id`: HomeKit accessory identity and write target.
- `name`: accessory display name.
- `type`: circuit type and technical circuit detection.
- `actual_temp`: HomeKit `CurrentTemperature`.
- `target_temp`: HomeKit `TargetTemperature`.
- `current_mode`: stored internally for future mode support.
- `active`: HomeKit heating state.
- `is_off`: forces HomeKit current heating state to `OFF`.
- `in_summer_mode`: forces HomeKit current heating state to `OFF`.
- `min`: HomeKit target temperature minimum.
- `max`: HomeKit target temperature maximum.
- `step`: HomeKit target temperature step.
- `status`: fallback state information.

## Target Temperature Write

Endpoint:

```http
POST /devices/{device_id}/circuits/{entity_id}/actions/target-temp
X-ZONT-Token: <token>
X-ZONT-Client: <clientEmail>
Content-Type: application/json

{
  "target_temp": 21.5
}
```

ZONT API notes:

- Sets the circuit to manual target temperature mode.
- Waits for device confirmation.
- Returns an error immediately if device is offline.

## Technical Circuits

The plugin marks these circuit types as technical by default:

- `boiler`
- `dhw`

These circuits are visible in the settings UI but not selected by default.

Circuit types `consumer` and `cooling` are not considered technical by default.

## Error Handling

ZONT API errors are expected as:

```json
{
  "ok": false,
  "error": "device_is_offline",
  "error_ui": "Устройство не на связи"
}
```

The plugin logs `error_ui` when present, otherwise `error`.

Network errors are wrapped with operation name, for example:

```text
Network error during GET /devices: fetch failed (ECONNRESET)
```
