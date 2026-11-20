const { ZontClient, mapDevicesResponse } = require('./zontClient');

// Pure, dependency-free helpers used by the custom Homebridge UI server.
// They are kept separate from homebridge-ui/server.js so the discovery logic
// can be unit tested without the @homebridge/plugin-ui-utils runtime.

function createUiClient(payload, ClientClass = ZontClient) {
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

  return new ClientClass({
    clientEmail,
    token,
    login,
    password,
    clientName: 'Homebridge ZONT Plugin UI',
  });
}

async function createAuthToken(payload, ClientClass = ZontClient) {
  const client = createUiClient(payload, ClientClass);
  const token = await client.createAuthToken({ totpCode: payload?.totpCode });
  return { token };
}

async function discoverDevices(payload, ClientClass = ZontClient) {
  const client = createUiClient(payload, ClientClass);
  const body = await client.getDevices({
    fields: ['circuits', 'modes', 'sensors'],
  });

  return { devices: mapDiscoveredDevices(body) };
}

function mapDiscoveredDevices(body) {
  return mapDevicesResponse(body)
    .filter((device) => {
      const hasCircuits = Array.isArray(device.circuits) && device.circuits.length > 0;
      const hasSupportedSensors = Array.isArray(device.sensors)
        && device.sensors.some((sensor) => sensor.supported);
      return hasCircuits || hasSupportedSensors;
    })
    .map((device) => ({
      ...device,
      circuits: device.circuits.map((circuit) => ({
        ...circuit,
        recommendedInclude: !circuit.technical,
      })),
    }));
}

module.exports = {
  createUiClient,
  createAuthToken,
  discoverDevices,
  mapDiscoveredDevices,
};
