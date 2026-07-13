module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Requis par react-native-worklets-core (frame processors VisionCamera).
    // Doit rester en dernier dans la liste des plugins.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
