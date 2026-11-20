const { ZontClient, isValidId, isValidEntityId, mapDevicesResponse, mapZ3kDevice } = require('./zontClient');
const { ACCESSORY_UUID_NAMESPACE, PLUGIN_NAME, PLATFORM_NAME } = require('./settings');
const { ZontSensorAccessory, ZontThermostatAccessory } = require('./platformAccessory');

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
    this.stopped = false;
    this.revision = 0;
    this.activeWrites = 0;
    this.writeQueues = new Map();
    this.pollFailures = 0;
    this.nextPollAt = 0;
    const rawInterval = Number(this.config.pollInterval);
    this.pollIntervalMs = Math.min(300, Math.max(10, Number.isFinite(rawInterval) ? rawInterval : 30)) * 1000;
    this.freshnessMs = this.pollIntervalMs * 3;

    this.client = new ZontClient({
      clientEmail: this.config.clientEmail,
      token: this.config.token,
      login: this.config.login,
      password: this.config.password,
      requestTimeoutMs: 8_000,
    });

    this.api.on('shutdown', () => {
      this.stopped = true;
      this.client.close();
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    });

    if (!this.config.token || !this.config.clientEmail) {
      this.log.warn('[ZONT] Plugin is not configured. Open settings in Homebridge UI.');
      return;
    }

    this.api.on('didFinishLaunching', async () => {
      await this.refreshAndSyncAccessories();

      // Do not schedule polling if Homebridge started shutting down during the
      // initial refresh.
      if (!this.stopped) {
        this.startPolling();
      }
    });

  }

  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
    // Install handlers before the first network request, including when ZONT is
    // unavailable at startup. Never let a restored writable value act as a stub.
    const sensor = accessory.context.accessoryType === 'sensor';
    const runtime = sensor ? new ZontSensorAccessory(this, accessory) : new ZontThermostatAccessory(this, accessory);
    this.runtimeAccessories.set(accessory.UUID, runtime);
  }

  removeSensorService(accessory, sensorType) {
    const serviceType = sensorType === 'humidity'
      ? this.Service.HumiditySensor
      : this.Service.TemperatureSensor;

    const service = accessory.getService(serviceType);
    if (service && typeof accessory.removeService === 'function') {
      accessory.removeService(service);
    }
  }

  startPolling() {
    if (this.stopped || this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      await this.refreshAndSyncAccessories();
    }, this.pollIntervalMs);
  }

  setCircuitTargetTemperature(deviceId, circuitId, targetTemperature) {
    const key = `${deviceId}:${circuitId}`;
    const signal = AbortSignal.timeout(8_000);
    const previous = this.writeQueues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.writeCircuitTarget(deviceId, circuitId, targetTemperature, signal));
    this.writeQueues.set(key, run);
    // Both branches consume the cleanup promise, avoiding unhandled rejections.
    const cleanup = () => { if (this.writeQueues.get(key) === run) this.writeQueues.delete(key); };
    run.then(cleanup, cleanup);
    return run;
  }

  async writeCircuitTarget(deviceId, circuitId, targetTemperature, signal) {
    const did = Number(deviceId);
    const cid = Number(circuitId);
    const uuid = this.api.hap.uuid.generate(`${ACCESSORY_UUID_NAMESPACE}-${did}:${cid}`);
    const runtime = this.runtimeAccessories.get(uuid);
    let attempted = false;
    this.activeWrites += 1;
    this.revision += 1;
    try {
      if (this.stopped) throw new Error('ZONT platform is stopped');
      if (signal.aborted) throw new Error('Circuit command expired while queued');
      if (!isValidId(deviceId) || !isValidEntityId(circuitId) || !Number.isFinite(targetTemperature)) {
        throw new Error('Invalid circuit command');
      }
      if (runtime?.state?.dependent) {
        throw new Error(`Circuit ${cid} is dependent; target temperature is controlled by its master circuit`);
      }
      if (!runtime) throw new Error('Circuit is not registered');
      targetTemperature = runtime.prepareTarget(targetTemperature);
      this.log.info(
        `[ZONT] Set target temperature request: device=${deviceId}, circuit=${circuitId}, target=${targetTemperature}`,
      );
      // One shared deadline includes the confirmation read and stays below HAP's
      // ten-second write deadline. Never automatically retry a POST.
      attempted = true;
      const response = await this.client.setCircuitTargetTemperature(did, cid, targetTemperature, { signal });
      this.log.info(`[ZONT] target-temp accepted by API v3 for circuit=${cid}`);
      let updatedDevice = response?.device ? mapZ3kDevice(response.device) : null;
      if (!updatedDevice || updatedDevice.id !== did
        || !Number.isFinite(updatedDevice.circuits.find((c) => c.id === cid)?.targetTemp)) {
        const body = await this.client.getDevices({ deviceIds: [did], fields: ['circuits'], signal });
        updatedDevice = mapDevicesResponse(body).find((d) => d.id === did);
      }
      if (this.stopped) throw new Error('ZONT platform is stopped');
      const circuit = updatedDevice?.circuits.find((c) => c.id === cid);
      if (!updatedDevice?.online || !Number.isFinite(circuit?.targetTemp)
        || !this.applyCircuitUpdate(updatedDevice, cid) || !runtime.state.online || !runtime.state.hasTargetTemperature) {
        throw new Error('ZONT did not return an available confirmed circuit target');
      }
      return runtime.state.targetTemperature;
    } catch (error) {
      if (!this.stopped && attempted && runtime) runtime.markUnavailable();
      if (error.retryAfterMs) this.nextPollAt = Math.max(this.nextPollAt, Date.now() + error.retryAfterMs);
      this.log.error(`[ZONT] Failed to set target temperature for ${deviceId}:${circuitId}: ${error.message}`);
      throw error;
    } finally {
      this.activeWrites -= 1;
      this.revision += 1;
    }
  }

  applyCircuitUpdate(device, circuitId) {
    const uuid = this.api.hap.uuid.generate(`${ACCESSORY_UUID_NAMESPACE}-${device.id}:${circuitId}`);
    const runtime = this.runtimeAccessories.get(uuid);
    const circuit = device.circuits.find((c) => c.id === Number(circuitId));

    if (!runtime || !circuit) {
      return false;
    }

    this.applyCircuitToRuntime(runtime, device, circuit);
    return true;
  }

  applyCircuitToRuntime(runtime, device, circuit) {
    const update = {
      targetTemperature: circuit.targetTemp,
      currentTemperature: circuit.actualTemp,
      isHeating: isCircuitHeating(circuit),
      online: device.online,
      status: circuit.status,
      cooling: circuit.type === 'cooling',
      minTargetTemperature: circuit.min,
      maxTargetTemperature: circuit.max,
      targetTemperatureStep: circuit.step,
      dependent: Boolean(circuit.dependent),
    };

    runtime.updateState(update);

    if (circuit.error && (circuit.error.oem || circuit.error.text)) {
      const oem = circuit.error.oem ? `[${circuit.error.oem}] ` : '';
      this.log.warn(`[ZONT] Circuit error on ${device.name}/${circuit.name}: ${oem}${circuit.error.text || 'unknown'}`);
    } else if (circuit.status === 'failure') {
      this.log.warn(`[ZONT] Circuit failure on ${device.name}/${circuit.name}`);
    }
  }

  async refreshAndSyncAccessories() {
    if (this.stopped || this.activeWrites || Date.now() < this.nextPollAt) {
      return;
    }

    if (this.pollInProgress) {
      this.log.debug?.('[ZONT] Poll skipped: previous poll is still running');
      return;
    }

    this.pollInProgress = true;
    const revision = this.revision;

    try {
      const body = await this.client.getDevices({
        fields: ['circuits', 'modes', 'sensors'],
      });
      const mappedDevices = mapDevicesResponse(body);

      const selected = normalizeSelectedDevices(this.config.selectedDevices);
      const selectedMap = new Map(selected.map((item) => [item.id, item]));
      const selectedSensors = normalizeSelectedSensors(this.config.selectedSensors);
      const selectedSensorMap = new Map(selectedSensors.map((item) => [item.deviceId, item]));

      const desired = [];
      for (const device of mappedDevices) {
        const selectedDevice = selectedMap.get(device.id);
        if (selectedDevice) {
          const includeSet = new Set(selectedDevice.includeCircuitIds || []);
          const includeAll = selectedDevice.includeAll;

          for (const circuit of device.circuits) {
            if (!includeAll && !includeSet.has(circuit.id)) {
              continue;
            }

            desired.push({
              type: 'thermostat',
              key: `${device.id}:${circuit.id}`,
              device,
              circuit,
            });
          }
        }

        const selectedSensorDevice = selectedSensorMap.get(device.id);
        if (!selectedSensorDevice) {
          continue;
        }

        const sensorSet = new Set(selectedSensorDevice.sensorIds || []);
        for (const sensor of device.sensors) {
          if (!sensor.supported || !sensorSet.has(sensor.id)) {
            continue;
          }

          desired.push({
            type: 'sensor',
            key: `sensor:${device.id}:${sensor.id}`,
            device,
            sensor,
          });
        }
      }

      // The network call above may have completed after shutdown began.
      // Avoid registering/unregistering accessories during teardown.
      if (this.stopped || revision !== this.revision) {
        return;
      }

      await this.syncDesiredAccessories(desired);
      this.pollFailures = 0;
      this.nextPollAt = 0;
    } catch (error) {
      if (this.stopped || revision !== this.revision) return;
      for (const runtime of this.runtimeAccessories.values()) runtime.markUnavailable();
      this.pollFailures = Math.min(this.pollFailures + 1, 10);
      const backoff = Math.min(30 * 60_000, this.pollIntervalMs * (2 ** (this.pollFailures - 1)));
      this.nextPollAt = Date.now() + Math.max(backoff, error.retryAfterMs || 0);
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

      const displayName = desired.type === 'sensor'
        ? buildSensorAccessoryName(this.config, desired.device.name, desired.sensor.name)
        : buildAccessoryName(this.config, desired.device.name, desired.circuit.name);

      const isNew = !accessory;
      if (isNew) {
        accessory = new this.api.platformAccessory(displayName, uuid);
        this.cachedAccessories.push(accessory);

      }

      accessory.displayName = displayName;
      accessory.context.accessoryType = desired.type;
      accessory.context.deviceId = desired.device.id;
      accessory.context.deviceName = desired.device.name;
      accessory.context.key = desired.key;

      if (desired.type === 'sensor') {
        // Capture the previously persisted type before overwriting it, so a
        // type change is detected even after a restart when no runtime exists
        // yet (the restored accessory still carries the old service).
        const previousSensorType = accessory.context.sensorType;

        accessory.context.sensorId = desired.sensor.id;
        accessory.context.sensorName = desired.sensor.name;
        accessory.context.sensorType = desired.sensor.type;

        let runtime = this.runtimeAccessories.get(uuid);

        // If the ZONT sensor type changed while keeping the same id, drop the
        // stale service and recreate the runtime so the correct HomeKit service
        // is used (and the old one is not left behind after a restart).
        if (previousSensorType && previousSensorType !== desired.sensor.type) {
          this.removeSensorService(accessory, previousSensorType);
          this.runtimeAccessories.delete(uuid);
          runtime = null;
        }

        if (!runtime) {
          runtime = new ZontSensorAccessory(this, accessory);
          this.runtimeAccessories.set(uuid, runtime);
        }

        runtime.updateDisplayName(displayName);
        runtime.updateState({
          value: desired.sensor.value,
          status: desired.sensor.status,
          online: desired.device.online,
        });
        if (isNew) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        continue;
      }

      accessory.context.circuitId = desired.circuit.id;
      accessory.context.circuitName = desired.circuit.name;
      accessory.context.circuitType = desired.circuit.type;

      let runtime = this.runtimeAccessories.get(uuid);
      if (!runtime) {
        runtime = new ZontThermostatAccessory(this, accessory);
        this.runtimeAccessories.set(uuid, runtime);
      }

      runtime.updateDisplayName(displayName);
      runtime.updateAccessoryInformation();
      this.applyCircuitToRuntime(runtime, desired.device, desired.circuit);
      if (isNew) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Absence from a cloud snapshot is not explicit user removal. Keep selected
    // accessories (and their Home automations), but report them unavailable.
    const selected = normalizeSelectedDevices(this.config.selectedDevices);
    const sensors = normalizeSelectedSensors(this.config.selectedSensors);
    const isSelected = (accessory) => {
      const c = accessory.context;
      return c.accessoryType === 'sensor'
        ? sensors.some((d) => d.deviceId === c.deviceId && d.sensorIds.includes(c.sensorId))
        : selected.some((d) => d.id === c.deviceId && (d.includeAll || d.includeCircuitIds.includes(c.circuitId)));
    };
    for (const accessory of this.cachedAccessories) {
      if (!desiredKeys.has(accessory.context.key)) this.runtimeAccessories.get(accessory.UUID)?.markUnavailable();
    }
    const stale = this.cachedAccessories.filter((acc) => !isSelected(acc));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);

      for (const accessory of stale) {
        this.runtimeAccessories.delete(accessory.UUID);
        this.log.info(`[ZONT] Removed accessory: ${accessory.displayName}`);
      }

      this.cachedAccessories = this.cachedAccessories.filter((acc) => !stale.includes(acc));
    }
    this.api.updatePlatformAccessories?.(this.cachedAccessories);
  }
}

