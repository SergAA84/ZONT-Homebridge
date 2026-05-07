# Testing

The project uses the built-in Node.js test runner and has no test framework dependency.

## Commands

Syntax checks:

```bash
npm run lint
```

Automated tests:

```bash
npm test
```

All local checks:

```bash
npm run check
```

Package dry-run:

```bash
npm pack --dry-run
```

Publish dry-run:

```bash
npm publish --dry-run
```

## Test Coverage

Current automated tests cover:

- Homebridge package metadata requirements.
- `config.schema.json` platform alias and custom UI flags.
- ZONT device/circuit mapping.
- Technical circuit detection for `boiler` and `dhw`.
- Widget API v3 request construction for device discovery.
- Official Widget API v3 `target-temp` action request construction.
- Token creation request construction through `POST /authtokens`.
- ZONT API error handling.
- HomeKit accessory name normalization.
- Selected device/circuit normalization.
- Heating state calculation.
- Target temperature clamping and bounds normalization.
- Optional live ZONT Widget API v3 discovery smoke-test.

## Live ZONT API Smoke-Test

The live test is skipped unless credentials are provided through environment variables. This keeps CI safe and avoids storing secrets in the repository.

Token auth:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" npm test
```

Basic auth:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_LOGIN="login" ZONT_PASSWORD="password" npm test
```

Limit discovery to one device:

```bash
ZONT_CLIENT_EMAIL="user@example.com" ZONT_TOKEN="token" ZONT_DEVICE_ID="123456" npm test
```

Environment variables:

- `ZONT_CLIENT_EMAIL`: required ZONT `X-ZONT-Client` header.
- `ZONT_TOKEN`: preferred runtime auth token.
- `ZONT_LOGIN`: optional login for Basic Auth smoke-test.
- `ZONT_PASSWORD`: optional password for Basic Auth smoke-test.
- `ZONT_DEVICE_ID`: optional numeric device ID to validate discovery for one device.

Never commit real ZONT credentials, tokens, or `.env` files.

## CI

GitHub Actions runs on Node.js 22 and 24:

- `npm install`
- `npm run lint`
- `npm test`

The live ZONT API test is skipped in CI unless repository secrets are explicitly mapped to the required environment variables. Do not enable live API tests in public pull requests.
