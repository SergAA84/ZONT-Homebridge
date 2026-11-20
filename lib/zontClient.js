const API_BASE = 'https://my.zont.online/api/widget/v3';

class ZontApiError extends Error {
  constructor(message, { code, status, retryAfterMs } = {}) {
    super(message);
    this.name = 'ZontApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class ZontClient {
  constructor({ clientEmail, token, login, password, clientName, requestTimeoutMs }) {
    this.clientEmail = clientEmail;
    this.token = token;
    this.login = login;
    this.password = password;
    this.clientName = clientName || 'Homebridge ZONT Plugin';
    this.requestTimeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : 30_000;
    this.controllers = new Set();
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) {
      controller.abort();
    }
  }

  async createAuthToken({ totpCode } = {}) {
    this.assertClientEmail();

    if (!this.login || !this.password) {
      throw new Error('Missing login/password for token creation');
    }

    const body = await this.request({
      method: 'POST',
      path: '/authtokens',
      payload: {
        client_name: this.clientName,
        ...(typeof totpCode === 'string' && totpCode.trim() ? { totp_code: totpCode.trim() } : {}),
      },
      authMode: 'basic',
    });

    if (typeof body.token !== 'string' || !body.token.trim()) {
      throw new Error('ZONT v3 did not return token');
    }

    return body.token;
  }

  async getDevices({ deviceIds = [], fields = [], signal } = {}) {
    const params = new URLSearchParams();

    if (Array.isArray(deviceIds)) {
      deviceIds.forEach((id) => {
        if (isValidId(id)) {
          params.append('device_ids', String(Number(id)));
        }
      });
    }

    if (Array.isArray(fields)) {
      fields
        .map((field) => String(field || '').trim())
        .filter(Boolean)
        .forEach((field) => params.append('fields', field));
    }

    const body = await this.request({
      method: 'GET',
      path: '/devices',
      query: params,
      authMode: this.token ? 'token' : 'basic',
      signal,
    });

    return body;
  }

  async setCircuitTargetTemperature(deviceId, circuitId, targetTemperature, { signal } = {}) {
    const did = Number(deviceId);
    const cid = Number(circuitId);
    const target = Number(targetTemperature);

    if (!isValidId(deviceId) || !isValidId(circuitId)) {
      throw new Error('Invalid device/circuit id');
    }

    if (!['number', 'string'].includes(typeof targetTemperature)
      || (typeof targetTemperature === 'string' && !targetTemperature.trim()) || !Number.isFinite(target)) {
      throw new Error('Invalid target temperature');
    }

    const body = await this.request({
      method: 'POST',
      path: `/devices/${did}/circuits/${cid}/actions/target-temp`,
      payload: { target_temp: target },
      authMode: this.token ? 'token' : 'basic',
      signal,
    });

    return body;
  }

  async request({ method, path, payload, query, authMode, signal }) {
    this.assertClientEmail();
    if (this.closed) {
      throw new Error('ZONT client is closed');
    }

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

    const controller = new AbortController();
    this.controllers.add(controller);
    const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      let response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
          signal: requestSignal,
          redirect: 'error',
        });
      } catch (error) {
        if (requestSignal.aborted) {
          throw new ZontApiError(`Request ${this.closed ? 'cancelled' : 'timed out'} during ${method} ${path}`, { code: this.closed ? 'cancelled' : 'timeout' });
        }

        const cause = error?.cause || {};
        const networkDetails = [
          cause.code,
          cause.errno,
          cause.syscall,
          cause.hostname,
        ].filter(Boolean).join(' ');

        const details = networkDetails ? ` (${networkDetails})` : '';
        throw new ZontApiError(`Network error during ${method} ${path}: fetch failed${details}`, { code: 'network_error' });
      }

      // Keep the abort timer armed until the body has been fully read, so a
      // server that stalls mid-body still triggers the timeout instead of
      // hanging the poll/UI request indefinitely.
      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (requestSignal.aborted) {
          throw new ZontApiError(`Request ${this.closed ? 'cancelled' : 'timed out'} during ${method} ${path}`, { code: this.closed ? 'cancelled' : 'timeout' });
        }

        throw new ZontApiError(`Invalid JSON from ${method} ${path}: HTTP ${response.status}`, {
          code: 'invalid_response', status: response.status,
          retryAfterMs: parseRetryAfter(response.headers?.get('retry-after')),
        });
      }

      this.assertOk(body, `${method} ${path}`, response);

      return body;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  assertClientEmail() {
    if (!this.clientEmail) {
      throw new Error('X-ZONT-Client email is required');
    }
  }

  assertOk(body, operation, response = { status: 200 }) {
    if (response.status >= 200 && response.status < 300 && body?.ok === true) {
      return;
    }

    const code = typeof body?.error === 'string' ? body.error : 'unknown_error';
    const message = typeof body?.error_ui === 'string' ? body.error_ui : code;
    throw new ZontApiError(`ZONT ${operation} failed: ${message} (HTTP ${response.status}, ${code})`, {
      code, status: response.status,
      retryAfterMs: parseRetryAfter(response.headers?.get('retry-after')),
    });
  }
}

