const assert = require('node:assert/strict');
const test = require('node:test');

const { ZontClient, isTechnicalCircuit, mapZ3kDevice } = require('../lib/zontClient');

test('mapZ3kDevice maps circuit fields and technical circuit flag', () => {
  const mapped = mapZ3kDevice({
    id: '123456',
    name: 'House',
    online: true,
    device_info: {
      id: 'h2000',
      model: 'H2000_PRO',
      widget_type: 'zont',
    },
    circuits: [
      {
        id: '1111',
        name: 'Living Room',
        type: 'consumer',
        target_temp: 21.5,
        actual_temp: 20.8,
        min: 5,
        max: 35,
        step: 0.5,
        current_mode: '3',
        active: true,
        is_off: false,
        in_summer_mode: false,
        status: 'ok',
      },
      {
        id: '2222',
        type: 'dhw',
      },
    ],
  });

  assert.equal(mapped.id, 123456);
  assert.equal(mapped.name, 'House');
  assert.equal(mapped.deviceType, 'h2000');
  assert.equal(mapped.online, true);
  assert.equal(mapped.circuits[0].id, 1111);
  assert.equal(mapped.circuits[0].targetTemp, 21.5);
  assert.equal(mapped.circuits[0].actualTemp, 20.8);
  assert.equal(mapped.circuits[0].currentMode, 3);
  assert.equal(mapped.circuits[0].technical, false);
  assert.equal(mapped.circuits[1].technical, true);
});

test('isTechnicalCircuit only marks boiler and dhw as technical', () => {
  assert.equal(isTechnicalCircuit({ type: 'boiler' }), true);
  assert.equal(isTechnicalCircuit({ type: 'dhw' }), true);
  assert.equal(isTechnicalCircuit({ type: 'consumer' }), false);
  assert.equal(isTechnicalCircuit({ type: 'cooling' }), false);
});

test('getDevices sends Widget API v3 token request with expected query and headers', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, devices: [] });
  };

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      token: 'token-value',
    });

    const body = await client.getDevices({
      deviceIds: [123456],
      fields: ['circuits', 'modes'],
    });

    assert.deepEqual(body, { ok: true, devices: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers['X-ZONT-Client'], 'user@example.com');
    assert.equal(calls[0].options.headers['X-ZONT-Token'], 'token-value');
    assert.equal(calls[0].url, 'https://my.zont.online/api/widget/v3/devices?device_ids=123456&fields=circuits&fields=modes');
    assert.equal(calls[0].options.body, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('setCircuitTargetTemperature sends official target-temp action payload', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true });
  };

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      token: 'token-value',
    });

    await client.setCircuitTargetTemperature('123456', '1111', '22.5');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].url, 'https://my.zont.online/api/widget/v3/devices/123456/circuits/1111/actions/target-temp');
    assert.deepEqual(JSON.parse(calls[0].options.body), { target_temp: 22.5 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('createAuthToken uses basic auth and returns token', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, token: 'created-token' });
  };

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      login: 'login@example.com',
      password: 'secret',
      clientName: 'Test Client',
    });

    const token = await client.createAuthToken();

    assert.equal(token, 'created-token');
    assert.equal(calls[0].url, 'https://my.zont.online/api/widget/v3/authtokens');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('login@example.com:secret').toString('base64')}`);
    assert.deepEqual(JSON.parse(calls[0].options.body), { client_name: 'Test Client' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('request surfaces ZONT API errors', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => jsonResponse({
    ok: false,
    error: 'device_is_offline',
    error_ui: 'Device is offline',
  });

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      token: 'token-value',
    });

    await assert.rejects(
      () => client.getDevices(),
      /ZONT GET \/devices failed: Device is offline/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

function jsonResponse(body, status = 200) {
  return {
    status,
    async json() {
      return body;
    },
  };
}
