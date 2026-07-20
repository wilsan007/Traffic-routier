/**
 * Lecture embarquée d'une ligne de plaque par le CRNN bilingue.
 *
 * Le modèle est l'export ONNX vérifié lecture pour lecture contre le
 * checkpoint d'atelier (tools/plate-dataset/export_onnx.py : 70/70 lectures
 * identiques). Il lit ce que ML Kit ne sait pas lire — la police 7 segments
 * et l'arabe — et ses lectures passent ensuite par la vérification croisée
 * (plateBilingue.reconcile) avant toute remontée.
 *
 * Prétraitement : STRICTEMENT celui de l'entraînement (192×48, niveaux de
 * gris, (x/255 − 0,5)/0,5). Toute divergence ici dégrade silencieusement la
 * lecture — c'est la même exigence que pour l'export : identique ou rien.
 *
 * Le recadrage est fait en amont par expo-image-manipulator (à partir des
 * boîtes de texte de ML Kit, qui sert de localisateur) et arrive ici en JPEG
 * base64 déjà réduit à 192×48 — le décodage jpeg-js d'une si petite image
 * est négligeable.
 */
import { Asset } from 'expo-asset';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import * as jpeg from 'jpeg-js';

// Metro empaquette l'ONNX comme asset (voir metro.config.js) ; l'alphabet et
// la normalisation voyagent avec lui — un alphabet désynchronisé produirait
// des lectures fausses sans aucune erreur.
const META: { alphabet: string[]; img_h: number; img_w: number } =
  require('../assets/models/plate-crnn.json');

let sessionPromise: Promise<InferenceSession> | null = null;

/**
 * Charge le modèle une seule fois (INT8, ≈2,8 Mo — quantifié et vérifié par
 * tools/plate-dataset/quantize_onnx.py : erreur caractère identique au
 * flottant sur le corpus réel).
 *
 * NNAPI d'abord : sur Android, l'exécuteur Neural Networks API route ce qu'il
 * peut vers le NPU/GPU du téléphone. Les couches LSTM n'y sont pas toujours
 * prises en charge — dans ce cas onnxruntime retombe silencieusement sur le
 * CPU pour ces nœuds, et si la création échoue entièrement on retente en CPU
 * pur : la lecture doit marcher partout, l'accélération est un bonus.
 */
function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const asset = Asset.fromModule(require('../assets/models/plate-crnn.onnx'));
      await asset.downloadAsync();
      const uri = (asset.localUri ?? asset.uri).replace('file://', '');
      try {
        return await InferenceSession.create(uri, { executionProviders: ['nnapi'] });
      } catch {
        return await InferenceSession.create(uri);
      }
    })();
  }
  return sessionPromise;
}

function base64ToBytes(b64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 3 < clean.length + 1; i += 4) {
    const n =
      (table.indexOf(clean[i]) << 18) |
      (table.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? table.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? table.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 0xff;
    if (i + 2 < clean.length && clean[i + 2] !== '=') out[o++] = (n >> 8) & 0xff;
    if (i + 3 < clean.length && clean[i + 3] !== '=') out[o++] = n & 0xff;
  }
  return out.subarray(0, o);
}

/**
 * Lit une ligne recadrée (JPEG base64, idéalement déjà 192×48).
 * Retourne la chaîne brute — latin et/ou arabe — à passer à `reconcile`.
 */
export async function readLineFromJpegBase64(b64: string): Promise<string> {
  const { width, height, data } = jpeg.decode(base64ToBytes(b64), {
    useTArray: true,
    formatAsRGBA: true,
  });

  const W = META.img_w;
  const H = META.img_h;
  const input = new Float32Array(W * H);
  // Rééchantillonnage au plus proche voisin : l'image arrive déjà à la bonne
  // taille via le manipulateur, ceci n'est qu'un filet de sécurité.
  for (let y = 0; y < H; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / W));
      const p = (sy * width + sx) * 4;
      // Luminance ITU-R 601 — le convert('L') de PIL utilisé à l'entraînement.
      const gris = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      input[y * W + x] = (gris / 255 - 0.5) / 0.5;
    }
  }

  const session = await getSession();
  const sortie = await session.run({
    image: new Tensor('float32', input, [1, 1, H, W]),
  });
  const logits = sortie.logits;
  const [, T, C] = logits.dims as number[];
  const valeurs = logits.data as Float32Array;

  // Décodage glouton CTC : argmax par pas de temps, fusion des répétitions,
  // suppression des blancs (classe 0). Le décodage contraint reste côté
  // atelier — sur l'appareil, c'est la vérification croisée puis le vote
  // temporel qui filtrent.
  let out = '';
  let prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = valeurs[t * C + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best !== prev && best !== 0) out += META.alphabet[best - 1];
    prev = best;
  }
  return out;
}
