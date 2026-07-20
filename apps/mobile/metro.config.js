// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Les modèles TensorFlow Lite sont chargés via require() par react-native-fast-tflite.
// Sans cette extension, Metro ne les empaquette pas et le require() échoue.
config.resolver.assetExts.push('tflite');

// Le CRNN bilingue (latin + arabe) est embarqué au format ONNX : c'est le
// fichier exporté et VÉRIFIÉ lecture pour lecture par tools/plate-dataset/
// export_onnx.py — l'exécuter tel quel via onnxruntime évite une conversion
// TFLite dont les couches BiLSTM sortent rarement indemnes.
config.resolver.assetExts.push('onnx');

module.exports = config;
