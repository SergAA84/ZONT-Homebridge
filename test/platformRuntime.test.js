const assert = require('node:assert/strict');
const test = require('node:test');

const { ZontPlatform } = require('../lib/platform');
const { ZontSensorAccessory, ZontThermostatAccessory } = require('../lib/platformAccessory');

test('platform registers, updates, renames, and removes selected accessories', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
    selectedSensors: [{ deviceId: 1, sensorIds: [20] }],
  });
  const platform = fixture.platform;
  platform.client.getDevices = async () => ({
    devices: [deviceFixture('House', 'Living Room')],
  });

  await platform.refreshAndSyncAccessories();

  assert.equal(fixture.registered.length, 2);
  assert.equal(platform.cachedAccessories.length, 2);
  const thermostat = platform.cachedAccessories.find((accessory) => accessory.context.accessoryType === 'thermostat');
  const sensor = platform.cachedAccessories.find((accessory) => accessory.context.accessoryType === 'sensor');
  assert.equal(thermostat.getService(fixture.Service.Thermostat).characteristics.get(fixture.Characteristic.Name).value, 'House - Living Room');
  assert.equal(sensor.getService(fixture.Service.HumiditySensor).characteristics.get(fixture.Characteristic.CurrentRelativeHumidity).value, 45);

  platform.config.accessoryNameMode = 'circuit_only';
  platform.client.getDevices = async () => ({ devices: [deviceFixture('Renamed House', 'Renamed Room')] });
  await platform.refreshAndSyncAccessories();

  assert.equal(thermostat.getService(fixture.Service.Thermostat).characteristics.get(fixture.Characteristic.Name).value, 'Renamed Room');

  platform.config.selectedDevices = [];
  platform.config.selectedSensors = [];
  await platform.refreshAndSyncAccessories();

  assert.equal(fixture.unregistered.length, 2);
  assert.equal(platform.cachedAccessories.length, 0);
});

