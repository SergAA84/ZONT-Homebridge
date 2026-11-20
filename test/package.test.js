const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageJson = require('../package.json');
const schema = require('../config.schema.json');
const settings = require('../lib/settings');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

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
  assert.equal(packageJson.dependencies['@homebridge/plugin-ui-utils'], '^2.3.0');
  assert.ok(packageJson.keywords.includes('supports-hap'));
  assert.match(packageJson.engines.node, /26/);
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

test('installation is locked and package contains no duplicate logo asset', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../package-lock.json')), true);
  const lock = require('../package-lock.json');
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[''].version, packageJson.version);
  assert.equal(fs.existsSync(path.join(__dirname, '../assets/logo.png')), false);

  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
  assert.match(workflow, /run: npm ci/);
});

test('documentation describes the current query format and sensor accessories', () => {
  const apiDocumentation = fs.readFileSync(path.join(__dirname, '../docs/zont-api-v3.md'), 'utf8');
  const architecture = fs.readFileSync(path.join(__dirname, '../docs/architecture.md'), 'utf8');
  const integration = fs.readFileSync(path.join(__dirname, '../docs/homebridge-integration.md'), 'utf8');

  assert.match(apiDocumentation, /GET \/devices\?fields=circuits&fields=modes&fields=sensors/);
  assert.match(apiDocumentation, /https:\/\/my\.zont\.online\/api\/widget\/v3\/docs/);
  assert.match(architecture, /temperature and humidity sensors/);
  assert.match(integration, /Service\.TemperatureSensor/);
  assert.match(integration, /Service\.HumiditySensor/);
});

test('current custom UI dependency supports the server API used by the plugin', () => {
  assert.equal(typeof HomebridgePluginUiServer, 'function');
  assert.equal(typeof RequestError, 'function');
});

test('README images use portable absolute URLs backed by packaged local assets', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const imageUrls = [...readme.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1]);
  imageUrls.push(...[...readme.matchAll(/!\[[^\]]*\]\(([^\s)]+)/g)].map((match) => match[1]));
  assert.ok(imageUrls.length > 0);
  for (const source of imageUrls) {
    const url = new URL(source);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    const prefix = '/SergAA84/ZONT-Homebridge/main/';
    assert.ok(url.pathname.startsWith(prefix));
    const asset = url.pathname.slice(prefix.length);
    assert.ok(asset.startsWith('assets/'));
    assert.ok(packageJson.files.includes('assets'));
    assert.ok(fs.existsSync(path.join(__dirname, '..', asset)));
  }
});
