# Architecture

## Scope and modules

This is a CommonJS Homebridge 2 dynamic platform exposing HAP/HomeKit thermostats and temperature and humidity sensors. It uses only the official ZONT Widget API v3. No analytics, custom remote API URL, inbound webhook server or Matter transport is implemented.

| File | Responsibility |
| --- | --- |
| `index.js` / `lib/settings.js` | Platform registration and stable identity constants |
| `lib/zontClient.js` | Fixed-origin HTTP, authentication, cancellation, typed errors, validation and mapping |
| `lib/platform.js` | Restore/discovery/sync, polling/backoff, write queues and ordering |
| `lib/platformAccessory.js` | Real HAP services, permissions, availability, getters/setters |
| `lib/uiDiscovery.js` | Shared authentication and discovery helpers |
| `homebridge-ui/server.js` | UI-utils IPC wrapper; starts only when executed directly |
| `homebridge-ui/public/index.html` | Settings form, discovery, ephemeral 2FA and serialized config drafts |

## Lifecycle and availability

1. The constructor creates a client and installs shutdown handling even when unconfigured. Without client email/token it does not subscribe to launch/polling.
2. `configureAccessory()` immediately constructs runtime handlers for restored accessories. All start unavailable, so cached writable characteristics cannot silently accept local-only changes while ZONT is down.
3. After `didFinishLaunching`, a refresh is attempted and the polling interval starts. Concurrent polls are skipped.
4. A successful, validated snapshot builds selected accessories. New accessories are configured before registration. Information/context changes are persisted via `updatePlatformAccessories`.
5. Missing selected accessories are retained but marked unavailable; only explicit deselection removes them during successful synchronization. Malformed snapshots cannot be mistaken for an empty account.
6. Shutdown stops the timer, closes/aborts the client and prevents late command/poll responses from mutating accessories.

Polling uses a 10–300 second interval (default 30). On failure all runtime accessories become unavailable, and exponential backoff grows from one interval to at most 30 minutes, also honoring bounded `Retry-After`. A good poll resets backoff. Getters enforce an age limit of three configured intervals even if polling stops making progress.

Thermostats require an online device, a non-failed circuit and a fresh snapshot. Each temperature independently requires a finite, in-range reading. Sensor availability additionally requires status `ok`, `alarm` or `silent_alarm` and a valid current value. Unknown/missing/failure status is unavailable. Invalid/missing readings do not fall back to a setpoint or 20 °C. Humidity is rounded to whole percent. Sensor services expose `StatusActive` and `StatusFault`; `Thermostat` does not accept `StatusFault`.

## Commands and ordering

- Queues serialize writes per circuit. The eight-second AbortSignal budget starts at enqueue time and is shared by the POST and any confirmation GET.
- Every command start/finish increments a revision. Polls skip active writes and discard results (including errors) if their starting revision no longer matches. An old poll cannot overwrite newly confirmed state.
- A dependent circuit is blocked locally. Other writes require an available runtime and two explicit ordered distinct bounds. Missing/equal bounds leave a readable target read-only; contradictory bounds invalidate the target without swapping constraints. Display-only fallbacks preserve supplied limits and include a valid known setpoint. Bounds are rechecked when a queued command executes. There is no automatic command retry, because an interrupted response does not imply the device failed to act.
- Prefer the changed circuit in `{ ok, device }`. If absent, incomplete or for another device, do a scoped `GET /devices?device_ids=...&fields=circuits`, never a full accessory reconciliation.
- Apply the authoritative target and return it through HAP `WRITE_RESPONSE`. Never overwrite it with an optimistic request value after awaiting the server.
- Recheck `WRITE_RESPONSE` after the platform returns: a response can remove write permissions. In that case fail the outstanding HAP write with `READ_ONLY_CHARACTERISTIC`, retaining the confirmed reading, rather than let HAP cache/emit the requested value without write-response support.
- Failed/uncertain delivery marks that runtime unavailable. A later successful poll reconciles it. A shutdown response is never applied.

## HAP model and stable identity

Use the HAP object supplied by Homebridge; production does not import a second HAP copy. Permission constants are **`api.hap.Perms`**, not `Characteristic.Perms`.

UUID inputs must remain stable:

```text
homebridge-zont-thermostat-{deviceId}:{circuitId}
homebridge-zont-thermostat-sensor:{deviceId}:{sensorId}
```

Each accessory has `AccessoryInformation` with manufacturer `ZONT`, a model based on entity type, and a stable serial based on entity IDs. Heating circuits use `HEAT`, cooling circuits use `COOL`; the inactive current state is `OFF`, while offline is an error. Target enable/disable modes are not exposed. Dependent target temperature permissions are read/notify only.

Sensor type changes remove the old service and rebuild the runtime, including for restored accessories. Circuit type changes refresh information and heating/cooling constraints without changing the UUID. Names are whitespace-normalized; Apple Home may retain a user's paired name independently.

## Settings persistence and secrets

UI drafts are serialized with a version guard and failure recovery. A stale asynchronous read cannot overwrite a newer draft. Save remains disabled during staging, invalid polling input, failed staging or network actions. The form merges known changes into the latest existing config block, preserving `_bridge`, `_disabled`, unrelated options and other platform blocks.

Network actions synchronously lock all form/selection controls before their first await. Discovery then flushes the current selection before rerendering; newly rendered controls stay locked until staging finishes. Unlocking restores circuit availability according to its device checkbox, not a blanket enable. This prevents a pending deselection from being superseded by a stale rediscovery render. Missing entity IDs are retained. New UI circuit selections are explicit, not an implicit `includeAll` subscription; pre-existing advanced `includeAll` remains supported. Sensor recommendations apply only on first discovery without a saved selection; empty selections are meaningful opt-outs.

TOTP/backup codes are used only in the token request, never staged, and cleared after every attempt. A successful token request clears login/password from the draft. Tokens and any manually retained credentials remain secrets in Homebridge config/backups; protect those files.
