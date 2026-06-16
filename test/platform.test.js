const assert = require('node:assert/strict');
const test = require('node:test');

const { _internals: platformInternals } = require('../lib/platform');
const { _internals: accessoryInternals } = require('../lib/platformAccessory');

test('normalizeSelectedDevices infers includeAll when circuit ids are absent', () => {
  assert.deepEqual(platformInternals.normalizeSelectedDevices([
    { id: '123456' },
    { id: 'bad' },
    { id: 222222, includeCircuitIds: ['1111', 'bad', 2222] },
  ]), [
    { id: 123456, includeAll: true, includeCircuitIds: [] },
    { id: 222222, includeAll: false, includeCircuitIds: [1111, 2222] },
  ]);
});

test('normalizeSelectedSensors keeps finite device and sensor ids', () => {
  assert.deepEqual(platformInternals.normalizeSelectedSensors([
    { deviceId: '123456', sensorIds: ['8793', 'bad', 4101] },
    { deviceId: 'bad', sensorIds: [1] },
    { deviceId: 222222, sensorIds: [] },
  ]), [
    { deviceId: 123456, sensorIds: [8793, 4101] },
  ]);
});

test('buildAccessoryName supports both naming modes and sanitizes spaces', () => {
  assert.equal(
    platformInternals.buildAccessoryName({ accessoryNameMode: 'device_and_circuit' }, ' House  Name ', '  2  SU '),
    'House Name - 2 SU',
  );

  assert.equal(
    platformInternals.buildAccessoryName({ accessoryNameMode: 'circuit_only' }, ' House ', '  2  SU '),
    '2 SU',
  );

  assert.equal(platformInternals.sanitizeHomeKitName('', 'Fallback'), 'Fallback');
});

test('isCircuitHeating respects off and summer mode flags', () => {
  assert.equal(platformInternals.isCircuitHeating({ active: true }), true);
  assert.equal(platformInternals.isCircuitHeating({ active: true, isOff: true }), false);
  assert.equal(platformInternals.isCircuitHeating({ active: true, inSummerMode: true }), false);
  assert.equal(platformInternals.isCircuitHeating({ status: 'ok' }), true);
  assert.equal(platformInternals.isCircuitHeating({ status: 'error' }), false);
});

test('temperature helpers clamp invalid and out-of-range values', () => {
  assert.equal(accessoryInternals.clampTemperature(0, 5, 35), 5);
  assert.equal(accessoryInternals.clampTemperature(50, 5, 35), 35);
  assert.equal(accessoryInternals.clampTemperature('21.5', 5, 35), 21.5);
  assert.equal(accessoryInternals.clampTemperature('bad', 5, 35), 5);
});

test('normalizeTargetBounds repairs invalid bounds', () => {
  assert.deepEqual(accessoryInternals.normalizeTargetBounds(35, 5, 0.5), {
    min: 5,
    max: 35,
    step: 0.5,
  });

  assert.deepEqual(accessoryInternals.normalizeTargetBounds(20, 20, 1), {
    min: 20,
    max: 21,
    step: 1,
  });

  assert.deepEqual(accessoryInternals.normalizeTargetBounds(null, null, 0), {
    min: 5,
    max: 35,
    step: 0.5,
  });
});
