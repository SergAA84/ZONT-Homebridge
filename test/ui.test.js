const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ui = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');

test('custom UI contains controls and persists all supported selections', () => {
  for (const id of ['clientEmail', 'login', 'password', 'token', 'pollInterval', 'accessoryNameMode', 'devicesContainer', 'sensorsContainer']) {
    assert.match(ui, new RegExp(`id="${id}"`));
  }

  assert.match(ui, /homebridge\.request\('\/auth-token'/);
  assert.match(ui, /homebridge\.request\('\/discover'/);
  assert.match(ui, /selectedDevices: collectSelectedDevices\(\)/);
  assert.match(ui, /selectedSensors: collectSelectedSensors\(\)/);
  assert.match(ui, /escapeHtml\(sensor\.name\)/);
});

test('custom UI validates displayed polling interval in browser controls', () => {
  assert.match(ui, /id="pollInterval"[^>]*min="10"[^>]*max="300"/);
  assert.match(ui, /Number\.isInteger\(pollInterval\)/);
});