test('sensor whose type changes is migrated to the correct service', async () => {
  const fixture = createPlatformFixture({
    selectedSensors: [{ deviceId: 1, sensorIds: [20] }],
  });
  const platform = fixture.platform;

  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [],
      sensors: [{ id: 20, name: 'Multi', type: 'temperature', value: 21, status: 'ok' }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  const accessory = platform.cachedAccessories.find((a) => a.context.accessoryType === 'sensor');
  assert.ok(accessory.getService(fixture.Service.TemperatureSensor));
  assert.equal(accessory.getService(fixture.Service.HumiditySensor), undefined);

  // ZONT reports the same sensor id but now as humidity.
  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [],
      sensors: [{ id: 20, name: 'Multi', type: 'humidity', value: 55, status: 'ok' }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  // Old service removed, new service present.
  assert.equal(accessory.getService(fixture.Service.TemperatureSensor), undefined);
  const humidity = accessory.getService(fixture.Service.HumiditySensor);
  assert.ok(humidity);
  assert.equal(humidity.characteristics.get(fixture.Characteristic.CurrentRelativeHumidity).value, 55);
});

test('sensor type migration works after restart when no runtime exists yet', async () => {
  const fixture = createPlatformFixture({
    selectedSensors: [{ deviceId: 1, sensorIds: [20] }],
  });
  const platform = fixture.platform;

  // Simulate a cached accessory restored by Homebridge after a restart: it
  // already carries the old TemperatureSensor service and context, but there is
  // no runtime yet.
  const restored = new fixture.api.platformAccessory('House - Multi', 'homebridge-zont-thermostat-sensor:1:20');
  restored.context.accessoryType = 'sensor';
  restored.context.deviceId = 1;
  restored.context.sensorId = 20;
  restored.context.sensorType = 'temperature';
  restored.context.key = 'sensor:1:20';
  restored.addService(fixture.Service.TemperatureSensor);
  platform.configureAccessory(restored);

  // ZONT now reports the same sensor id as humidity.
  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [],
      sensors: [{ id: 20, name: 'Multi', type: 'humidity', value: 60, status: 'ok' }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  assert.equal(restored.getService(fixture.Service.TemperatureSensor), undefined);
  assert.ok(restored.getService(fixture.Service.HumiditySensor));
});

test('circuit type change updates AccessoryInformation model on the next sync', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;

  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [{ id: 10, name: 'Loop', type: 'consumer', actual_temp: 20, target_temp: 22, min: 5, max: 30, step: 0.5, active: true }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  const accessory = platform.cachedAccessories.find((a) => a.context.accessoryType === 'thermostat');
  const info = accessory.getService(fixture.Service.AccessoryInformation);
  assert.equal(info.characteristics.get(fixture.Characteristic.Model).value, 'consumer');

  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [{ id: 10, name: 'Loop', type: 'cooling', actual_temp: 20, target_temp: 22, min: 5, max: 30, step: 0.5, active: true }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  assert.equal(info.characteristics.get(fixture.Characteristic.Model).value, 'cooling');
});

test('poll guard prevents concurrent refreshes and resets after an error', async () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const platform = fixture.platform;
  let resolveRequest;
  platform.client.getDevices = () => new Promise((resolve) => {
    resolveRequest = resolve;
  });

  const first = platform.refreshAndSyncAccessories();
  await platform.refreshAndSyncAccessories();
  assert.equal(fixture.logs.debug.length, 1);

  resolveRequest({ devices: [] });
  await first;
  assert.equal(platform.pollInProgress, false);

  platform.client.getDevices = async () => {
    throw new Error('offline');
  };
  await platform.refreshAndSyncAccessories();
  assert.equal(platform.pollInProgress, false);
  assert.match(fixture.logs.error.at(-1), /Poll failed: offline/);
});

test('thermostat clamps writes and reports HomeKit state', async () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Heating', 'thermostat');
  accessory.context.deviceId = 1;
  accessory.context.circuitId = 10;
  const calls = [];
  fixture.platform.setCircuitTargetTemperature = async (...args) => calls.push(args);
  const runtime = new ZontThermostatAccessory(fixture.platform, accessory);

  runtime.updateState({
    currentTemperature: 19.5,
    targetTemperature: 22,
    isHeating: true,
    online: true,
    minTargetTemperature: 10,
    maxTargetTemperature: 25,
    targetTemperatureStep: 1,
  });
  await runtime.handleSetTargetTemperature(30);

  assert.deepEqual(calls, [[1, 10, 25]]);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentHeatingCoolingState).value, 'HEAT');
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.TargetTemperature).props.maxValue, 25);
});

test('humidity sensor uses HumiditySensor service after type normalization', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Humidity', 'humidity');
  accessory.context.sensorType = 'humidity';
  const runtime = new ZontSensorAccessory(fixture.platform, accessory);

  runtime.updateState({ value: 150, status: 'ok', online: true });

  assert.equal(runtime.service.type, fixture.Service.HumiditySensor);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentRelativeHumidity).value.hapStatus, -70402);
});

test('dependent circuit exposes read-only target temperature and rejects writes', async () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Dependent', 'dependent');
  accessory.context.deviceId = 1;
  accessory.context.circuitId = 10;
  const calls = [];
  fixture.platform.setCircuitTargetTemperature = async (...args) => calls.push(args);
  const runtime = new ZontThermostatAccessory(fixture.platform, accessory);

  runtime.updateState({
    currentTemperature: 20,
    targetTemperature: 22,
    isHeating: true,
    online: true,
    minTargetTemperature: 10,
    maxTargetTemperature: 25,
    targetTemperatureStep: 1,
    dependent: true,
  });

  const perms = runtime.service.characteristics.get(fixture.Characteristic.TargetTemperature).props.perms;
  assert.ok(!perms.includes('pw'));

  await assert.rejects(() => runtime.handleSetTargetTemperature(21), (error) => error.hapStatus === -70404);
  assert.equal(calls.length, 0);
});

test('circuit failure does not add StatusFault to the Thermostat service (invalid per HAP)', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Faulty', 'faulty');
  accessory.context.deviceId = 1;
  accessory.context.circuitId = 10;
  const runtime = new ZontThermostatAccessory(fixture.platform, accessory);

  runtime.updateState({
    currentTemperature: 20,
    targetTemperature: 22,
    online: true,
    minTargetTemperature: 10,
    maxTargetTemperature: 25,
    targetTemperatureStep: 1,
  });

  // StatusFault is not an optional characteristic of the Thermostat service.
  assert.equal(runtime.service.characteristics.has(fixture.Characteristic.StatusFault), false);
});

