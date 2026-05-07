const { PLATFORM_NAME } = require('./lib/settings');
const { ZontPlatform } = require('./lib/platform');

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, ZontPlatform);
};
