class ZontThermostatAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;
    this.Perms = platform.api.hap.Perms;
    this.service = accessory.getService(this.Service.Thermostat)
      || accessory.addService(this.Service.Thermostat);
    this.state = {
      currentTemperature: null,
      targetTemperature: null,
      hasCurrentTemperature: false,
      hasTargetTemperature: false,
      isHeating: false,
      online: false,
      dependent: false,
      cooling: accessory.context.circuitType === 'cooling',
      minTargetTemperature: 5,
      maxTargetTemperature: 35,
      targetTemperatureStep: 0.5,
      boundsWritable: false,
      updatedAt: 0,
    };
    this.updateAccessoryInformation();
    this.configureCharacteristics();
    this.markUnavailable();
  }

  configureCharacteristics() {
    const C = this.Characteristic;
    this.updateDisplayName(this.accessory.displayName);
    this.service.getCharacteristic(C.CurrentTemperature)
      .setProps({ minValue: -50, maxValue: 100, minStep: 0.1 })
      .onGet(() => this.readTemperature('currentTemperature', 'hasCurrentTemperature'));
    this.service.getCharacteristic(C.TargetTemperature)
      .onGet(() => this.readTemperature('targetTemperature', 'hasTargetTemperature'))
      .onSet(this.handleSetTargetTemperature.bind(this));
    this.service.getCharacteristic(C.CurrentHeatingCoolingState).onGet(() => {
      this.assertAvailable();
      return this.currentMode();
    });
    this.service.getCharacteristic(C.TargetHeatingCoolingState).onGet(() => {
      this.assertAvailable();
      return this.targetMode();
    }).onSet((value) => {
      this.assertAvailable();
      if (value !== this.targetMode()) throw hapError(this.platform, 'INVALID_VALUE_IN_REQUEST');
    });
    this.updateTargetProps();
  }

  targetMode() {
    const modes = this.Characteristic.TargetHeatingCoolingState;
    return this.state.cooling ? modes.COOL : modes.HEAT;
  }

  currentMode() {
    const modes = this.Characteristic.CurrentHeatingCoolingState;
    return this.state.isHeating ? (this.state.cooling ? modes.COOL : modes.HEAT) : modes.OFF;
  }

  assertAvailable() {
    if (!this.state.online || !isFresh(this.platform, this.state.updatedAt)) {
      throw notAvailableError(this.platform);
    }
  }

  readTemperature(field, flag) {
    this.assertAvailable();
    if (!this.state[flag]) throw notAvailableError(this.platform);
    return this.state[field];
  }

  updateDisplayName(name) {
    this.service.setCharacteristic(this.Characteristic.Name, name);
  }

  updateAccessoryInformation() {
    configureAccessoryInformation(this.Service, this.Characteristic, this.accessory, {
      model: this.accessory.context.circuitType || 'Circuit',
      serialNumber: `${this.accessory.context.deviceId}:${this.accessory.context.circuitId}`,
    });
  }

  updateTargetProps() {
    const P = this.Perms;
    this.service.getCharacteristic(this.Characteristic.TargetTemperature).setProps({
      minValue: this.state.minTargetTemperature,
      maxValue: this.state.maxTargetTemperature,
      minStep: this.state.targetTemperatureStep,
      perms: this.state.dependent || !this.state.boundsWritable
        ? [P.PAIRED_READ, P.NOTIFY]
        : [P.PAIRED_READ, P.PAIRED_WRITE, P.NOTIFY, P.WRITE_RESPONSE],
    });
    // Replace both the old constraint and the cached value when the circuit type
    // changes. Otherwise HAP would clamp COOL to the previous HEAT-only enum.
    this.service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [
        this.Characteristic.TargetHeatingCoolingState.OFF,
        this.Characteristic.TargetHeatingCoolingState.HEAT,
        this.Characteristic.TargetHeatingCoolingState.COOL,
      ] })
      .updateValue(this.targetMode())
      .setProps({ validValues: [this.targetMode()] });
  }

  updateState(data) {
    const bounds = normalizeTargetBounds(data.minTargetTemperature, data.maxTargetTemperature,
      data.targetTemperatureStep, data.targetTemperature);
    // Contradictory explicit constraints are not repaired by swapping them.
    // Keep the last safe HAP props, but invalidate the target and disable writes.
    Object.assign(this.state, {
      minTargetTemperature: bounds ? bounds.min : this.state.minTargetTemperature,
      maxTargetTemperature: bounds ? bounds.max : this.state.maxTargetTemperature,
      targetTemperatureStep: bounds ? bounds.step : this.state.targetTemperatureStep,
      boundsWritable: Boolean(bounds?.writable),
      dependent: Boolean(data.dependent),
      cooling: data.cooling ?? this.accessory.context.circuitType === 'cooling',
      online: Boolean(data.online) && data.status !== 'failure',
      isHeating: Boolean(data.isHeating),
      updatedAt: Date.now(),
      hasCurrentTemperature: Number.isFinite(data.currentTemperature)
        && data.currentTemperature >= -50 && data.currentTemperature <= 100,
      hasTargetTemperature: Boolean(bounds) && Number.isFinite(data.targetTemperature)
        && data.targetTemperature >= bounds.min && data.targetTemperature <= bounds.max,
    });
    if (this.state.hasCurrentTemperature) this.state.currentTemperature = data.currentTemperature;
    if (this.state.hasTargetTemperature) this.state.targetTemperature = data.targetTemperature;
    this.updateTargetProps();
    this.publishState();
  }

  markUnavailable() {
    this.state.online = false;
    this.publishState();
  }

  publishState() {
    const C = this.Characteristic;
    for (const [type, field, flag] of [
      [C.CurrentTemperature, 'currentTemperature', 'hasCurrentTemperature'],
      [C.TargetTemperature, 'targetTemperature', 'hasTargetTemperature'],
    ]) {
      this.service.updateCharacteristic(type, this.state.online && this.state[flag]
        ? this.state[field] : notAvailableError(this.platform));
    }
    this.service.updateCharacteristic(C.CurrentHeatingCoolingState,
      this.state.online ? this.currentMode() : notAvailableError(this.platform));
    this.service.updateCharacteristic(C.TargetHeatingCoolingState,
      this.state.online ? this.targetMode() : notAvailableError(this.platform));
  }

  prepareTarget(value) {
    if (this.state.dependent) throw hapError(this.platform, 'READ_ONLY_CHARACTERISTIC');
    this.assertAvailable();
    if (!this.state.hasTargetTemperature) throw notAvailableError(this.platform);
    if (!this.state.boundsWritable) throw hapError(this.platform, 'READ_ONLY_CHARACTERISTIC');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw hapError(this.platform, 'INVALID_VALUE_IN_REQUEST');
    }
    return clampTemperature(value, this.state.minTargetTemperature, this.state.maxTargetTemperature);
  }

  async handleSetTargetTemperature(value) {
    const target = this.prepareTarget(value);
    let confirmed;
    try {
      // WRITE_RESPONSE keeps HAP itself from replacing the authoritative result
      // with the requested value after this asynchronous handler completes.
      confirmed = await this.platform.setCircuitTargetTemperature(
        this.accessory.context.deviceId, this.accessory.context.circuitId, target,
      );
    } catch (error) {
      this.platform.log?.debug?.(`[ZONT] Target write failed: ${error.message}`);
      throw notAvailableError(this.platform);
    }
    // Applying a command response may have removed write permissions (dependent
    // circuit or uncertain bounds). HAP checks current perms AFTER awaiting us:
    // a successful return without WRITE_RESPONSE would restore the requested
    // value. Fail this HAP write instead, retaining the already-applied confirmed
    // reading and fail-closed read-only permissions. Do not retry the command.
    if (!this.service.getCharacteristic(this.Characteristic.TargetTemperature)
      .props.perms.includes(this.Perms.WRITE_RESPONSE)) {
      throw hapError(this.platform, 'READ_ONLY_CHARACTERISTIC');
    }
    return confirmed;
  }
}

class ZontSensorAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;
    this.sensorType = accessory.context.sensorType;
    configureAccessoryInformation(this.Service, this.Characteristic, accessory, {
      model: this.sensorType === 'humidity' ? 'Humidity Sensor' : 'Temperature Sensor',
      serialNumber: `sensor:${accessory.context.deviceId}:${accessory.context.sensorId}`,
    });
    this.service = this.getOrCreateService();
    this.state = { value: null, status: null, hasValue: false, online: false, updatedAt: 0 };
    this.configureCharacteristics();
    this.markUnavailable();
  }

  getOrCreateService() {
    const type = this.sensorType === 'humidity' ? this.Service.HumiditySensor : this.Service.TemperatureSensor;
    return this.accessory.getService(type) || this.accessory.addService(type);
  }

  valueCharacteristic() {
    return this.sensorType === 'humidity'
      ? this.Characteristic.CurrentRelativeHumidity : this.Characteristic.CurrentTemperature;
  }

  isAvailable() {
    return this.state.online && this.state.hasValue && isSensorActive(this.state.status)
      && isFresh(this.platform, this.state.updatedAt);
  }

  configureCharacteristics() {
    this.updateDisplayName(this.accessory.displayName);
    this.service.getCharacteristic(this.Characteristic.StatusFault).onGet(() => (this.isAvailable()
      ? this.Characteristic.StatusFault.NO_FAULT : this.Characteristic.StatusFault.GENERAL_FAULT));
    this.service.getCharacteristic(this.Characteristic.StatusActive).onGet(() => this.isAvailable());
    this.service.getCharacteristic(this.valueCharacteristic())
      .setProps(this.sensorType === 'humidity'
        ? { minValue: 0, maxValue: 100, minStep: 1 }
        : { minValue: -50, maxValue: 100, minStep: 0.1 })
      .onGet(() => this.readValueOrUnavailable());
  }

  readValueOrUnavailable() {
    if (!this.isAvailable()) throw notAvailableError(this.platform);
    return this.state.value;
  }

  updateDisplayName(name) {
    this.service.setCharacteristic(this.Characteristic.Name, name);
  }

  updateState(data) {
    const min = this.sensorType === 'humidity' ? 0 : -50;
    this.state.hasValue = Number.isFinite(data.value) && data.value >= min && data.value <= 100;
    if (this.state.hasValue) {
      this.state.value = this.sensorType === 'humidity'
        ? Math.round(clampTemperature(data.value, 0, 100)) : clampTemperature(data.value, -50, 100);
    }
    this.state.online = data.online === true;
    this.state.status = data.status || null;
    this.state.updatedAt = Date.now();
    this.publishState();
  }

  markUnavailable() {
    this.state.online = false;
    this.publishState();
  }

  publishState() {
    const available = this.isAvailable();
    this.service.updateCharacteristic(this.Characteristic.StatusFault, available
      ? this.Characteristic.StatusFault.NO_FAULT : this.Characteristic.StatusFault.GENERAL_FAULT);
    this.service.updateCharacteristic(this.Characteristic.StatusActive, available);
    this.service.updateCharacteristic(this.valueCharacteristic(), available
      ? this.state.value : notAvailableError(this.platform));
  }
}

