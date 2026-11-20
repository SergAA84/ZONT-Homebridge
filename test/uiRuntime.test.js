const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const clone = (value) => JSON.parse(JSON.stringify(value));
const discovery = () => ({ devices: [{
  id: 1, name: 'House', online: true,
  circuits: [
    { id: 10, name: 'Room', typeLabel: 'consumer', recommendedInclude: true },
    { id: 11, name: 'Boiler', typeLabel: 'boiler', technical: true },
  ],
  sensors: [{ id: 20, name: 'Outdoor', type: 'temperature', supported: true, recommendedInclude: true, value: 12 }],
}] });

async function setup(config = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://homebridge.example.invalid/' });
  const window = dom.window;
  window.setTimeout = () => 1; // Explicit init, no timing-dependent fallback.
  let saved = [{ platform: 'ZontPlatform', name: 'ZONT', clientEmail: 'audit@example.invalid', token: 'test-token', pollInterval: 30, ...config }];
  const updates = [];
  const errors = [];
  let saveEnabled = true;
  const bridge = {
    addEventListener() {},
    getPluginConfig: async () => clone(saved),
    updatePluginConfig: async (value) => { saved = clone(value); updates.push(saved); },
    request: async () => discovery(),
    showSpinner() {}, hideSpinner() {},
    disableSaveButton() { saveEnabled = false; },
    enableSaveButton() { saveEnabled = true; },
    toast: { success() {}, error(message) { errors.push(message); } },
  };
  window.homebridge = bridge;
  window.eval(script + '\nwindow.hooks = { init, stageConfigDraft, onDiscover, onGetToken, state, collectSelectedDevices, collectSelectedSensors };');
  const hooks = window.hooks;
  await hooks.init();
  return {
    dom, window, bridge, hooks, updates, errors,
    el: (id) => window.document.getElementById(id),
    saved: () => saved[0], saveEnabled: () => saveEnabled,
  };
}

test('DOM UI preserves child bridge, disabled state, unrelated fields and config blocks', async (t) => {
  const f = await setup({ _bridge: { username: '0E:00:00:00:00:01', port: 12345 }, _disabled: true, customFutureOption: 'keep' });
  t.after(() => f.dom.window.close());
  f.bridge.getPluginConfig = async () => [f.saved(), { platform: 'AnotherPlatform', name: 'Other' }];
  f.el('platformName').value = 'New ZONT';
  await f.hooks.stageConfigDraft();
  const own = f.updates.at(-1).find((config) => config.platform === 'ZontPlatform');
  assert.deepEqual(own._bridge, { username: '0E:00:00:00:00:01', port: 12345 });
  assert.equal(own._disabled, true);
  assert.equal(own.customFutureOption, 'keep');
  assert.equal(own.name, 'New ZONT');
  assert.ok(f.updates.at(-1).some((config) => config.platform === 'AnotherPlatform'));
});

test('DOM UI recommends sensors once and respects complete opt-out on rediscovery', async (t) => {
  const f = await setup();
  t.after(() => f.dom.window.close());
  await f.hooks.onDiscover();
  let checkbox = f.window.document.querySelector('.sensor-check');
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  await f.hooks.stageConfigDraft();
  assert.deepEqual(f.saved().selectedSensors, [{ deviceId: 1, sensorIds: [] }]);
  await f.hooks.onDiscover();
  checkbox = f.window.document.querySelector('.sensor-check');
  assert.equal(checkbox.checked, false);
  assert.equal(f.errors.length, 0);
});

test('DOM UI does not re-recommend explicitly empty saved selections', async (t) => {
  const f = await setup({ selectedSensors: [] });
  t.after(() => f.dom.window.close());
  await f.hooks.onDiscover();
  assert.equal(f.window.document.querySelector('.sensor-check').checked, false);
});

test('DOM UI retains absent devices and entities when saving partial discovery', async (t) => {
  const f = await setup({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10, 99] }, { id: 2, includeAll: true, includeCircuitIds: [] }],
    selectedSensors: [{ deviceId: 1, sensorIds: [20, 99] }, { deviceId: 2, sensorIds: [30] }],
  });
  t.after(() => f.dom.window.close());
  await f.hooks.onDiscover();
  assert.deepEqual(f.saved().selectedDevices.find((item) => item.id === 1).includeCircuitIds.sort(), [10, 99]);
  assert.ok(f.saved().selectedDevices.some((item) => item.id === 2));
  assert.deepEqual(f.saved().selectedSensors.find((item) => item.deviceId === 1).sensorIds.sort(), [20, 99]);
  assert.ok(f.saved().selectedSensors.some((item) => item.deviceId === 2));
  f.bridge.request = async () => ({ devices: [] });
  await f.hooks.onDiscover();
  assert.ok(f.saved().selectedDevices.some((item) => item.id === 2));
});