test('sensor failure status maps to StatusFault and inactive', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Temp', 'temp');
  accessory.context.sensorType = 'temperature';
  const runtime = new ZontSensorAccessory(fixture.platform, accessory);

  runtime.updateState({ value: 12, status: 'failure', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusFault).value, 1);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusActive).value, false);

  runtime.updateState({ value: 12, status: 'ok', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusFault).value, 0);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusActive).value, true);
});

test('sensor does not publish a value or report active until a real measurement arrives', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Temp', 'temp-novalue');
  accessory.context.sensorType = 'temperature';
  const runtime = new ZontSensorAccessory(fixture.platform, accessory);

  // No value yet: status ok, but the sensor is not active and no CurrentTemperature is published.
  runtime.updateState({ value: null, status: 'ok', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusActive).value, false);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentTemperature).value.hapStatus, -70402);

  // First real measurement makes it active and publishes the value.
  runtime.updateState({ value: 18.4, status: 'ok', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.StatusActive).value, true);
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentTemperature).value, 18.4);
});

test('humidity sensor without a value is not published, and rounds once a value arrives', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Humidity', 'humidity-novalue');
  accessory.context.sensorType = 'humidity';
  const runtime = new ZontSensorAccessory(fixture.platform, accessory);

  runtime.updateState({ value: null, status: 'ok', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentRelativeHumidity).value.hapStatus, -70402);

  runtime.updateState({ value: 45.6, status: 'ok', online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentRelativeHumidity).value, 46);
});

test('thermostat does not publish CurrentTemperature until a real reading arrives', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const accessory = new fixture.api.platformAccessory('Heating', 'thermo-novalue');
  accessory.context.deviceId = 1;
  accessory.context.circuitId = 10;
  const runtime = new ZontThermostatAccessory(fixture.platform, accessory);

  // No actual temperature yet (offline / no sensor).
  runtime.updateState({ targetTemperature: 22, online: true, minTargetTemperature: 5, maxTargetTemperature: 35, targetTemperatureStep: 0.5 });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentTemperature).value.hapStatus, -70402);

  runtime.updateState({ currentTemperature: 19.5, targetTemperature: 22, online: true });
  assert.equal(runtime.service.characteristics.get(fixture.Characteristic.CurrentTemperature).value, 19.5);
});

test('onGet throws unavailable before the first measurement, then returns the value', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });

  const thermoAccessory = new fixture.api.platformAccessory('Heating', 'thermo-onget');
  thermoAccessory.context.deviceId = 1;
  thermoAccessory.context.circuitId = 10;
  const thermostat = new ZontThermostatAccessory(fixture.platform, thermoAccessory);
  const currentGetter = thermostat.service.getCharacteristic(fixture.Characteristic.CurrentTemperature).getter;

  assert.throws(() => currentGetter(), (error) => error.hapStatus === -70402);
  thermostat.updateState({ currentTemperature: 20.1, targetTemperature: 22, online: true });
  assert.equal(currentGetter(), 20.1);

  const sensorAccessory = new fixture.api.platformAccessory('Temp', 'temp-onget');
  sensorAccessory.context.sensorType = 'temperature';
  const sensor = new ZontSensorAccessory(fixture.platform, sensorAccessory);
  const sensorGetter = sensor.service.getCharacteristic(fixture.Characteristic.CurrentTemperature).getter;

  assert.throws(() => sensorGetter(), (error) => error.hapStatus === -70402);
  sensor.updateState({ value: 12.3, status: 'ok', online: true });
  assert.equal(sensorGetter(), 12.3);
});

