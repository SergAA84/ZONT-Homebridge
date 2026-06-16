const API_BASE = 'https://my.zont.online/api/widget/v3';

class ZontClient {
  constructor({ clientEmail, token, login, password, clientName }) {
    this.clientEmail = clientEmail;
    this.token = token;
    this.login = login;
    this.password = password;
    this.clientName = clientName || 'Homebridge ZONT Plugin';
  }

  async createAuthToken() {
    this.assertClientEmail();

    if (!this.login || !this.password) {
      throw new Error('Missing login/password for token creation');
    }

    const body = await this.request({
      method: 'POST',
      path: '/authtokens',
      payload: { client_name: this.clientName },
      authMode: 'basic',
    });

    if (!body.token) {
      throw new Error('ZONT v3 did not return token');
    }

    return body.token;
  }

  async getDevices({ deviceIds = [], fields = [] } = {}) {
    const params = new URLSearchParams();

    if (Array.isArray(deviceIds)) {
      deviceIds.forEach((id) => {
        if (Number.isFinite(Number(id))) {
          params.append('device_ids', String(Number(id)));
        }
      });
    }

    if (Array.isArray(fields)) {
      const requestedFields = fields
        .map((field) => String(field || '').trim())
        .filter(Boolean);

      if (requestedFields.length) {
        params.append('fields', requestedFields.join(','));
      }
    }

    const body = await this.request({
      method: 'GET',
      path: '/devices',
      query: params,
      authMode: this.token ? 'token' : 'basic',
    });

    return body;
  }

  async setCircuitTargetTemperature(deviceId, circuitId, targetTemperature) {
    const did = Number(deviceId);
    const cid = Number(circuitId);
    const target = Number(targetTemperature);

    if (!Number.isFinite(did) || !Number.isFinite(cid)) {
      throw new Error('Invalid device/circuit id');
    }

    if (!Number.isFinite(target)) {
      throw new Error('Invalid target temperature');
    }

    const body = await this.request({
      method: 'POST',
      path: `/devices/${did}/circuits/${cid}/actions/target-temp`,
      payload: { target_temp: target },
      authMode: this.token ? 'token' : 'basic',
    });

    return body;
  }

  async request({ method, path, payload, query, authMode }) {
    this.assertClientEmail();

    const headers = {
      'Content-Type': 'application/json',
      'X-ZONT-Client': this.clientEmail,
    };

    if (authMode === 'token') {
      if (!this.token) {
        throw new Error('Missing token for token auth');
      }

      headers['X-ZONT-Token'] = this.token;
    } else if (authMode === 'basic') {
      if (!this.login || !this.password) {
        throw new Error('Missing login/password for basic auth');
      }

      headers.Authorization = `Basic ${Buffer.from(`${this.login}:${this.password}`, 'utf8').toString('base64')}`;
    } else {
      throw new Error(`Unsupported auth mode: ${String(authMode)}`);
    }

    const url = new URL(`${API_BASE}${path}`);
    if (query) {
      url.search = query.toString();
    }

    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
      });
    } catch (error) {
      const cause = error?.cause || {};
      const networkDetails = [
        cause.code,
        cause.errno,
        cause.syscall,
        cause.hostname,
      ].filter(Boolean).join(' ');

      const details = networkDetails ? ` (${networkDetails})` : '';
      throw new Error(`Network error during ${method} ${path}: ${error?.message || 'fetch failed'}${details}`);
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`Invalid JSON from ${method} ${path}: HTTP ${response.status}`);
    }

    this.assertOk(body, `${method} ${path}`);

    return body;
  }

  assertClientEmail() {
    if (!this.clientEmail) {
      throw new Error('X-ZONT-Client email is required');
    }
  }

  assertOk(body, operation) {
    if (body && body.ok) {
      return;
    }

    const code = body?.error || 'unknown_error';
    const message = body?.error_ui || code;
    throw new Error(`ZONT ${operation} failed: ${message}`);
  }
}

function mapZ3kDevice(device) {
  const circuits = Array.isArray(device?.circuits) ? device.circuits : [];

  return {
    id: Number(device.id),
    name: device.name || `Device ${String(device.id)}`,
    deviceType: device?.device_info?.id || null,
    hardwareType: device?.device_info?.model || null,
    widgetType: device?.device_info?.widget_type || null,
    online: Boolean(device?.online),
    circuits: circuits.map((circuit) => ({
      id: Number(circuit.id),
      name: circuit.name || `Circuit ${String(circuit.id)}`,
      type: circuit.type || 'unknown',
      typeLabel: circuit.type || 'unknown',
      technical: isTechnicalCircuit(circuit),
      targetTemp: typeof circuit.target_temp === 'number' ? circuit.target_temp : null,
      actualTemp: typeof circuit.actual_temp === 'number' ? circuit.actual_temp : null,
      min: typeof circuit.min === 'number' ? circuit.min : null,
      max: typeof circuit.max === 'number' ? circuit.max : null,
      step: typeof circuit.step === 'number' ? circuit.step : null,
      currentMode: circuit.current_mode === null || circuit.current_mode === undefined
        ? null
        : (Number.isFinite(Number(circuit.current_mode)) ? Number(circuit.current_mode) : null),
      active: Boolean(circuit.active),
      isOff: Boolean(circuit.is_off),
      inSummerMode: Boolean(circuit.in_summer_mode),
      status: circuit.status || null,
    })),
    sensors: mapSensors(device?.sensors),
  };
}

function mapSensors(sensors) {
  if (!Array.isArray(sensors)) {
    return [];
  }

  return sensors
    .map((sensor) => ({
      id: Number(sensor.id),
      name: sensor.name || `Sensor ${String(sensor.id)}`,
      type: sensor.type || 'unknown',
      status: sensor.status || null,
      value: typeof sensor.value === 'number' ? sensor.value : null,
      unit: sensor.unit || null,
      battery: typeof sensor.battery === 'number' ? sensor.battery : null,
      rssi: typeof sensor.rssi === 'number' ? sensor.rssi : null,
      signalStrength: sensor.signal_strength || null,
      limits: sensor.limits || null,
      recommendedInclude: isRecommendedSensor(sensor),
      supported: isSupportedSensor(sensor),
    }))
    .filter((sensor) => Number.isFinite(sensor.id));
}

function isSupportedSensor(sensor) {
  const type = String(sensor?.type || '').toLowerCase();
  return type === 'temperature' || type === 'humidity';
}

function isRecommendedSensor(sensor) {
  if (!isSupportedSensor(sensor)) {
    return false;
  }

  const name = String(sensor?.name || '').toLowerCase();
  return name.includes('улица') || name.includes('outdoor') || name.includes('outside');
}

function isTechnicalCircuit(circuit) {
  const type = String(circuit?.type || '').toLowerCase();
  return type === 'boiler' || type === 'dhw';
}

module.exports = {
  ZontClient,
  isRecommendedSensor,
  isSupportedSensor,
  mapZ3kDevice,
  mapSensors,
  isTechnicalCircuit,
};
