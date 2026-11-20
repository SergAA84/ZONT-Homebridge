let HomebridgePluginUiServer;
let RequestError;

try {
  ({ HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils'));
} catch (error) {
  console.error(`[homebridge-zont-thermostat] Failed to load @homebridge/plugin-ui-utils: ${error.message}`);
  throw error;
}

const { createAuthToken, discoverDevices } = require('../lib/uiDiscovery');

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
      return await createAuthToken(payload);
    } catch (error) {
      throw toRequestError(error, 'AUTH_FAILED');
    }
  }

  async handleDiscover(payload) {
    try {
      return await discoverDevices(payload);
    } catch (error) {
      throw toRequestError(error, 'DISCOVERY_FAILED');
    }
  }
}

if (require.main === module) {
  try {
    new UiServer();
  } catch (error) {
    console.error(`[homebridge-zont-thermostat] Custom UI server failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { UiServer };
