// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Les modèles TensorFlow Lite sont chargés via require() par react-native-fast-tflite.
// Sans cette extension, Metro ne les empaquette pas et le require() échoue.
config.resolver.assetExts.push('tflite');

module.exports = config;
