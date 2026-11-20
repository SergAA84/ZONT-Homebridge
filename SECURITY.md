# Security Policy

## Supported Versions

Only the latest published version is supported with security fixes.

## Reporting a Vulnerability

Do not open a public issue for security vulnerabilities.

Report vulnerabilities through GitHub private vulnerability reporting when enabled for this repository, or contact the maintainer through GitHub.

Please include:

- affected plugin version,
- Homebridge and Node.js versions,
- a clear description of the issue,
- reproduction steps when safe to share.

## Data Handling

The plugin stores ZONT tokens and any manually retained login/password in the user's Homebridge configuration and its backups. These are not encrypted-vault entries. Restrict filesystem permissions, secure Homebridge UI access and backups, and revoke exposed tokens in ZONT.

The custom UI sends a TOTP/backup code only for token issuance. It never saves it to config, clears it after every attempt, and clears login/password from the draft after successful issuance. Press Homebridge Save to persist the new token/credential removal. ZONT can notify the account owner of each token issuance.

Outbound requests use a fixed official HTTPS origin, reject redirects, have whole-body timeouts and are cancelled on runtime shutdown. The plugin does not include analytics, user tracking, arbitrary remote endpoint configuration or an inbound webhook listener. Do not enable live tests in untrusted pull requests or commit credentials/live payloads.

Cloud command timeouts can leave delivery uncertain; the plugin never retries a control POST automatically. This bridge is not a primary heating safety controller or a life-safety alarm system.
