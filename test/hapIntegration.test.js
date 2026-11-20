const assert = require('node:assert/strict');
const test = require('node:test');
const { ZontSensorAccessory, ZontThermostatAccessory } = require('../lib/platformAccessory');
const { hap, TestAccessory, fixture, device, deferred } = require('./helpers');

const C = hap.Characteristic;
const unavailable = (error) => error === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
  || error?.hapStatus === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
const get = (runtime, characteristic) => runtime.service.getCharacteristic(characteristic).handleGetRequest();

test('real HAP: permissions and write responses preserve the server-confirmed setpoint', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const runtime = f.runtime();
  const target = runtime.service.getCharacteristic(C.TargetTemperature);
  assert.equal(C.Perms, undefined, 'do not invent properties on the HAP Characteristic class');
  assert.ok(target.props.perms.includes(hap.Perms.WRITE_RESPONSE));
  f.platform.client.setCircuitTargetTemperature = async () => ({ ok: true, device: device({
    circuits: [{ ...device().circuits[0], target_temp: 22.5 }],
  }) });
  await target.handleSetRequest(22.3);
  assert.equal(target.value, 22.5);
  assert.equal(await get(runtime, C.TargetTemperature), 22.5);
  assert.equal(runtime.state.targetTemperature, 22.5);
});

test('real HAP: dependent targets are read-only and cooling circuits declare COOL', async () => {
  const f = fixture();
  const warnings = [];
  const accessory = new TestAccessory('Cooling', hap.uuid.generate('cooling'));
  accessory.context = { deviceId: 1, circuitId: 10, circuitType: 'cooling' };
  accessory.on('characteristic-warning', (warning) => warnings.push(warning));
  const runtime = new ZontThermostatAccessory(f.platform, accessory);
  runtime.updateState({ currentTemperature: 26, targetTemperature: 23, online: true, isHeating: true, dependent: true });
  assert.equal(await get(runtime, C.TargetHeatingCoolingState), C.TargetHeatingCoolingState.COOL);
  assert.equal(await get(runtime, C.CurrentHeatingCoolingState), C.CurrentHeatingCoolingState.COOL);
  assert.ok(!runtime.service.getCharacteristic(C.TargetTemperature).props.perms.includes('pw'));
  await assert.rejects(() => runtime.handleSetTargetTemperature(24), (error) => error.hapStatus === hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
  accessory.context.circuitType = 'consumer';
  runtime.updateState({ currentTemperature: 20, targetTemperature: 23, online: true, isHeating: true });
  assert.equal(await get(runtime, C.TargetHeatingCoolingState), C.TargetHeatingCoolingState.HEAT);
  assert.deepEqual(warnings, []);
});

test('real HAP: missing temperatures and offline data are unavailable, never defaulted', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const thermostat = f.runtime();
  const sensor = f.runtime('sensor:1:20');
  f.platform.client.getDevices = async () => ({ devices: [device({
    circuits: [{ ...device().circuits[0], target_temp: null, actual_temp: null }],
    sensors: [{ ...device().sensors[0], value: null }],
  })] });
  await f.platform.refreshAndSyncAccessories();
  await assert.rejects(() => get(thermostat, C.CurrentTemperature), unavailable);
  await assert.rejects(() => get(thermostat, C.TargetTemperature), unavailable);
  await assert.rejects(() => get(sensor, C.CurrentTemperature), unavailable);
  assert.equal(await get(sensor, C.StatusActive), false);
  f.platform.client.getDevices = async () => ({ devices: [device({ online: false })] });
  await f.platform.refreshAndSyncAccessories();
  await assert.rejects(() => get(thermostat, C.CurrentHeatingCoolingState), unavailable);
  await assert.rejects(() => get(sensor, C.CurrentTemperature), unavailable);
  await assert.rejects(() => thermostat.handleSetTargetTemperature(22), unavailable);
  f.platform.client.getDevices = async () => ({ devices: [device()] });
  await f.platform.refreshAndSyncAccessories();
  assert.equal(await get(thermostat, C.CurrentTemperature), 19);
  assert.equal(await get(sensor, C.CurrentTemperature), 12);
});

test('real HAP: unknown/failed sensors and aged snapshots cannot be read as healthy', async (t) => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const sensor = f.runtime('sensor:1:20');
  for (const status of ['unknown', 'failure', null]) {
    sensor.updateState({ value: 10, online: true, status });
    await assert.rejects(() => get(sensor, C.CurrentTemperature), unavailable);
    assert.equal(await get(sensor, C.StatusFault), C.StatusFault.GENERAL_FAULT);
  }
  sensor.updateState({ value: 10, online: true, status: 'silent_alarm' });
  assert.equal(await get(sensor, C.CurrentTemperature), 10);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + f.platform.freshnessMs + 1);
  await assert.rejects(() => get(sensor, C.CurrentTemperature), unavailable);
  await assert.rejects(() => get(f.runtime(), C.TargetTemperature), unavailable);
  assert.equal(await get(sensor, C.StatusActive), false);
});

