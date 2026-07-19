module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Requis par les frame processors VisionCamera (reconnaissance temps réel
    // on-device). Doit rester le dernier plugin.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