test('setCircuitTargetTemperature applies device from command response without extra poll', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;
  platform.client.getDevices = async () => ({ devices: [deviceFixture('House', 'Living Room')] });
  await platform.refreshAndSyncAccessories();

  let refreshCalls = 0;
  const originalRefresh = platform.refreshAndSyncAccessories.bind(platform);
  platform.refreshAndSyncAccessories = async () => { refreshCalls += 1; return originalRefresh(); };

  platform.client.getDevices = async () => ({ devices: [deviceFixture('House', 'Living Room')] });
  platform.client.setCircuitTargetTemperature = async () => ({
    ok: true,
    device: {
      id: 1,
      name: 'House',
      online: true,
      circuits: [{ id: 10, name: 'Living Room', type: 'consumer', actual_temp: 19, target_temp: 24, min: 5, max: 30, step: 0.5, active: true, error: { oem: '08', text: 'no gas' } }],
    },
  });

  await platform.setCircuitTargetTemperature(1, 10, 24);

  assert.equal(refreshCalls, 0);
  const thermostat = platform.cachedAccessories.find((accessory) => accessory.context.accessoryType === 'thermostat');
  assert.equal(thermostat.getService(fixture.Service.Thermostat).characteristics.get(fixture.Characteristic.TargetTemperature).value, 24);
  // Boiler error surfaced in the command response is logged.
  assert.ok(fixture.logs.warn.some((line) => /Circuit error on House\/Living Room: \[08\] no gas/.test(line)));
});

test('setCircuitTargetTemperature confirms with a scoped read when the command omits the device', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;
  platform.client.getDevices = async () => ({ devices: [deviceFixture('House', 'Living Room')] });
  await platform.refreshAndSyncAccessories();

  const reads = [];
  platform.client.getDevices = async (options) => { reads.push(options); return { devices: [deviceFixture('House', 'Living Room')] }; };
  platform.client.setCircuitTargetTemperature = async () => ({ ok: true });

  await platform.setCircuitTargetTemperature(1, 10, 22);

  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].deviceIds, [1]);
  assert.deepEqual(reads[0].fields, ['circuits']);
  assert.ok(reads[0].signal instanceof AbortSignal);
});

test('setCircuitTargetTemperature rejects writes to a dependent circuit using cached state', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;
  let writeCalls = 0;

  // Poll once so the dependent flag is cached in runtime state.
  platform.client.getDevices = async () => ({
    devices: [{
      id: 1,
      name: 'House',
      online: true,
      circuits: [{ id: 10, name: 'Slave', type: 'consumer', is_dependent: true }],
    }],
  });
  await platform.refreshAndSyncAccessories();

  platform.client.setCircuitTargetTemperature = async () => { writeCalls += 1; return { ok: true }; };

  await assert.rejects(() => platform.setCircuitTargetTemperature(1, 10, 22), /is dependent/);
  assert.equal(writeCalls, 0);
});

test('setCircuitTargetTemperature writes without a pre-write device read', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;
  platform.client.getDevices = async () => ({ devices: [deviceFixture('House', 'Living Room')] });
  await platform.refreshAndSyncAccessories();

  let getDevicesCalls = 0;
  platform.client.getDevices = async () => { getDevicesCalls += 1; return { devices: [deviceFixture('House', 'Living Room')] }; };

  let writeArgs = null;
  platform.client.setCircuitTargetTemperature = async (...args) => {
    writeArgs = args;
    return {
      ok: true,
      device: {
        id: 1,
        name: 'House',
        online: true,
        circuits: [{ id: 10, name: 'Living Room', type: 'consumer', actual_temp: 19, target_temp: 22, min: 5, max: 30, step: 0.5, active: true }],
      },
    };
  };

  await platform.setCircuitTargetTemperature(1, 10, 22);

  // No extra getDevices round-trip; write applied straight from the command response.
  assert.equal(getDevicesCalls, 0);
  assert.deepEqual(writeArgs.slice(0, 3), [1, 10, 22]);
  assert.ok(writeArgs[3].signal instanceof AbortSignal);
});

test('unconfigured platform warns and does not schedule polling', () => {
  const fixture = createPlatformFixture({}, { clientEmail: '', token: '' });
  assert.ok(fixture.logs.warn.some((line) => /Plugin is not configured/.test(line)));
  assert.equal(fixture.events.has('didFinishLaunching'), false);
});