test('real HAP: restored accessories have safe getters and setters before discovery', async () => {
  const f = fixture();
  const accessory = new TestAccessory('Restored', hap.uuid.generate('homebridge-zont-thermostat-1:10'));
  accessory.context = { deviceId: 1, circuitId: 10, key: '1:10', circuitType: 'consumer' };
  accessory.addService(hap.Service.Thermostat).updateCharacteristic(C.TargetTemperature, 22);
  f.platform.configureAccessory(accessory);
  const runtime = f.runtime();
  await assert.rejects(() => get(runtime, C.TargetTemperature), unavailable);
  await assert.rejects(() => runtime.handleSetTargetTemperature(24), unavailable);
  f.platform.client.getDevices = async () => { throw new Error('ZONT is down'); };
  await f.platform.refreshAndSyncAccessories();
  assert.equal(f.unregistered.length, 0);
  await assert.rejects(() => get(runtime, C.CurrentTemperature), unavailable);
});

test('malformed, missing and empty cloud snapshots retain selected accessories without stale values', async () => {
  for (const body of [{ ok: true }, { devices: null }, { devices: [{ id: 1, circuits: null }] }, { devices: [] }]) {
    const f = fixture();
    await f.platform.refreshAndSyncAccessories();
    f.platform.client.getDevices = async () => body;
    await f.platform.refreshAndSyncAccessories();
    assert.equal(f.unregistered.length, 0);
    assert.equal(f.platform.cachedAccessories.length, 2);
    await assert.rejects(() => get(f.runtime(), C.CurrentTemperature), unavailable);
    await assert.rejects(() => get(f.runtime('sensor:1:20'), C.CurrentTemperature), unavailable);
    f.platform.nextPollAt = 0;
    f.platform.config.selectedDevices = [];
    f.platform.config.selectedSensors = [];
    f.platform.client.getDevices = async () => ({ devices: [] });
    await f.platform.refreshAndSyncAccessories();
    assert.equal(f.unregistered.length, 2);
  }
});

test('a late poll cannot overwrite a completed command', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const pending = deferred();
  f.platform.client.getDevices = () => pending.promise;
  const poll = f.platform.refreshAndSyncAccessories();
  f.platform.client.setCircuitTargetTemperature = async () => ({ device: device({
    circuits: [{ ...device().circuits[0], target_temp: 24 }],
  }) });
  assert.equal(await f.platform.setCircuitTargetTemperature(1, 10, 24), 24);
  pending.resolve({ devices: [device()] });
  await poll;
  assert.equal(await get(f.runtime(), C.TargetTemperature), 24);
});

test('commands on one circuit serialize and polls skip in-flight writes', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const started = deferred();
  const firstResult = deferred();
  const calls = [];
  f.platform.client.setCircuitTargetTemperature = async (did, cid, target) => {
    calls.push(target);
    if (calls.length === 1) { started.resolve(); await firstResult.promise; }
    return { device: device({ circuits: [{ ...device().circuits[0], target_temp: target }] }) };
  };
  const first = f.platform.setCircuitTargetTemperature(1, 10, 22);
  const second = f.platform.setCircuitTargetTemperature(1, 10, 24);
  await started.promise;
  await f.platform.refreshAndSyncAccessories();
  assert.deepEqual(calls, [22]);
  firstResult.resolve();
  assert.deepEqual(await Promise.all([first, second]), [22, 24]);
  assert.deepEqual(calls, [22, 24]);
  assert.equal(f.platform.writeQueues.size, 0);
});

test('uncertain commands are not retried, invalidate state, and recover after a good poll', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  let calls = 0;
  f.platform.client.setCircuitTargetTemperature = async () => { calls += 1; throw new Error('confirmation lost'); };
  await assert.rejects(() => f.runtime().handleSetTargetTemperature(23), unavailable);
  assert.equal(calls, 1);
  await assert.rejects(() => get(f.runtime(), C.TargetTemperature), unavailable);
  await assert.rejects(() => f.runtime().handleSetTargetTemperature(24), unavailable);
  assert.equal(calls, 1);
  await f.platform.refreshAndSyncAccessories();
  assert.equal(await get(f.runtime(), C.TargetTemperature), 21);
});

