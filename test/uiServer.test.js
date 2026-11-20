const assert = require('node:assert/strict');
const test = require('node:test');
const { RequestError } = require('@homebridge/plugin-ui-utils');
const { UiServer } = require('../homebridge-ui/server');

test('real UI-utils server registers IPC routes, handles discovery/auth and wraps failures', async (t) => {
  const previousSend = Object.getOwnPropertyDescriptor(process, 'send');
  const listeners = new Map(['message', 'disconnect'].map((event) => [event, process.listeners(event)]));
  const messages = [];
  process.send = (message) => messages.push(message);
  t.after(() => {
    for (const [event, original] of listeners) {
      for (const listener of process.listeners(event)) {
        if (!original.includes(listener)) process.removeListener(event, listener);
      }
    }
    if (previousSend) Object.defineProperty(process, 'send', previousSend);
    else delete process.send;
  });
  const server = new UiServer();
  assert.equal(messages[0].action, 'ready');
  assert.equal(typeof server.handlers['/discover'], 'function');
  t.mock.method(global, 'fetch', async (url, options) => {
    if (url.endsWith('/authtokens')) {
      assert.equal(JSON.parse(options.body).totp_code, '012345');
      return Response.json({ ok: true, token: 'new-token' });
    }
    return Response.json({ ok: true, devices: [{ id: 1, online: true, sensors: [{ id: 0, name: 'Outdoor', type: 'temperature', value: 12, status: 'ok' }] }] });
  });
  const auth = await server.handleAuthToken({ clientEmail: 'audit@example.invalid', login: 'test-login', password: 'test-password', totpCode: '012345' });
  assert.deepEqual(auth, { token: 'new-token' });
  const discovery = await server.handleDiscover({ clientEmail: 'audit@example.invalid', token: auth.token });
  assert.equal(discovery.devices[0].sensors[0].id, 0);
  for (const [method, code] of [['handleAuthToken', 'AUTH_FAILED'], ['handleDiscover', 'DISCOVERY_FAILED']]) {
    await assert.rejects(() => server[method]({}), (error) => error instanceof RequestError && error.requestError.code === code);
  }
});
