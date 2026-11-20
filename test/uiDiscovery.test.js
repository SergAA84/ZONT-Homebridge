const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createUiClient,
  createAuthToken,
  discoverDevices,
  mapDiscoveredDevices,
} = require('../lib/uiDiscovery');

class FakeClient {
  constructor(options) {
    this.options = options;
    FakeClient.instances.push(this);
  }

  async createAuthToken() {
    return 'fake-token';
  }

  async getDevices(query) {
    this.lastQuery = query;
    return FakeClient.devicesResponse;
  }
}
FakeClient.instances = [];
FakeClient.devicesResponse = { ok: true, devices: [] };

test('createUiClient requires clientEmail', () => {
  assert.throws(() => createUiClient({ token: 't' }, FakeClient), /clientEmail is required/);
});

test('createUiClient requires token or login/password', () => {
  assert.throws(
    () => createUiClient({ clientEmail: 'user@example.com' }, FakeClient),
    /Provide token or login\/password/,
  );
  assert.throws(
    () => createUiClient({ clientEmail: 'user@example.com', login: 'only-login' }, FakeClient),
    /Provide token or login\/password/,
  );
});

test('createUiClient accepts token auth and login/password auth', () => {
  FakeClient.instances = [];
  const withToken = createUiClient({ clientEmail: 'user@example.com', token: 't' }, FakeClient);
  assert.equal(withToken.options.clientEmail, 'user@example.com');
  assert.equal(withToken.options.token, 't');
  assert.equal(withToken.options.clientName, 'Homebridge ZONT Plugin UI');

  const withCreds = createUiClient(
    { clientEmail: 'user@example.com', login: 'l', password: 'p' },
    FakeClient,
  );
  assert.equal(withCreds.options.login, 'l');
  assert.equal(withCreds.options.password, 'p');
});

test('createAuthToken returns the generated token', async () => {
  const result = await createAuthToken({ clientEmail: 'user@example.com', login: 'l', password: 'p' }, FakeClient);
  assert.deepEqual(result, { token: 'fake-token' });
});

test('discoverDevices requests circuits, modes and sensors and returns only devices with circuits', async () => {
  FakeClient.instances = [];
  FakeClient.devicesResponse = {
    ok: true,
    devices: [
      {
        id: 1,
        name: 'House',
        online: true,
        circuits: [
          { id: 10, name: 'Living Room', type: 'consumer' },
          { id: 11, name: 'Boiler', type: 'boiler' },
          { id: 12, name: 'Slave', type: 'consumer', is_dependent: true },
        ],
        sensors: [{ id: 20, name: 'Kitchen', type: 'humidity', value: 40 }],
      },
      {
        id: 2,
        name: 'Sensor-only device',
        online: true,
        circuits: [],
        sensors: [{ id: 30, name: 'Temp', type: 'temperature', value: 15 }],
      },
      {
        id: 3,
        name: 'No circuits, no supported sensors',
        online: true,
        circuits: [],
        sensors: [{ id: 40, name: 'Pressure', type: 'pressure', value: 1.5 }],
      },
    ],
  };

  const result = await discoverDevices({ clientEmail: 'user@example.com', token: 't' }, FakeClient);

  assert.equal(FakeClient.instances.length, 1);
  assert.deepEqual(FakeClient.instances[0].lastQuery, { fields: ['circuits', 'modes', 'sensors'] });

  // Devices with circuits OR supported sensors are returned; a device with
  // neither (only an unsupported pressure sensor) is dropped.
  assert.deepEqual(result.devices.map((d) => d.id), [1, 2]);
  const device = result.devices[0];
  assert.equal(device.id, 1);

  // Sensor-only device is included so its sensors can be selected in the UI.
  const sensorOnly = result.devices.find((d) => d.id === 2);
  assert.equal(sensorOnly.circuits.length, 0);
  assert.equal(sensorOnly.sensors.some((s) => s.id === 30 && s.supported), true);

  // Non-technical circuits are recommended, technical ones are not.
  const living = device.circuits.find((c) => c.id === 10);
  const boiler = device.circuits.find((c) => c.id === 11);
  const slave = device.circuits.find((c) => c.id === 12);
  assert.equal(living.recommendedInclude, true);
  assert.equal(boiler.recommendedInclude, false);

  // Dependent flag is surfaced to the UI.
  assert.equal(slave.dependent, true);
  assert.equal(slave.recommendedInclude, true);
});

test('mapDiscoveredDevices rejects incomplete responses without pretending discovery is empty', () => {
  assert.throws(() => mapDiscoveredDevices(undefined), /devices must be an array/);
  assert.throws(() => mapDiscoveredDevices({}), /devices must be an array/);
  assert.deepEqual(mapDiscoveredDevices({ devices: [] }), []);
});

test('discovery includes sensor-only devices with signed outdoor sensor IDs', () => {
  const discovered = mapDiscoveredDevices({ ok: true, devices: [{
    id: 1, name: 'Outdoor controller', online: true, circuits: [],
    sensors: [{ id: '-17', name: 'Улица', type: 'temperature', value: -12.3, status: 'ok' }],
  }] });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].sensors[0].id, -17);
  assert.equal(discovered[0].sensors[0].supported, true);
  assert.equal(discovered[0].sensors[0].recommendedInclude, true);
});