test('confirmation reads share the command deadline and cannot accept a different device', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  let signal;
  f.platform.client.setCircuitTargetTemperature = async (did, cid, target, options) => {
    signal = options.signal;
    return { device: device({ id: 2 }) };
  };
  f.platform.client.getDevices = async (options) => {
    assert.equal(options.signal, signal);
    assert.deepEqual(options.deviceIds, [1]);
    return { devices: [device({ id: 2 })] };
  };
  await assert.rejects(() => f.platform.setCircuitTargetTemperature(1, 10, 22), /confirmed circuit target/);
  await assert.rejects(() => get(f.runtime(), C.TargetTemperature), unavailable);
});

test('shutdown prevents late command updates and queued commands from reaching ZONT', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const started = deferred();
  const pending = deferred();
  let calls = 0;
  f.platform.client.setCircuitTargetTemperature = async () => { calls += 1; started.resolve(); return pending.promise; };
  const first = f.platform.setCircuitTargetTemperature(1, 10, 22);
  const second = f.platform.setCircuitTargetTemperature(1, 10, 24);
  const results = Promise.allSettled([first, second]);
  await started.promise;
  f.events.get('shutdown')();
  pending.resolve({ device: device({ circuits: [{ ...device().circuits[0], target_temp: 22 }] }) });
  assert.ok((await results).every((result) => result.status === 'rejected'));
  assert.equal(f.runtime().state.targetTemperature, 21);
  assert.equal(calls, 1);
  assert.equal(f.platform.writeQueues.size, 0);
});

test('poll errors honor Retry-After and increase backoff; success resets it', async (t) => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  f.platform.client.getDevices = async () => { calls += 1; throw Object.assign(new Error('429'), { retryAfterMs: 120_000 }); };
  await f.platform.refreshAndSyncAccessories();
  assert.equal(f.platform.nextPollAt, now + 120_000);
  await f.platform.refreshAndSyncAccessories();
  assert.equal(calls, 1);
  now += 120_000;
  await f.platform.refreshAndSyncAccessories();
  assert.equal(f.platform.pollFailures, 2);
  now += 120_000;
  f.platform.client.getDevices = async () => ({ devices: [device()] });
  await f.platform.refreshAndSyncAccessories();
  assert.equal(f.platform.pollFailures, 0);
  assert.equal(f.platform.nextPollAt, 0);
  assert.equal(await get(f.runtime(), C.CurrentTemperature), 19);
});

test('circuit failure without details is logged and fails HomeKit reads', async () => {
  const f = fixture();
  f.platform.client.getDevices = async () => ({ devices: [device({ circuits: [{ ...device().circuits[0], status: 'failure' }] })] });
  await f.platform.refreshAndSyncAccessories();
  assert.ok(f.logs.warn.some((message) => /Circuit failure/.test(message)));
  await assert.rejects(() => get(f.runtime(), C.CurrentTemperature), unavailable);
});

