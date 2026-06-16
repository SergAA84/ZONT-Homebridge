# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [0.1.2] - 2026-06-16

- Added optional HomeKit temperature and humidity sensor accessories for selected ZONT sensors.
- Added sensor selection to the custom Homebridge settings UI.
- Recommended outdoor sensors by name (`Улица`, `outdoor`, `outside`) while leaving internet weather sensors optional.
- Fixed ZONT Widget API v3 `fields` query formatting to request multiple fields correctly.
- Added network access documentation for security scanners and users.
- Reduced npm package size by removing unused logo assets.
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