test('shutdown handler clears the polling timer', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const platform = fixture.platform;
  platform.startPolling();
  assert.notEqual(platform.pollTimer, null);

  fixture.events.get('shutdown')();
  assert.equal(platform.pollTimer, null);
});

test('shutdown stops in-flight polls from mutating accessories', async () => {
  const fixture = createPlatformFixture({
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
  });
  const platform = fixture.platform;

  let releaseRequest;
  platform.client.getDevices = () => new Promise((resolve) => { releaseRequest = resolve; });

  const pollPromise = platform.refreshAndSyncAccessories();
  // Shutdown fires while the network request is still pending.
  fixture.events.get('shutdown')();
  releaseRequest({ devices: [deviceFixture('House', 'Living Room')] });
  await pollPromise;

  // No accessories should have been registered after shutdown.
  assert.equal(fixture.registered.length, 0);
  assert.equal(platform.pollInProgress, false);
});

test('refreshAndSyncAccessories is a no-op once stopped', async () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const platform = fixture.platform;
  let calls = 0;
  platform.client.getDevices = async () => { calls += 1; return { devices: [] }; };

  platform.stopped = true;
  await platform.refreshAndSyncAccessories();

  assert.equal(calls, 0);
});

test('startPolling clamps the interval and rejects non-finite values', () => {
  const makeInterval = (pollInterval) => {
    const fixture = createPlatformFixture({ selectedDevices: [], pollInterval });
    let captured = null;
    const originalSetInterval = global.setInterval;
    global.setInterval = (fn, ms) => { captured = ms; return originalSetInterval(() => {}, 1e9); };
    try {
      fixture.platform.startPolling();
      clearInterval(fixture.platform.pollTimer);
    } finally {
      global.setInterval = originalSetInterval;
    }
    return captured;
  };

  assert.equal(makeInterval(30), 30_000);
  assert.equal(makeInterval(1), 10_000); // below minimum clamps up to 10s
  assert.equal(makeInterval(5000), 300_000); // above maximum clamps down to 300s
  assert.equal(makeInterval('abc'), 30_000); // non-finite falls back to default 30s
  assert.equal(makeInterval(undefined), 30_000);
});

test('thermostat and sensor onGet handlers reflect current state', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });

  const thermostatAccessory = new fixture.api.platformAccessory('Heating', 'getter-thermostat');
  thermostatAccessory.context.deviceId = 1;
  thermostatAccessory.context.circuitId = 10;
  const thermostat = new ZontThermostatAccessory(fixture.platform, thermostatAccessory);
  const service = thermostat.service;
  const getGetter = (characteristic) => service.getCharacteristic(characteristic).getter;

  thermostat.updateState({
    currentTemperature: 21,
    targetTemperature: 23,
    isHeating: true,
    online: true,
    minTargetTemperature: 5,
    maxTargetTemperature: 35,
    targetTemperatureStep: 0.5,
  });

  assert.equal(getGetter(fixture.Characteristic.CurrentTemperature)(), 21);
  assert.equal(getGetter(fixture.Characteristic.TargetTemperature)(), 23);
  assert.equal(getGetter(fixture.Characteristic.CurrentHeatingCoolingState)(), 'HEAT');
  assert.equal(getGetter(fixture.Characteristic.TargetHeatingCoolingState)(), 'HEAT');

  // Offline is unavailable, not a fabricated OFF state.
  thermostat.updateState({ currentTemperature: 21, targetTemperature: 23, isHeating: true, online: false });
  assert.throws(() => getGetter(fixture.Characteristic.CurrentHeatingCoolingState)(), (error) => error.hapStatus === -70402);

  // Online but not heating is also OFF.
  thermostat.updateState({ currentTemperature: 21, targetTemperature: 23, isHeating: false, online: true });
  assert.equal(getGetter(fixture.Characteristic.CurrentHeatingCoolingState)(), 'OFF');

  const sensorAccessory = new fixture.api.platformAccessory('Temp', 'getter-sensor');
  sensorAccessory.context.sensorType = 'temperature';
  const sensor = new ZontSensorAccessory(fixture.platform, sensorAccessory);
  sensor.updateState({ value: 17.5, status: 'ok', online: true });
  assert.equal(sensor.service.getCharacteristic(fixture.Characteristic.CurrentTemperature).getter(), 17.5);
  assert.equal(sensor.service.getCharacteristic(fixture.Characteristic.StatusActive).getter(), true);
  assert.equal(sensor.service.getCharacteristic(fixture.Characteristic.StatusFault).getter(), 0);
});