function isCircuitHeating(circuit) {
  return circuit.active === true && !circuit.isOff && !circuit.inSummerMode && circuit.status !== 'failure';
}

function normalizeSelectedDevices(selectedDevices) {
  if (!Array.isArray(selectedDevices)) {
    return [];
  }

  return selectedDevices
    .filter((item) => isValidId(item?.id))
    .map((item) => ({
      id: Number(item?.id),
      includeAll: inferIncludeAll(item),
      includeCircuitIds: Array.isArray(item?.includeCircuitIds)
        ? item.includeCircuitIds.filter(isValidEntityId).map(Number)
        : [],
    }));
}

function normalizeSelectedSensors(selectedSensors) {
  if (!Array.isArray(selectedSensors)) {
    return [];
  }

  return selectedSensors
    .filter((item) => isValidId(item?.deviceId))
    .map((item) => ({
      deviceId: Number(item?.deviceId),
      sensorIds: Array.isArray(item?.sensorIds)
        ? item.sensorIds.filter(isValidEntityId).map(Number)
        : [],
    }))
    .filter((item) => item.sensorIds.length > 0);
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

function buildSensorAccessoryName(config, deviceName, sensorName) {
  return buildAccessoryName(config, deviceName, sensorName);
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
    buildSensorAccessoryName,
    inferIncludeAll,
    isCircuitHeating,
    normalizeSelectedDevices,
    normalizeSelectedSensors,
    sanitizeHomeKitName,
  },
};