test('real HAP: humidity bounds, invalid writes, unavailable constructors and sensor recovery', async () => {
  const f = fixture();
  const accessory = new TestAccessory('Humidity', hap.uuid.generate('humidity-audit'));
  accessory.context = { deviceId: 1, sensorId: 20, sensorType: 'humidity' };
  const sensor = new ZontSensorAccessory(f.platform, accessory);
  await assert.rejects(() => get(sensor, C.CurrentRelativeHumidity), unavailable);
  sensor.updateState({ value: 45.6, status: 'ok', online: true });
  assert.equal(await get(sensor, C.CurrentRelativeHumidity), 46);
  sensor.updateState({ value: NaN, status: 'ok', online: true });
  await assert.rejects(() => get(sensor, C.CurrentRelativeHumidity), unavailable);
  await f.platform.refreshAndSyncAccessories();
  await assert.rejects(() => f.runtime().handleSetTargetTemperature(NaN), (error) => error.hapStatus === hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
  const mode = f.runtime().service.getCharacteristic(C.TargetHeatingCoolingState);
  await assert.rejects(() => mode.handleSetRequest(C.TargetHeatingCoolingState.OFF));
});

test('real HAP: partial bounds never reverse known constraints and keep high/low setpoints readable without writes', async () => {
  for (const [bounds, expectedMin, expectedMax] of [
    [{ min: 40, max: null, target_temp: 70 }, 40, 70],
    [{ min: 40, max: undefined, target_temp: 40 }, 40, 40],
    [{ min: null, max: -5, target_temp: -10 }, -10, -5],
    [{ min: null, max: null, target_temp: 60 }, 5, 60],
    [{ min: 20, max: 20, target_temp: 20 }, 20, 20],
  ]) {
    const f = fixture();
    f.platform.client.getDevices = async () => ({ devices: [device({
      circuits: [{ ...device().circuits[0], type: 'boiler', step: 1, ...bounds }],
    })] });
    await f.platform.refreshAndSyncAccessories();
    const target = f.runtime().service.getCharacteristic(C.TargetTemperature);
    assert.equal(target.props.minValue, expectedMin);
    assert.equal(target.props.maxValue, expectedMax);
    assert.ok(!target.props.perms.includes(hap.Perms.PAIRED_WRITE));
    assert.equal(await get(f.runtime(), C.TargetTemperature), bounds.target_temp);
    let writes = 0;
    f.platform.client.setCircuitTargetTemperature = async () => { writes += 1; };
    await assert.rejects(() => f.runtime().handleSetTargetTemperature(35), (error) => error.hapStatus === hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
    await assert.rejects(() => f.platform.setCircuitTargetTemperature(1, 10, 35), (error) => error.hapStatus === hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
    assert.equal(writes, 0);
    assert.equal(await get(f.runtime(), C.CurrentTemperature), 19);
  }
});

test('real HAP: contradictory explicit bounds disable targets instead of swapping or widening constraints', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const previous = { ...f.runtime().service.getCharacteristic(C.TargetTemperature).props };
  f.platform.client.getDevices = async () => ({ devices: [device({
    circuits: [{ ...device().circuits[0], min: 40, max: 35, target_temp: 37 }],
  })] });
  await f.platform.refreshAndSyncAccessories();
  const target = f.runtime().service.getCharacteristic(C.TargetTemperature);
  assert.equal(target.props.minValue, previous.minValue);
  assert.equal(target.props.maxValue, previous.maxValue);
  assert.ok(!target.props.perms.includes(hap.Perms.PAIRED_WRITE));
  await assert.rejects(() => get(f.runtime(), C.TargetTemperature), unavailable);
  await assert.rejects(() => f.runtime().handleSetTargetTemperature(37), unavailable);
  assert.equal(await get(f.runtime(), C.CurrentTemperature), 19);
  f.platform.client.getDevices = async () => ({ devices: [device({
    circuits: [{ ...device().circuits[0], min: 40, max: 80, target_temp: 70 }],
  })] });
  await f.platform.refreshAndSyncAccessories();
  let sentTarget;
  f.platform.client.setCircuitTargetTemperature = async (did, cid, value) => {
    sentTarget = value;
    return { device: device({ circuits: [{ ...device().circuits[0], min: 40, max: 80, target_temp: value }] }) };
  };
  assert.equal(await f.runtime().handleSetTargetTemperature(35), 40);
  assert.equal(sentTarget, 40);
  assert.equal(await get(f.runtime(), C.TargetTemperature), 40);
});

test('real HAP: becoming read-only during a rounded write never emits or caches the requested value', async () => {
  for (const transition of [{ min: null, max: null }, { is_dependent: true }]) {
    const f = fixture();
    await f.platform.refreshAndSyncAccessories();
    const runtime = f.runtime();
    const target = runtime.service.getCharacteristic(C.TargetTemperature);
    const changes = [];
    const warnings = [];
    target.on('change', (event) => changes.push(event));
    runtime.accessory.on('characteristic-warning', (warning) => warnings.push(warning));
    let writes = 0;
    f.platform.client.setCircuitTargetTemperature = async () => {
      writes += 1;
      return { device: device({ circuits: [{ ...device().circuits[0], target_temp: 22.5, ...transition }] }) };
    };
    await assert.rejects(() => target.handleSetRequest(22.3, {}), (status) => status === hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
    assert.equal(writes, 1);
    assert.equal(runtime.state.targetTemperature, 22.5);
    assert.equal(target.value, 22.5);
    assert.ok(!target.props.perms.includes(hap.Perms.PAIRED_WRITE));
    assert.ok(changes.some((event) => event.newValue === 22.5));
    assert.ok(!changes.some((event) => event.newValue === 22.3), 'no optimistic requested-value event after the confirmed update');
    assert.equal(await get(runtime, C.TargetTemperature), 22.5);
    assert.deepEqual(warnings, []);
  }
});

test('real HAP: queued writes retain confirmed values when the later response removes write permissions', async () => {
  const f = fixture();
  await f.platform.refreshAndSyncAccessories();
  const target = f.runtime().service.getCharacteristic(C.TargetTemperature);
  const changes = [];
  target.on('change', (event) => changes.push(event.newValue));
  f.platform.client.setCircuitTargetTemperature = async (did, cid, requested) => ({
    device: device({ circuits: [{ ...device().circuits[0], target_temp: requested + 0.2,
      ...(requested > 23 ? { is_dependent: true } : {}),
    }] }),
  });
  const results = await Promise.allSettled([
    target.handleSetRequest(22.3, {}), target.handleSetRequest(23.3, {}),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(target.value, 23.5);
  assert.ok(!changes.includes(22.3));
  assert.ok(!changes.includes(23.3));
  assert.ok(!target.props.perms.includes(hap.Perms.PAIRED_WRITE));
});
