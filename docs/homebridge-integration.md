# Homebridge Integration

## Package Metadata

Homebridge package name:

```json
{
  "name": "homebridge-zont-thermostat",
  "engines": {
    "node": "^22.12.0 || ^24.0.0",
    "homebridge": "^2.0.0"
  }
}
```

The package must include keyword:

```json
"homebridge-plugin"
```

## Platform Alias

The platform alias is:

```text
ZontPlatform
```

Runtime config blocks must include:

```json
{
  "platform": "ZontPlatform"
}
```

## Config Schema

`config.schema.json` must be at package root.

Important fields:

```json
{
  "pluginAlias": "ZontPlatform",
  "pluginType": "platform",
  "singular": true,
  "strictValidation": false,
  "customUi": true
}
```

Homebridge UI 5 / Homebridge 2 is stricter about schema validity. Required fields must be declared at object schema level:

```json
"required": ["name", "clientEmail", "token"]
```

Do not use `required: true` inside individual property definitions.

## Custom UI

Required files:

```text
homebridge-ui/public/index.html
homebridge-ui/server.js
```

Server dependency:

```json
"@homebridge/plugin-ui-utils": "^2.0.1"
```

Dependencies are installed automatically by npm/Homebridge UI during normal installation. For local development, run:

```bash
npm install --omit=dev
```

If dependencies are missing, the custom UI server will fail with:

```text
Cannot find module '@homebridge/plugin-ui-utils'
```

## Custom UI Flow

The settings UI uses Homebridge's standard `Save` button.

The custom UI stages changes with:

```js
homebridge.updatePluginConfig(configBlocks)
```

It does not call `homebridge.savePluginConfig()` directly.

## HomeKit Service Mapping

Each selected ZONT circuit becomes one HomeKit `Service.Thermostat`.

Characteristics:

- `Name`: normalized circuit/accessory name.
- `CurrentTemperature`: ZONT `actual_temp`.
- `TargetTemperature`: ZONT `target_temp`; writes to ZONT target-temp action.
- `CurrentHeatingCoolingState`: `HEAT` when circuit is active, otherwise `OFF`.
- `TargetHeatingCoolingState`: currently fixed to `HEAT`.

Target temperature props:

- `minValue`: ZONT `min`, fallback `5`.
- `maxValue`: ZONT `max`, fallback `35`.
- `minStep`: ZONT `step`, fallback `0.5`.

## Known Design Choice

HomeKit `TargetHeatingCoolingState.OFF` is not currently exposed. The plugin controls only target temperature, not circuit enable/disable state.

## Common Homebridge 2 Issues

### Manual Config Instead Of Custom UI

Cause: Homebridge UI cannot find package schema.

Check:

```bash
node -e "const fs=require('fs'); const p=require.resolve('homebridge-zont-thermostat/package.json'); console.log(p); console.log(fs.existsSync(p.replace('package.json','config.schema.json')));"
```

Expected: `true`.

### Accessory Registration Warning

Warning:

```text
A platform configured a new accessory under the plugin name '<wrong-plugin-name>'. However no loaded plugin could be found for the name!
```

Cause: registration plugin name does not match package name.

Fix: `PLUGIN_NAME` must be `homebridge-zont-thermostat`.
