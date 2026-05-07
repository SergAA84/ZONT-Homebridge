let HomebridgePluginUiServer;
let RequestError;

try {
  ({ HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils'));
} catch (error) {
  console.error(`[homebridge-zont-thermostat] Failed to load @homebridge/plugin-ui-utils: ${error.message}`);
  throw error;
}

const { ZontClient, mapZ3kDevice } = require('../lib/zontClient');

function toRequestError(error, code) {
  if (RequestError) {
    return new RequestError(error.message, { code });
  }

  return error;
}

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/auth-token', this.handleAuthToken.bind(this));
    this.onRequest('/discover', this.handleDiscover.bind(this));

    console.log('[homebridge-zont-thermostat] Custom UI server ready');
    this.ready();
  }

  async handleAuthToken(payload) {
    try {
      const client = this.createClient(payload);
      const token = await client.createAuthToken();

      return { token };
    } catch (error) {
      throw toRequestError(error, 'AUTH_FAILED');
    }
  }

  async handleDiscover(payload) {
    try {
      const client = this.createClient(payload);
      const body = await client.getDevices({
        fields: ['circuits', 'modes', 'sensors', 'connection'],
      });

      const devices = (body.devices || [])
        .map(mapZ3kDevice)
        .filter((device) => Array.isArray(device.circuits) && device.circuits.length > 0)
        .map((device) => ({
          ...device,
          circuits: device.circuits.map((circuit) => ({
            ...circuit,
            recommendedInclude: !circuit.technical,
          })),
        }));

      return { devices };
    } catch (error) {
      throw toRequestError(error, 'DISCOVERY_FAILED');
    }
  }

  createClient(payload) {
    const clientEmail = payload?.clientEmail;
    const token = payload?.token;
    const login = payload?.login;
    const password = payload?.password;

    if (!clientEmail) {
      throw new Error('clientEmail is required');
    }

    if (!token && !(login && password)) {
      throw new Error('Provide token or login/password');
    }

    return new ZontClient({
      clientEmail,
      token,
      login,
      password,
      clientName: 'Homebridge ZONT Plugin UI',
    });
  }
}

try {
  (() => new UiServer())();
} catch (error) {
  console.error(`[homebridge-zont-thermostat] Custom UI server failed: ${error.stack || error.message}`);
  process.exit(1);
}