test('DOM UI does not turn selecting all visible circuits into a future includeAll opt-in', async (t) => {
  const f = await setup();
  t.after(() => f.dom.window.close());
  await f.hooks.onDiscover();
  f.window.document.querySelector('.device-check').checked = true;
  f.window.document.querySelectorAll('.circuit-check').forEach((el) => { el.checked = true; });
  await f.hooks.stageConfigDraft();
  assert.deepEqual(f.saved().selectedDevices, [{ id: 1, includeAll: false, includeCircuitIds: [10, 11] }]);
});

test('DOM UI sends ephemeral 2FA, prevents duplicate token requests, and clears credentials', async (t) => {
  const f = await setup({ totp_code: 'old-code', totpCode: 'old-code' });
  t.after(() => f.dom.window.close());
  f.el('login').value = 'login';
  f.el('password').value = 'secret-password';
  f.el('totpCode').value = '012345';
  let resolve;
  let requests = 0;
  f.bridge.request = async (route, payload) => {
    requests += 1;
    assert.equal(route, '/auth-token');
    assert.equal(payload.totpCode, '012345');
    return new Promise((res) => { resolve = res; });
  };
  const pending = f.hooks.onGetToken();
  await f.hooks.onGetToken();
  assert.equal(requests, 1);
  assert.equal(f.el('getTokenBtn').disabled, true);
  resolve({ token: 'new-token' });
  await pending;
  assert.equal(f.el('totpCode').value, '');
  assert.equal(f.saved().password, '');
  assert.equal(f.saved().login, '');
  assert.equal(f.saved().token, 'new-token');
  assert.equal(f.saved().totpCode, undefined);
  assert.equal(f.saved().totp_code, undefined);
  assert.ok(!JSON.stringify(f.updates).includes('012345'));
});

test('DOM UI clears failed 2FA and restores request controls', async (t) => {
  const f = await setup();
  t.after(() => f.dom.window.close());
  f.el('totpCode').value = 'bad-code';
  f.bridge.request = async () => { throw new Error('Invalid 2FA code'); };
  await f.hooks.onGetToken();
  assert.equal(f.el('totpCode').value, '');
  assert.equal(f.el('getTokenBtn').disabled, false);
  assert.match(f.errors.at(-1), /2FA/);
});

test('DOM UI serializes drafts, skips stale reads, and recovers after staging failure', async (t) => {
  const f = await setup();
  t.after(() => f.dom.window.close());
  const originalRead = f.bridge.getPluginConfig;
  let release;
  let started;
  const reading = new Promise((resolve) => { started = resolve; });
  f.bridge.getPluginConfig = async () => {
    f.bridge.getPluginConfig = originalRead;
    started();
    return new Promise((resolve) => { release = resolve; });
  };
  f.el('platformName').value = 'Older';
  const older = f.hooks.stageConfigDraft();
  await reading;
  assert.equal(f.saveEnabled(), false);
  f.el('platformName').value = 'Newer';
  const newer = f.hooks.stageConfigDraft();
  release(await originalRead());
  await Promise.all([older, newer]);
  assert.equal(f.updates.length, 1);
  assert.equal(f.saved().name, 'Newer');
  assert.equal(f.saveEnabled(), true);
  const originalWrite = f.bridge.updatePluginConfig;
  f.bridge.updatePluginConfig = async () => { throw new Error('IPC failed'); };
  await assert.rejects(() => f.hooks.stageConfigDraft(), /IPC failed/);
  assert.equal(f.saveEnabled(), false);
  f.bridge.updatePluginConfig = originalWrite;
  await f.hooks.stageConfigDraft();
  assert.equal(f.saveEnabled(), true);
});

test('DOM UI rejects invalid polling values without enabling Save on a stale draft', async (t) => {
  const f = await setup();
  t.after(() => f.dom.window.close());
  for (const value of ['', '9', '301', '20.5']) {
    f.el('pollInterval').value = value;
    await assert.rejects(() => f.hooks.stageConfigDraft(), /whole number/);
    assert.equal(f.saveEnabled(), false);
  }
  assert.equal(f.updates.length, 0);
  f.el('pollInterval').value = '30';
  await f.hooks.stageConfigDraft();
  assert.equal(f.saveEnabled(), true);
});

