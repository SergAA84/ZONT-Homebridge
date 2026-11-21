const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ZontClient,
  isRecommendedSensor,
  isSupportedSensor,
  isTechnicalCircuit,
  mapZ3kDevice,
  mapCircuitError,
  normalizeSignalStrength,
} = require('../lib/zontClient');

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
    sensors: [
      {
        id: '8793',
        name: 'Улица',
        type: 'temperature',
        status: 'ok',
        value: 15.6,
        unit: '°',
        limits: { low: -25, high: 40 },
      },
      {
        id: '8526',
        name: 'Погода из интернета',
        type: 'temperature',
        status: 'ok',
        value: 13.3,
        unit: '°',
      },
      {
        id: '4101',
        name: 'Kitchen',
        type: 'humidity',
        status: 'ok',
        value: 53,
        unit: '%',
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
  assert.equal(mapped.sensors[0].id, 8793);
  assert.equal(mapped.sensors[0].recommendedInclude, true);
  assert.equal(mapped.sensors[1].recommendedInclude, false);
  assert.equal(mapped.sensors[2].supported, true);
});

test('mapZ3kDevice maps schema 26.8.1 circuit fields (is_dependent, error, time_left)', () => {
  const mapped = mapZ3kDevice({
    id: 1,
    circuits: [
      {
        id: 10,
        type: 'consumer',
        is_dependent: true,
        time_left: 45,
        status: 'ok',
      },
      {
        id: 20,
        type: 'boiler',
        status: 'failure',
        error: { oem: '08', text: 'no gas' },
      },
      {
        id: 30,
        type: 'consumer',
      },
    ],
  });

  assert.equal(mapped.circuits[0].dependent, true);
  assert.equal(mapped.circuits[0].timeLeft, 45);
  assert.equal(mapped.circuits[0].error, null);

  assert.equal(mapped.circuits[1].dependent, false);
  assert.deepEqual(mapped.circuits[1].error, { oem: '08', text: 'no gas' });

  assert.equal(mapped.circuits[2].dependent, false);
  assert.equal(mapped.circuits[2].timeLeft, null);
  assert.equal(mapped.circuits[2].error, null);
});

test('mapZ3kDevice treats null/empty/non-numeric time_left as absent, not zero', () => {
  const mapped = mapZ3kDevice({
    id: 1,
    circuits: [
      { id: 10, type: 'consumer', time_left: null },
      { id: 11, type: 'consumer', time_left: '' },
      { id: 12, type: 'consumer', time_left: '30' },
      { id: 13, type: 'consumer', time_left: 0 },
      { id: 14, type: 'consumer', time_left: 15 },
    ],
  });

  assert.equal(mapped.circuits[0].timeLeft, null);
  assert.equal(mapped.circuits[1].timeLeft, null);
  assert.equal(mapped.circuits[2].timeLeft, null); // strings are not accepted
  assert.equal(mapped.circuits[3].timeLeft, 0); // an explicit numeric 0 is kept
  assert.equal(mapped.circuits[4].timeLeft, 15);
});

test('mapZ3kDevice maps schema 26.8.1 sensor fields (triggered, signal_strength enum)', () => {
  const mapped = mapZ3kDevice({
    id: 1,
    sensors: [
      {
        id: 2,
        type: 'temperature',
        value: 12,
        triggered: false,
        signal_strength: 'GOOD',
        status: 'ok',
      },
      {
        id: 3,
        type: 'temperature',
        value: 8,
        signal_strength: 'not-a-value',
        status: 'failure',
      },
    ],
  });

  assert.equal(mapped.sensors[0].triggered, false);
  assert.equal(mapped.sensors[0].signalStrength, 'good');
  assert.equal(mapped.sensors[1].triggered, null);
  assert.equal(mapped.sensors[1].signalStrength, null);
});

test('mapCircuitError normalizes structure and drops empty errors', () => {
  assert.equal(mapCircuitError(null), null);
  assert.equal(mapCircuitError(undefined), null);
  assert.equal(mapCircuitError({}), null);
  assert.equal(mapCircuitError({ oem: null, text: null }), null);
  assert.equal(mapCircuitError({ oem: '', text: '  ' }), null);
  assert.deepEqual(mapCircuitError({ oem: 55, text: 'fault' }), { oem: '55', text: 'fault' });
  assert.deepEqual(mapCircuitError({ text: 'fault' }), { oem: null, text: 'fault' });
  assert.deepEqual(mapCircuitError({ oem: 0, text: 'fault' }), { oem: '0', text: 'fault' });
});