test('configureAccessory caches restored accessories', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const platform = fixture.platform;
  const restored = new fixture.api.platformAccessory('Restored', 'restored-uuid');

  platform.configureAccessory(restored);

  assert.ok(platform.cachedAccessories.includes(restored));
});

test('didFinishLaunching refreshes accessories and starts polling', async () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });
  const platform = fixture.platform;

  let refreshed = false;
  let polling = false;
  platform.refreshAndSyncAccessories = async () => { refreshed = true; };
  platform.startPolling = () => { polling = true; };

  await fixture.events.get('didFinishLaunching')();

  assert.equal(refreshed, true);
  assert.equal(polling, true);
});

test('accessories populate AccessoryInformation with manufacturer, model and serial', () => {
  const fixture = createPlatformFixture({ selectedDevices: [] });

  const thermostatAccessory = new fixture.api.platformAccessory('Heating', 'info-thermostat');
  thermostatAccessory.context.deviceId = 1;
  thermostatAccessory.context.circuitId = 10;
  thermostatAccessory.context.circuitType = 'consumer';
  new ZontThermostatAccessory(fixture.platform, thermostatAccessory);

  const info = thermostatAccessory.getService(fixture.Service.AccessoryInformation);
  assert.equal(info.characteristics.get(fixture.Characteristic.Manufacturer).value, 'ZONT');
  assert.equal(info.characteristics.get(fixture.Characteristic.Model).value, 'consumer');
  assert.equal(info.characteristics.get(fixture.Characteristic.SerialNumber).value, '1:10');

  const sensorAccessory = new fixture.api.platformAccessory('Temp', 'info-sensor');
  sensorAccessory.context.sensorType = 'temperature';
  sensorAccessory.context.deviceId = 1;
  sensorAccessory.context.sensorId = 20;
  new ZontSensorAccessory(fixture.platform, sensorAccessory);

  const sensorInfo = sensorAccessory.getService(fixture.Service.AccessoryInformation);
  assert.equal(sensorInfo.characteristics.get(fixture.Characteristic.Model).value, 'Temperature Sensor');
  assert.equal(sensorInfo.characteristics.get(fixture.Characteristic.SerialNumber).value, 'sensor:1:20');
});

function deviceFixture(deviceName, circuitName) {
  return {
    id: 1,
    name: deviceName,
    online: true,
    circuits: [{ id: 10, name: circuitName, type: 'consumer', actual_temp: 19, target_temp: 21, min: 5, max: 30, step: 0.5, active: true }],
    sensors: [{ id: 20, name: 'Kitchen humidity', type: 'HUMIDITY', value: 45, status: 'ok' }],
  };
}

