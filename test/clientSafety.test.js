const assert = require('node:assert/strict');
const test = require('node:test');
const { ZontClient, ZontApiError, isValidId, mapDevicesResponse, mapZ3kDevice, parseRetryAfter } = require('../lib/zontClient');
const { createAuthToken } = require('../lib/uiDiscovery');

const client = () => new ZontClient({ clientEmail: 'audit@example.invalid', token: 'test-token', login: 'login', password: 'secret' });

test('2FA forwards a string TOTP/backup code only for token creation', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: true, token: 'created-token' });
  });
  await createAuthToken({ clientEmail: 'audit@example.invalid', login: 'login', password: 'secret', totpCode: ' 012345 ' });
  assert.equal(JSON.parse(calls[0].options.body).totp_code, '012345');
  assert.equal(calls[0].options.redirect, 'error');
  await client().createAuthToken({ totpCode: '' });
  assert.equal(JSON.parse(calls[1].options.body).totp_code, undefined);
  await client().createAuthToken({ totpCode: 'backup-code' });
  assert.equal(JSON.parse(calls[2].options.body).totp_code, 'backup-code');
});

test('token creation rejects missing/invalid tokens even on an ok response', async (t) => {
  for (const token of [null, '', '  ', 123]) {
    t.mock.method(global, 'fetch', async () => Response.json({ ok: true, token }));
    await assert.rejects(() => client().createAuthToken(), /did not return token/);
  }
});

test('HTTP errors cannot be accepted because a body happens to say ok', async (t) => {
  t.mock.method(global, 'fetch', async () => Response.json({ ok: true }, { status: 500 }));
  await assert.rejects(() => client().getDevices(), (error) => error instanceof ZontApiError && error.status === 500);
  t.mock.method(global, 'fetch', async () => Response.json({ ok: 'true' }));
  await assert.rejects(() => client().getDevices(), /unknown_error/);
});

test('429 preserves machine code, HTTP status and Retry-After for the scheduler', async (t) => {
  t.mock.method(global, 'fetch', async () => Response.json({ ok: false, error: 'rate_limit', error_ui: 'Wait' }, {
    status: 429, headers: { 'Retry-After': '120' },
  }));
  await assert.rejects(() => client().getDevices(), (error) => {
    assert.equal(error.code, 'rate_limit');
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 120_000);
    return true;
  });
});

test('non-JSON HTTP errors keep retry metadata without exposing raw response content', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('<html>upstream unavailable</html>', {
    status: 503, headers: { 'Retry-After': '30' },
  }));
  await assert.rejects(() => client().getDevices(), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.retryAfterMs, 30_000);
    assert.equal(error.code, 'invalid_response');
    assert.ok(!error.message.includes('<html>'));
    return true;
  });
});

test('Retry-After supports dates, invalid inputs and a bounded maximum delay', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(parseRetryAfter('Fri, 20 Nov 2026 12:01:00 GMT', now), 60_000);
  assert.equal(parseRetryAfter('999999999'), 1_800_000);
  for (const value of [undefined, '', ' ', 'bad', '-1', 'Thu, 19 Nov 2026 12:00:00 GMT']) {
    assert.equal(parseRetryAfter(value, now), undefined);
  }
});

test('closing a client aborts in-flight requests and rejects new work', async (t) => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(global, 'fetch', async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    started();
  }));
  const c = client();
  const pending = c.getDevices();
  await ready;
  c.close();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(c.controllers.size, 0);
  await assert.rejects(() => c.getDevices(), /closed/);
});

test('external deadlines abort reads and no POST is automatically retried', async (t) => {
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls += 1;
    throw new Error('test-token must not be logged');
  });
  await assert.rejects(() => client().setCircuitTargetTemperature(1, 10, 22), (error) => {
    assert.equal(error.code, 'network_error');
    assert.ok(!error.message.includes('test-token'));
    return true;
  });
  assert.equal(calls, 1);
  t.mock.method(global, 'fetch', async (url, options) => {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(() => client().getDevices({ signal: AbortSignal.abort() }), /timed out/);
});

test('IDs reject coercion traps while preserving the valid zero sensor id', async () => {
  for (const value of [null, undefined, '', ' ', true, false, NaN, Infinity, -1, 1.5, '1/2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isValidId(value), false);
    await assert.rejects(() => client().setCircuitTargetTemperature(value, 1, 22), /Invalid device/);
  }
  assert.equal(isValidId(0), true);
  assert.equal(isValidId('0'), true);
  for (const value of [null, '', true, Infinity, NaN]) {
    await assert.rejects(() => client().setCircuitTargetTemperature(1, 2, value), /Invalid target/);
  }
});

test('mapping validates snapshot structure and prevents non-finite readings', () => {
  assert.throws(() => mapDevicesResponse({}), /devices must/);
  assert.throws(() => mapDevicesResponse({ devices: [null] }), /device id/);
  assert.throws(() => mapZ3kDevice({ id: 1, circuits: [null] }), /circuit id/);
  assert.throws(() => mapZ3kDevice({ id: 1, sensors: {} }), /device sensors/);
  const mapped = mapZ3kDevice({ id: 1, circuits: [{ id: 2, actual_temp: NaN, target_temp: Infinity }], sensors: [null, { id: null }, { id: 0, value: Infinity }] });
  assert.equal(mapped.circuits[0].actualTemp, null);
  assert.equal(mapped.circuits[0].targetTemp, null);
  assert.equal(mapped.sensors.length, 1);
  assert.equal(mapped.sensors[0].id, 0);
  assert.equal(mapped.sensors[0].value, null);
});
