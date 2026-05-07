const { ZontClient, mapZ3kDevice } = require('./zontClient');
const { ACCESSORY_UUID_NAMESPACE, PLUGIN_NAME, PLATFORM_NAME } = require('./settings');
const { ZontThermostatAccessory } = require('./platformAccessory');

class ZontPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.cachedAccessories = [];
    this.runtimeAccessories = new Map();
    this.pollTimer = null;
    this.pollInProgress = false;

    this.client = new ZontClient({
      clientEmail: this.config.clientEmail,
      token: this.config.token,
      login: this.config.login,
      password: this.config.password,
      clientName: this.config.clientName || 'Homebridge ZONT Plugin',
    });

    if (!this.config.token || !this.config.clientEmail) {
      this.log.warn('[ZONT] Plugin is not configured. Open settings in Homebridge UI.');
      return;
    }

    this.api.on('didFinishLaunching', async () => {
      await this.refreshAndSyncAccessories();
      this.startPolling();
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  startPolling() {
    const pollInterval = Number(this.config.pollInterval || 30);
    const pollMs = Math.max(10, pollInterval) * 1000;

    this.pollTimer = setInterval(async () => {
      await this.refreshAndSyncAccessories();
    }, pollMs);
  }

  async setCircuitTargetTemperature(deviceId, circuitId, targetTemperature) {
    try {
      this.log.info(
        `[ZONT] Set target temperature request: device=${deviceId}, circuit=${circuitId}, target=${targetTemperature}`,
      );

      const body = await this.client.getDevices({
        deviceIds: [Number(deviceId)],
        fields: ['circuits'],
      });
      const mappedDevices = (body.devices || []).map(mapZ3kDevice);
      const mappedDevice = mappedDevices.find((d) => d.id === Number(deviceId));
      if (!mappedDevice) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const circuit = mappedDevice.circuits.find((c) => c.id === Number(circuitId));
      if (!circuit) {
        throw new Error(`Circuit ${circuitId} not found`);
      }

      await this.client.setCircuitTargetTemperature(deviceId, circuit.id, targetTemperature);
      this.log.info(`[ZONT] target-temp accepted by API v3 for circuit=${circuit.id}`);

      await this.refreshAndSyncAccessories();
    } catch (error) {
      this.log.error(`[ZONT] Failed to set target temperature for ${deviceId}:${circuitId}: ${error.message}`);
      throw error;
    }
  }

  async refreshAndSyncAccessories() {
    if (this.pollInProgress) {
      this.log.debug?.('[ZONT] Poll skipped: previous poll is still running');
      return;
    }

    this.pollInProgress = true;

    try {
      const body = await this.client.getDevices({
        fields: ['circuits', 'modes', 'sensors', 'connection'],
      });
      const mappedDevices = (body.devices || []).map(mapZ3kDevice);

      const selected = normalizeSelectedDevices(this.config.selectedDevices);
      const selectedMap = new Map(selected.map((item) => [item.id, item]));

      if (!selectedMap.size) {
        this.log.warn('[ZONT] No devices selected in plugin settings.');
      }

      const desired = [];
      for (const device of mappedDevices) {
        const selectedDevice = selectedMap.get(device.id);
        if (!selectedDevice) {
          continue;
        }

        const includeSet = new Set(selectedDevice.includeCircuitIds || []);
        const includeAll = selectedDevice.includeAll;

        for (const circuit of device.circuits) {
          if (!includeAll && !includeSet.has(circuit.id)) {
            continue;
          }

          desired.push({
            key: `${device.id}:${circuit.id}`,
            device,
            circuit,
          });
        }
      }

      await this.syncDesiredAccessories(desired);
    } catch (error) {
      this.log.error(`[ZONT] Poll failed: ${error.message}`);
    } finally {
      this.pollInProgress = false;
    }
  }

  async syncDesiredAccessories(desiredList) {
    const desiredKeys = new Set(desiredList.map((item) => item.key));

    for (const desired of desiredList) {
      const uuid = this.api.hap.uuid.generate(`${ACCESSORY_UUID_NAMESPACE}-${desired.key}`);
      let accessory = this.cachedAccessories.find((acc) => acc.UUID === uuid);

      const displayName = buildAccessoryName(this.config, desired.device.name, desired.circuit.name);

      if (!accessory) {
        accessory = new this.api.platformAccessory(displayName, uuid);
        this.cachedAccessories.push(accessory);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`[ZONT] Added accessory: ${displayName}`);
      }

      accessory.displayName = displayName;
      accessory.context.deviceId = desired.device.id;
      accessory.context.deviceName = desired.device.name;
      accessory.context.circuitId = desired.circuit.id;
      accessory.context.circuitName = desired.circuit.name;
      accessory.context.circuitType = desired.circuit.type;
      accessory.context.key = desired.key;

      let runtime = this.runtimeAccessories.get(uuid);
      if (!runtime) {
        runtime = new ZontThermostatAccessory(this, accessory);
        this.runtimeAccessories.set(uuid, runtime);
      }

      const targetTemperature = typeof desired.circuit.targetTemp === 'number'
        ? desired.circuit.targetTemp
        : 20;

      const currentTemperature = typeof desired.circuit.actualTemp === 'number'
        ? desired.circuit.actualTemp
        : targetTemperature;

      runtime.updateState({
        currentTemperature,
        targetTemperature,
        isHeating: isCircuitHeating(desired.circuit),
        online: desired.device.online,
        minTargetTemperature: desired.circuit.min,
        maxTargetTemperature: desired.circuit.max,
        targetTemperatureStep: desired.circuit.step,
      });
    }

    const stale = this.cachedAccessories.filter((acc) => !desiredKeys.has(acc.context.key));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);

      for (const accessory of stale) {
        this.runtimeAccessories.delete(accessory.UUID);
        this.log.info(`[ZONT] Removed accessory: ${accessory.displayName}`);
      }

      this.cachedAccessories = this.cachedAccessories.filter((acc) => desiredKeys.has(acc.context.key));
    }
  }
}

