const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');
const schema = require('../config.schema.json');
const settings = require('../lib/settings');

test('package metadata follows Homebridge plugin requirements', () => {
  assert.equal(packageJson.name, settings.PLUGIN_NAME);
  assert.match(packageJson.name, /^(@[^/]+\/)?homebridge-/);
  assert.equal(packageJson.homebridge.pluginAlias, settings.PLATFORM_NAME);
  assert.equal(packageJson.homebridge.pluginType, 'platform');
  assert.equal(packageJson.homebridge.singular, true);
  assert.ok(packageJson.keywords.includes('homebridge-plugin'));
  assert.equal(packageJson.engines.homebridge, '^2.0.0');
  assert.match(packageJson.engines.node, /22/);
  assert.match(packageJson.engines.node, /24/);
  assert.equal(packageJson.scripts.postinstall, undefined);
});

test('config schema matches Homebridge platform alias and custom UI', () => {
  assert.equal(schema.pluginAlias, settings.PLATFORM_NAME);
  assert.equal(schema.pluginType, 'platform');
  assert.equal(schema.singular, true);
  assert.equal(schema.customUi, true);
  assert.ok(schema.schema.required.includes('clientEmail'));
  assert.ok(schema.schema.required.includes('token'));
  assert.equal(schema.schema.properties.selectedSensors.type, 'array');
});
