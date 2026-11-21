# Testing

## Reproducible checks

```bash
npm ci
npm run check
npm run test:coverage
npm audit
npm pack --dry-run --ignore-scripts
git diff --check
```

`npm run lint` is a **syntax check**, not a semantic ESLint ruleset. It checks JavaScript recursively in source/test/tool directories and compiles inline scripts from the settings HTML without executing them. `npm test` uses Node's built-in test runner.

The lock file is committed and matches the package version. CI uses `npm ci`, not `npm install`. jsdom stays on the 27.x line deliberately: newer majors require newer Node patches than the declared minimum Node 22.12.0. It is development-only, not shipped as a runtime dependency. Update compatible dependencies and audit the lock when changing the supported Node baseline.

## Test layers

| Suite | Coverage |
| --- | --- |
| `zontClient.test.js`, `clientSafety.test.js` | API mapping, ID/response validation, TOTP/backup strings, strict HTTP/`ok`, machine errors, `Retry-After`, whole-body timeout, cancellation, no automatic POST retries |
| `platform.test.js`, `platformRuntime.test.js` | Selection, naming, runtime lifecycle, add/remove/migrate, timers and shutdown with lightweight mocks |
| `hapIntegration.test.js` | **Real HAP-NodeJS 2.3.0** services, `api.hap.Perms`, write responses, dependent targets, COOL/HEAT migration, safe startup restoration, freshness, offline/null values, late polls, write queues and shutdown |
| `uiDiscovery.test.js` | Shared auth/discovery validation and sensor-only devices |
| `uiRuntime.test.js` | Actual HTML script in a **jsdom DOM**, with mocked Homebridge IPC: `_bridge`/unknown field preservation, partial discovery, opt-out, explicit circuit IDs, ephemeral 2FA, duplicate-click prevention, draft ordering/failure recovery, Save gating and escaping |
| `uiServer.test.js` | Real UI-utils server class/routes and error wrapping with mocked IPC/fetch |
| `package.test.js`, `ui.test.js` | Package/schema/docs/lock consistency and static UI contract |
| `zontLive.test.js` | Optional read-only real ZONT discovery |

Important regressions: do not add `Perms` to a fake `Characteristic` class. It belongs to the HAP module. A fake-only suite previously concealed a production failure despite very high line coverage. Real DOM clicks with delayed config IPC verify synchronous discovery locking and preservation of pending deselection. Real HAP tests cover independently absent, equal and contradictory limits, preserving known constraints and disallowing unsafe commands while keeping valid readings available. Actual `handleSetRequest()` tests, including queued writes, verify that a read-only transition during a command cannot cache or emit the unconfirmed requested setpoint after server rounding.

Signed entity-ID regressions exercise raw ZONT response → discovery → actual sensor-selection DOM → saved config → restored/new real-HAP accessory. Negative outdoor readings are distinct from negative IDs; both must be preserved. Device-ID validation remains separate, and signed circuit commands, explicit deselection and temporary snapshot absence are covered.

The field-filter regression simulates the live server returning circuits but omitting `sensors` when `fields` is repeated. It uses the actual HTTP client for both settings discovery and runtime polling, and checks that one comma-separated filter keeps a configured temperature sensor discoverable and readable.

## Coverage scope

`npm run test:coverage` measures `lib/**` and the UI server, excluding dependencies/tests/tool scripts. It enforces **95% lines, 90% branches and 95% functions**. The browser HTML is executed behaviorally by DOM tests but is not included in the numeric V8 file-coverage totals. Do not describe the percentage as whole-project or device-level coverage.

The exact count/percentages are printed by each run; avoid hard-coding test counts into release assertions. Missing dependency/startup-failure branches are defensive, and passing coverage does not replace checking correct API contracts or behavior.

## Node matrix

CI checks Node **22.12.0**, **22.x**, **24.x** and **26.x** on Linux; coverage and npm package inspection run on Node 24. Local checks also exercise Windows. Node 22.12 may print the expected experimental CommonJS/ESM interop warning; prefer current patched LTS releases for deployment.

No live credentials are configured in public CI. All normal HTTP/IPC tests are mocked and do not control real heating hardware.

## Optional live discovery

Only enable this with an account you are authorized to inspect. It reads state and does not change setpoints or issue tokens.

POSIX shell:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" node --test test/zontLive.test.js
```

PowerShell:

```powershell
$env:ZONT_CLIENT_EMAIL = 'user@example.com'
$env:ZONT_TOKEN = 'token'
node --test test/zontLive.test.js
```

Optional `ZONT_DEVICE_ID` limits discovery. `ZONT_LOGIN`/`ZONT_PASSWORD` provide a Basic Auth alternative, but token auth is preferred. Do not commit credentials, terminal captures or live payloads. Runtime token issuance 2FA is tested with mocks; real 2FA should be checked manually.

## Required manual release checks

1. Install the packed plugin into a separate Homebridge environment with HAP enabled, open settings and verify Save behavior.
2. Generate a token with and without 2FA where applicable; check invalid codes, credential clearing and notification behavior. Reuse tokens rather than issuing them repeatedly.
3. Configure Child Bridge, edit plugin settings and verify `_bridge` and the disabled state survive.
4. Pair through updated Apple Home; verify current/target values, server-rounded writes, COOL/HEAT and dependent read-only rendering.
5. Test a ZONT outage at startup and after valid readings, recovery/backoff, missing sensors and explicit deselection. Verify rooms/automations are not lost on transient absence.
6. Exercise rapid setpoint changes, shutdown while a command is pending, Siri and automations. Confirm no unintended preset/on-off changes beyond the documented manual-target command.
7. Check there are no invalid-service/permission warnings. Slow cloud responses may still produce HAP's slow-handler warning; commands must finish/fail within the bounded budget.

Do not claim these real-device checks passed solely because unit/integration tests are green.