function isCircuitHeating(circuit) {
  if (circuit.isOff) {
    return false;
  }

  if (circuit.inSummerMode) {
    return false;
  }

  if (typeof circuit.active === 'boolean') {
    return circuit.active;
  }

  return String(circuit.status || '') === 'ok';
}

function normalizeSelectedDevices(selectedDevices) {
  if (!Array.isArray(selectedDevices)) {
    return [];
  }

  return selectedDevices
    .map((item) => ({
      id: Number(item?.id),
      includeAll: inferIncludeAll(item),
      includeCircuitIds: Array.isArray(item?.includeCircuitIds)
        ? item.includeCircuitIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [],
    }))
    .filter((item) => Number.isFinite(item.id));
}

function inferIncludeAll(item) {
  if (typeof item?.includeAll === 'boolean') {
    return item.includeAll;
  }

  if (!Array.isArray(item?.includeCircuitIds) || item.includeCircuitIds.length === 0) {
    return true;
  }

  return false;
}

function buildAccessoryName(config, deviceName, circuitName) {
  const naming = config?.accessoryNameMode || 'device_and_circuit';
  const safeDeviceName = sanitizeHomeKitName(deviceName, 'ZONT');
  const safeCircuitName = sanitizeHomeKitName(circuitName, 'Circuit');

  if (naming === 'circuit_only') {
    return safeCircuitName;
  }

  return sanitizeHomeKitName(`${safeDeviceName} - ${safeCircuitName}`, safeCircuitName);
}

function sanitizeHomeKitName(value, fallback) {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  return name || fallback;
}

module.exports = {
  ZontPlatform,
  _internals: {
    buildAccessoryName,
    inferIncludeAll,
    isCircuitHeating,
    normalizeSelectedDevices,
    sanitizeHomeKitName,
  },
};