function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 30 * 60_000) : undefined;
}

function isValidId(value) {
  return (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapDevicesResponse(body) {
  if (!Array.isArray(body?.devices)) throw new Error('Invalid ZONT response: devices must be an array');
  return body.devices.map(mapZ3kDevice);
}

function mapZ3kDevice(device) {
  if (!device || !isValidId(device.id)) throw new Error('Invalid ZONT device id');
  for (const field of ['circuits', 'sensors']) {
    if (device[field] !== undefined && !Array.isArray(device[field])) {
      throw new Error(`Invalid ZONT device ${field}`);
    }
  }
  const circuits = Array.isArray(device?.circuits) ? device.circuits : [];

  return {
    id: Number(device.id),
    name: device.name || `Device ${String(device.id)}`,
    deviceType: device?.device_info?.id || null,
    hardwareType: device?.device_info?.model || null,
    widgetType: device?.device_info?.widget_type || null,
    online: device.online === true,
    circuits: circuits.map((circuit) => {
      if (!circuit || !isValidId(circuit.id)) throw new Error('Invalid ZONT circuit id');
      return ({
      id: Number(circuit.id),
      name: circuit.name || `Circuit ${String(circuit.id)}`,
      type: circuit.type || 'unknown',
      typeLabel: circuit.type || 'unknown',
      technical: isTechnicalCircuit(circuit),
      dependent: Boolean(circuit.is_dependent),
      targetTemp: finiteOrNull(circuit.target_temp),
      actualTemp: finiteOrNull(circuit.actual_temp),
      min: finiteOrNull(circuit.min),
      max: finiteOrNull(circuit.max),
      step: finiteOrNull(circuit.step),
      currentMode: circuit.current_mode === null || circuit.current_mode === undefined
        ? null
        : (Number.isFinite(Number(circuit.current_mode)) ? Number(circuit.current_mode) : null),
      active: circuit.active === true,
      isOff: circuit.is_off === true,
      inSummerMode: circuit.in_summer_mode === true,
      status: circuit.status || null,
      // timeLeft is mapped for discovery/diagnostics and future temporary-mode
      // support; it is not currently exposed to HomeKit.
      timeLeft: typeof circuit.time_left === 'number' && Number.isFinite(circuit.time_left)
        ? circuit.time_left
        : null,
      error: mapCircuitError(circuit.error),
      });
    }),
    sensors: mapSensors(device?.sensors),
  };
}

function mapSensors(sensors) {
  if (!Array.isArray(sensors)) {
    return [];
  }

  return sensors
    .filter((sensor) => sensor && isValidId(sensor.id))
    .map((sensor) => ({
      id: Number(sensor.id),
      name: sensor.name || `Sensor ${String(sensor.id)}`,
      type: String(sensor.type || 'unknown').toLowerCase(),
      status: sensor.status || null,
      value: finiteOrNull(sensor.value),
      unit: sensor.unit || null,
      // triggered, signalStrength and battery are surfaced in the discovery UI /
      // diagnostics; they are not mapped to HomeKit characteristics.
      triggered: typeof sensor.triggered === 'boolean' ? sensor.triggered : null,
      battery: typeof sensor.battery === 'number' ? sensor.battery : null,
      rssi: typeof sensor.rssi === 'number' ? sensor.rssi : null,
      signalStrength: normalizeSignalStrength(sensor.signal_strength),
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

const SIGNAL_STRENGTH_VALUES = new Set([
  'no_signal',
  'weak',
  'fair',
  'good',
  'excellent',
]);

function normalizeSignalStrength(value) {
  const normalized = String(value || '').toLowerCase();
  return SIGNAL_STRENGTH_VALUES.has(normalized) ? normalized : null;
}

function mapCircuitError(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const oem = normalizeErrorField(error.oem);
  const text = normalizeErrorField(error.text);

  if (oem === null && text === null) {
    return null;
  }

  return { oem, text };
}

function normalizeErrorField(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

module.exports = {
  ZontClient,
  ZontApiError,
  isValidId,
  mapDevicesResponse,
  parseRetryAfter,
  isRecommendedSensor,
  isSupportedSensor,
  mapZ3kDevice,
  mapSensors,
  mapCircuitError,
  normalizeSignalStrength,
  isTechnicalCircuit,
};