function configureAccessoryInformation(Service, Characteristic, accessory, { model, serialNumber }) {
  const info = accessory.getService(Service.AccessoryInformation) || accessory.addService(Service.AccessoryInformation);
  info.setCharacteristic(Characteristic.Manufacturer, 'ZONT')
    .setCharacteristic(Characteristic.Model, String(model))
    .setCharacteristic(Characteristic.SerialNumber, String(serialNumber));
}

function hapError(platform, status) {
  return new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus[status]);
}

function notAvailableError(platform) {
  return hapError(platform, 'SERVICE_COMMUNICATION_FAILURE');
}

function isFresh(platform, updatedAt) {
  return updatedAt > 0 && Date.now() - updatedAt <= (platform.freshnessMs || 90_000);
}

function isSensorActive(status) {
  return ['ok', 'alarm', 'silent_alarm'].includes(String(status || '').toLowerCase());
}

function clampTemperature(value, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min;
}

function normalizeTargetBounds(minValue, maxValue, stepValue, targetValue) {
  const hasMin = Number.isFinite(minValue);
  const hasMax = Number.isFinite(maxValue);
  if (hasMin && hasMax && minValue > maxValue) return null;
  const target = Number.isFinite(targetValue) ? targetValue : null;
  // Fallbacks are display-only: they must never move a supplied constraint to
  // the other side. Include a known setpoint so high-temperature circuits remain
  // readable even when the API omits one or both bounds. Writes fail closed.
  const min = hasMin ? minValue : Math.min(5, hasMax ? maxValue : 5, target ?? 5);
  const max = hasMax ? maxValue : Math.max(35, min, target ?? 35);
  const step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 0.5;
  return { min, max, step, writable: hasMin && hasMax && min < max };
}

module.exports = {
  ZontSensorAccessory,
  ZontThermostatAccessory,
  _internals: { clampTemperature, normalizeTargetBounds, isSensorActive },
};