test('normalizeSignalStrength accepts only known enum values', () => {
  assert.equal(normalizeSignalStrength('excellent'), 'excellent');
  assert.equal(normalizeSignalStrength('NO_SIGNAL'), 'no_signal');
  assert.equal(normalizeSignalStrength('unknown-value'), null);
  assert.equal(normalizeSignalStrength(null), null);
});

test('sensor helpers support temperature and humidity with outdoor recommendations only', () => {
  assert.equal(isSupportedSensor({ type: 'temperature' }), true);
  assert.equal(isSupportedSensor({ type: 'humidity' }), true);
  assert.equal(isSupportedSensor({ type: 'pressure' }), false);
  assert.equal(isRecommendedSensor({ name: 'Улица', type: 'temperature' }), true);
  assert.equal(isRecommendedSensor({ name: 'Outdoor', type: 'temperature' }), true);
  assert.equal(isRecommendedSensor({ name: 'Outside Temp', type: 'temperature' }), true);
  assert.equal(isRecommendedSensor({ name: 'Погода из интернета', type: 'temperature' }), false);
  assert.equal(isRecommendedSensor({ name: 'Улица pressure', type: 'pressure' }), false);
});

test('mapZ3kDevice normalizes sensor types used by HomeKit service selection', () => {
  const mapped = mapZ3kDevice({
    id: 1,
    sensors: [{ id: 2, name: 'Humidity', type: 'HUMIDITY', value: 40 }],
  });

  assert.equal(mapped.sensors[0].type, 'humidity');
  assert.equal(mapped.sensors[0].supported, true);
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
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://my.zont.online/api/widget/v3/devices');
    assert.deepEqual(url.searchParams.getAll('device_ids'), ['123456']);
    assert.deepEqual(url.searchParams.getAll('fields'), ['circuits,modes']);
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

test('request times out and aborts a stalled fetch', async () => {
  const originalFetch = global.fetch;
  let aborted = false;

  global.fetch = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('The operation was aborted', 'AbortError'));
    });
  });

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      token: 'token-value',
      requestTimeoutMs: 1,
    });

    await assert.rejects(() => client.getDevices(), /Request timed out during GET \/devices/);
    assert.equal(aborted, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('request times out when the response body stalls mid-read', async () => {
  const originalFetch = global.fetch;
  let aborted = false;

  global.fetch = async (url, options) => ({
    status: 200,
    // Headers arrived, but reading the JSON body never resolves until aborted.
    json: () => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    }),
  });

  try {
    const client = new ZontClient({
      clientEmail: 'user@example.com',
      token: 'token-value',
      requestTimeoutMs: 1,
    });

    await assert.rejects(() => client.getDevices(), /Request timed out during GET \/devices/);
    assert.equal(aborted, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('request wraps network errors with operation and cause details', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    const error = new Error('fetch failed');
    error.cause = { code: 'ECONNRESET', hostname: 'my.zont.online' };
    throw error;
  };

  try {
    const client = new ZontClient({ clientEmail: 'user@example.com', token: 'token-value' });
    await assert.rejects(
      () => client.getDevices(),
      /Network error during GET \/devices: fetch failed \(ECONNRESET my\.zont\.online\)/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('request rejects on invalid JSON body', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    status: 502,
    async json() {
      throw new Error('Unexpected token');
    },
  });

  try {
    const client = new ZontClient({ clientEmail: 'user@example.com', token: 'token-value' });
    await assert.rejects(() => client.getDevices(), /Invalid JSON from GET \/devices: HTTP 502/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('client enforces required credentials before hitting the network', async () => {
  await assert.rejects(
    () => new ZontClient({ token: 'token-value' }).getDevices(),
    /X-ZONT-Client email is required/,
  );

  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com' }).createAuthToken(),
    /Missing login\/password for token creation/,
  );

  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com', token: 't' })
      .setCircuitTargetTemperature('bad', 'bad', 21),
    /Invalid device\/circuit id/,
  );

  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com', token: 't' })
      .setCircuitTargetTemperature(1, 2, 'bad'),
    /Invalid target temperature/,
  );
});

test('token auth without a token and basic auth without credentials both fail fast', async () => {
  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com' })
      .request({ method: 'GET', path: '/devices', authMode: 'token' }),
    /Missing token for token auth/,
  );

  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com' })
      .request({ method: 'GET', path: '/devices', authMode: 'basic' }),
    /Missing login\/password for basic auth/,
  );

  await assert.rejects(
    () => new ZontClient({ clientEmail: 'user@example.com' })
      .request({ method: 'GET', path: '/devices', authMode: 'nope' }),
    /Unsupported auth mode: nope/,
  );
});

function jsonResponse(body, status = 200) {
  return {
    status,
    async json() {
      return body;
    },
  };
}
