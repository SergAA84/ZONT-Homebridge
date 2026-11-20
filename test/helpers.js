const hap = require('@homebridge/hap-nodejs');
const { ZontPlatform } = require('../lib/platform');

class TestAccessory extends hap.Accessory {
  constructor(name, uuid) {
    super(name, uuid);
    this.context = {};
  }
}

function device(overrides = {}) {
  return {
    id: 1, name: 'House', online: true,
    circuits: [{ id: 10, name: 'Room', type: 'consumer', actual_temp: 19, target_temp: 21, min: 5, max: 35, step: 0.5, active: true, status: 'ok' }],
    sensors: [{ id: 20, name: 'Outdoor', type: 'temperature', value: 12, status: 'ok' }],
    ...overrides,
  };
}

function fixture(config = {}) {
  const events = new Map();
  const registered = [];
  const unregistered = [];
  const logs = { info: [], warn: [], error: [], debug: [] };
  const log = Object.fromEntries(Object.keys(logs).map((level) => [level, (message) => logs[level].push(message)]));
  const api = {
    hap, platformAccessory: TestAccessory,
    on: (event, handler) => events.set(event, handler),
    registerPlatformAccessories: (plugin, name, accessories) => registered.push(...accessories),
    unregisterPlatformAccessories: (plugin, name, accessories) => unregistered.push(...accessories),
    updatePlatformAccessories() {},
  };
  const platform = new ZontPlatform(log, {
    clientEmail: 'audit@example.invalid', token: 'test-token',
    selectedDevices: [{ id: 1, includeAll: false, includeCircuitIds: [10] }],
    selectedSensors: [{ deviceId: 1, sensorIds: [20] }], ...config,
  }, api);
  platform.client.getDevices = async () => ({ ok: true, devices: [device()] });
  const runtime = (key = '1:10') => platform.runtimeAccessories.get(hap.uuid.generate(`homebridge-zont-thermostat-${key}`));
  return { platform, api, events, registered, unregistered, logs, runtime };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

module.exports = { hap, TestAccessory, fixture, device, deferred };
