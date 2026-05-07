const assert = require('node:assert/strict');
const test = require('node:test');

const { ZontClient, mapZ3kDevice } = require('../lib/zontClient');

test('live ZONT Widget API v3 discovery smoke test', async (t) => {
  const clientEmail = process.env.ZONT_CLIENT_EMAIL;
  const token = process.env.ZONT_TOKEN;
  const login = process.env.ZONT_LOGIN;
  const password = process.env.ZONT_PASSWORD;

  if (!clientEmail || (!token && !(login && password))) {
    t.skip('Set ZONT_CLIENT_EMAIL and ZONT_TOKEN, or ZONT_CLIENT_EMAIL with ZONT_LOGIN/ZONT_PASSWORD, to run live API smoke test.');
    return;
  }

  const client = new ZontClient({ clientEmail, token, login, password });
  const deviceIds = process.env.ZONT_DEVICE_ID ? [Number(process.env.ZONT_DEVICE_ID)] : [];

  const body = await client.getDevices({
    deviceIds,
    fields: ['circuits', 'modes', 'sensors', 'connection'],
  });

  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.devices));

  if (deviceIds.length) {
    assert.ok(body.devices.some((device) => Number(device.id) === deviceIds[0]));
  }

  const mappedDevices = body.devices.map(mapZ3kDevice);
  assert.ok(mappedDevices.every((device) => Number.isFinite(device.id)));
  assert.ok(mappedDevices.every((device) => Array.isArray(device.circuits)));
});