test('DOM UI escapes untrusted labels and rejects malformed discovery without erasing selections', async (t) => {
  const f = await setup({ selectedSensors: [{ deviceId: 1, sensorIds: [20] }] });
  t.after(() => f.dom.window.close());
  f.bridge.request = async () => {
    const result = discovery();
    result.devices[0].sensors[0].name = '<img src=x onerror=alert(1)>';
    return result;
  };
  await f.hooks.onDiscover();
  assert.equal(f.el('sensorsContainer').querySelector('img'), null);
  assert.match(f.el('sensorsContainer').textContent, /<img/);
  f.bridge.request = async () => ({});
  await f.hooks.onDiscover();
  assert.match(f.errors.at(-1), /Invalid device/);
  assert.deepEqual(f.saved().selectedSensors, [{ deviceId: 1, sensorIds: [20] }]);
});

test('DOM UI locks selections before discovery IPC and preserves edits made just before the lock', async (t) => {
  const f = await setup({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
    selectedSensors: [{ deviceId: 1, sensorIds: [20] }],
  });
  t.after(() => f.dom.window.close());
  await f.hooks.onDiscover();
  const circuit = f.window.document.querySelector('.circuit-check');
  const sensor = f.window.document.querySelector('.sensor-check');
  const originalRead = f.bridge.getPluginConfig;
  let release;
  let started;
  const reading = new Promise((resolve) => { started = resolve; });
  f.bridge.getPluginConfig = async () => {
    f.bridge.getPluginConfig = originalRead;
    started();
    return new Promise((resolve) => { release = resolve; });
  };
  // Real DOM changes queue drafts; rediscovery must flush their current values.
  circuit.click();
  sensor.click();
  assert.equal(circuit.checked, false);
  assert.equal(sensor.checked, false);
  const discoveryRun = f.hooks.onDiscover();
  // The lock is synchronous, before its first configuration read/spinner await.
  assert.equal(circuit.disabled, true);
  assert.equal(sensor.disabled, true);
  assert.equal(f.window.document.querySelector('.device-check').disabled, true);
  assert.equal(f.el('pollInterval').disabled, true);
  await reading;
  circuit.click();
  sensor.click();
  assert.equal(circuit.checked, false, 'disabled controls must ignore clicks during the initial flush');
  assert.equal(sensor.checked, false);
  release(await originalRead());
  await discoveryRun;
  assert.equal(f.window.document.querySelector('.circuit-check').checked, false);
  assert.equal(f.window.document.querySelector('.sensor-check').checked, false);
  assert.deepEqual(f.saved().selectedDevices, [{ id: 1, includeAll: false, includeCircuitIds: [] }]);
  assert.deepEqual(f.saved().selectedSensors, [{ deviceId: 1, sensorIds: [] }]);
  assert.equal(f.errors.length, 0);
});

test('DOM UI keeps new discovery controls locked until staging completes and restores per-device disabled state', async (t) => {
  const f = await setup({ selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }] });
  t.after(() => f.dom.window.close());
  let release;
  let rendered;
  const staging = new Promise((resolve) => { rendered = resolve; });
  const originalWrite = f.bridge.updatePluginConfig;
  let writes = 0;
  f.bridge.updatePluginConfig = async (value) => {
    writes += 1;
    if (writes === 2) {
      rendered();
      await new Promise((resolve) => { release = resolve; });
    }
    await originalWrite(value);
  };
  f.bridge.request = async () => {
    const result = discovery();
    result.devices.push({ id: 2, name: 'Unselected', circuits: [{ id: 30, name: 'Room', recommendedInclude: true }], sensors: [] });
    return result;
  };
  const pending = f.hooks.onDiscover();
  await staging;
  f.window.document.querySelectorAll('.device-check, .circuit-check, .sensor-check').forEach((el) => {
    assert.equal(el.disabled, true);
  });
  assert.equal(f.saveEnabled(), false);
  release();
  await pending;
  assert.equal(f.window.document.querySelector('.device-check').disabled, false);
  assert.equal(f.window.document.querySelector('.circuit-check[data-device-id="1"]').disabled, false);
  assert.equal(f.window.document.querySelector('.circuit-check[data-device-id="2"]').disabled, true);
  assert.equal(f.window.document.querySelector('.sensor-check').disabled, false);
  assert.equal(f.saveEnabled(), true);
});
