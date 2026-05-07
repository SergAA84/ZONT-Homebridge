class ZontThermostatAccessory {
  constructor(platform, accessory) {
    this.platform = platform;
    this.accessory = accessory;

    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;

    this.service = this.accessory.getService(this.Service.Thermostat)
      || this.accessory.addService(this.Service.Thermostat);

    this.state = {
      currentTemperature: 20,
      targetTemperature: 20,
      isHeating: false,
      online: false,
      minTargetTemperature: 5,
      maxTargetTemperature: 35,
      targetTemperatureStep: 0.5,
    };

    this.configureCharacteristics();
  }

  configureCharacteristics() {
    this.service.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

    this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({ minValue: -50, maxValue: 100, minStep: 0.1 })
      .onGet(() => this.state.currentTemperature);

    this.service.getCharacteristic(this.Characteristic.TargetTemperature)
      .setProps({ minValue: 5, maxValue: 35, minStep: 0.5 })
      .onGet(() => this.state.targetTemperature)
      .onSet(this.handleSetTargetTemperature.bind(this));

    this.service.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => {
        if (!this.state.online) {
          return this.Characteristic.CurrentHeatingCoolingState.OFF;
        }

        return this.state.isHeating
          ? this.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.Characteristic.CurrentHeatingCoolingState.OFF;
      });

    this.service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [this.Characteristic.TargetHeatingCoolingState.HEAT],
      })
      .onGet(() => this.Characteristic.TargetHeatingCoolingState.HEAT);
  }

  updateState(data) {
    if (typeof data.currentTemperature === 'number') {
      this.state.currentTemperature = data.currentTemperature;
    }

    if (typeof data.targetTemperature === 'number') {
      this.state.targetTemperature = data.targetTemperature;
    }

    this.state.isHeating = Boolean(data.isHeating);
    this.state.online = Boolean(data.online);

    if (typeof data.minTargetTemperature === 'number') {
      this.state.minTargetTemperature = data.minTargetTemperature;
    }

    if (typeof data.maxTargetTemperature === 'number') {
      this.state.maxTargetTemperature = data.maxTargetTemperature;
    }

    if (typeof data.targetTemperatureStep === 'number' && data.targetTemperatureStep > 0) {
      this.state.targetTemperatureStep = data.targetTemperatureStep;
    }

    const normalizedBounds = normalizeTargetBounds(
      this.state.minTargetTemperature,
      this.state.maxTargetTemperature,
      this.state.targetTemperatureStep,
    );

    this.state.minTargetTemperature = normalizedBounds.min;
    this.state.maxTargetTemperature = normalizedBounds.max;
    this.state.targetTemperatureStep = normalizedBounds.step;

    this.state.targetTemperature = clampTemperature(
      this.state.targetTemperature,
      this.state.minTargetTemperature,
      this.state.maxTargetTemperature,
    );

    this.service.getCharacteristic(this.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.state.minTargetTemperature,
        maxValue: this.state.maxTargetTemperature,
        minStep: this.state.targetTemperatureStep,
      });

    this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.state.currentTemperature);
    this.service.updateCharacteristic(this.Characteristic.TargetTemperature, this.state.targetTemperature);

    const currentHeatingCoolingState = this.state.online && this.state.isHeating
      ? this.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.Characteristic.CurrentHeatingCoolingState.OFF;

    this.service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, currentHeatingCoolingState);
    this.service.updateCharacteristic(
      this.Characteristic.TargetHeatingCoolingState,
      this.Characteristic.TargetHeatingCoolingState.HEAT,
    );
  }

  async handleSetTargetTemperature(value) {
    const requested = Number(value);
    const target = clampTemperature(
      requested,
      this.state.minTargetTemperature,
      this.state.maxTargetTemperature,
    );

    await this.platform.setCircuitTargetTemperature(
      this.accessory.context.deviceId,
      this.accessory.context.circuitId,
      target,
    );

    this.state.targetTemperature = target;
  }
}

module.exports = {
  ZontThermostatAccessory,
  _internals: {
    clampTemperature,
    normalizeTargetBounds,
  },
};

function clampTemperature(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  if (numeric < min) {
    return min;
  }

  if (numeric > max) {
    return max;
  }

  return numeric;
}

function normalizeTargetBounds(minValue, maxValue, stepValue) {
  let min = Number.isFinite(minValue) ? minValue : 5;
  let max = Number.isFinite(maxValue) ? maxValue : 35;
  let step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 0.5;

  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }

  if (max === min) {
    max = min + step;
  }

  return { min, max, step };
}