function createPlatformFixture(config, credentials = { clientEmail: 'user@example.com', token: 'token' }) {
  const Characteristic = {
    Name: 'Name',
    CurrentTemperature: 'CurrentTemperature',
    TargetTemperature: 'TargetTemperature',
    CurrentRelativeHumidity: 'CurrentRelativeHumidity',
    CurrentHeatingCoolingState: { key: 'CurrentHeatingCoolingState', OFF: 'OFF', HEAT: 'HEAT', COOL: 'COOL' },
    TargetHeatingCoolingState: { key: 'TargetHeatingCoolingState', OFF: 'OFF', HEAT: 'HEAT', COOL: 'COOL' },
    StatusFault: { key: 'StatusFault', NO_FAULT: 0, GENERAL_FAULT: 1 },
    StatusActive: 'StatusActive',
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
  };
  const Service = { AccessoryInformation: 'AccessoryInformation', Thermostat: 'Thermostat', TemperatureSensor: 'TemperatureSensor', HumiditySensor: 'HumiditySensor' };
  const registered = [];
  const unregistered = [];
  const events = new Map();
  const logs = { info: [], warn: [], error: [], debug: [] };
  const log = Object.fromEntries(Object.keys(logs).map((level) => [level, (message) => logs[level].push(message)]));
  const HAPStatus = { READ_ONLY_CHARACTERISTIC: -70404, SERVICE_COMMUNICATION_FAILURE: -70402, INVALID_VALUE_IN_REQUEST: -70410 };
  class HapStatusError extends Error {
    constructor(status) {
      super(`HapStatusError ${status}`);
      this.hapStatus = status;
    }
  }
  const api = {
    hap: {
      Service,
      Characteristic,
      uuid: { generate: (key) => key },
      HAPStatus,
      HapStatusError,
      Perms: { PAIRED_READ: 'pr', PAIRED_WRITE: 'pw', NOTIFY: 'ev', WRITE_RESPONSE: 'wr' },
    },
    platformAccessory: FakeAccessory,
    on: (event, handler) => events.set(event, handler),
    registerPlatformAccessories: (plugin, platform, accessories) => registered.push(...accessories),
    unregisterPlatformAccessories: (plugin, platform, accessories) => unregistered.push(...accessories),
  };
  return { platform: new ZontPlatform(log, { ...credentials, ...config }, api), api, Service, Characteristic, registered, unregistered, events, logs };
}

class FakeAccessory {
  constructor(displayName, UUID) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.context = {};
    this.services = new Map();
  }

  getService(type) {
    return this.services.get(type);
  }

  addService(type) {
    const service = new FakeService(type);
    this.services.set(type, service);
    return service;
  }

  removeService(service) {
    for (const [type, existing] of this.services) {
      if (existing === service) {
        this.services.delete(type);
        return;
      }
    }
  }
}

class FakeService {
  constructor(type) {
    this.type = type;
    this.characteristics = new Map();
  }

  setCharacteristic(type, value) {
    this.getCharacteristic(type).value = value;
    return this;
  }

  getCharacteristic(type) {
    const key = type.key || type;

    if (!this.characteristics.has(type)) {
      assertCharacteristicAllowed(this.type, key);
      this.characteristics.set(type, new FakeCharacteristic(key));
    }

    return this.characteristics.get(type);
  }

  updateCharacteristic(type, value) {
    this.getCharacteristic(type).value = value;
    return this;
  }
}

// Mirrors the required + optional characteristic sets from HAP-NodeJS
// ServiceDefinitions so tests catch characteristics added to the wrong service.
const ALLOWED_CHARACTERISTICS = {
  AccessoryInformation: new Set([
    'Name',
    'Manufacturer',
    'Model',
    'SerialNumber',
    'FirmwareRevision',
    'Identify',
  ]),
  Thermostat: new Set([
    'Name',
    'CurrentTemperature',
    'TargetTemperature',
    'CurrentHeatingCoolingState',
    'TargetHeatingCoolingState',
    'TemperatureDisplayUnits',
    'CurrentRelativeHumidity',
    'TargetRelativeHumidity',
    'CoolingThresholdTemperature',
    'HeatingThresholdTemperature',
  ]),
  TemperatureSensor: new Set([
    'Name',
    'CurrentTemperature',
    'StatusActive',
    'StatusFault',
    'StatusLowBattery',
    'StatusTampered',
  ]),
  HumiditySensor: new Set([
    'Name',
    'CurrentRelativeHumidity',
    'StatusActive',
    'StatusFault',
    'StatusLowBattery',
    'StatusTampered',
  ]),
};

function assertCharacteristicAllowed(serviceType, characteristicKey) {
  const allowed = ALLOWED_CHARACTERISTICS[serviceType];
  if (allowed && !allowed.has(characteristicKey)) {
    throw new Error(`Characteristic ${characteristicKey} is not valid for service ${serviceType}`);
  }
}

class FakeCharacteristic {
  constructor(key) {
    this.key = key;
    this.props = {};
  }

  setProps(props) {
    Object.assign(this.props, props);
    return this;
  }

  onGet(handler) {
    this.getter = handler;
    return this;
  }

  onSet(handler) {
    this.setter = handler;
    return this;
  }

  updateValue(value) {
    this.value = value;
    return this;
  }
}
