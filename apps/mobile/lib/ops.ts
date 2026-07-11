import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { io, Socket } from 'socket.io-client';
import { api, getToken } from './api';

let opsSocket: Socket | null = null;

export async function getOpsSocket(): Promise<Socket> {
  if (!opsSocket) {
    const wsUrl =
      process.env.EXPO_PUBLIC_WS_URL ?? (Constants.expoConfig?.extra?.wsUrl as string) ?? 'ws://localhost:3001';
    const token = await getToken();
    opsSocket = io(`${wsUrl}/ops`, {
      auth: { token },
      transports: ['websocket'],
    });
  }
  return opsSocket;
}

let locationInterval: ReturnType<typeof setInterval> | null = null;

// Partage la position de l'agent toutes les 20 s tant que le service est actif
// (visible sur la carte du centre de commandement).
export async function startLocationSharing(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return false;

  const send = async () => {
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await api.post('/ops/location', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        heading: position.coords.heading ?? undefined,
        onDuty: true,
      });
    } catch {
      // hors-ligne : on réessaiera au tick suivant
    }
  };

  await send();
  if (locationInterval) clearInterval(locationInterval);
  locationInterval = setInterval(send, 20_000);
  return true;
}

export async function stopLocationSharing(): Promise<void> {
  if (locationInterval) {
    clearInterval(locationInterval);
    locationInterval = null;
  }
  try {
    const position = await Location.getLastKnownPositionAsync();
    if (position) {
      await api.post('/ops/location', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        onDuty: false,
      });
    }
  } catch {
    // best-effort
  }
}

export function isSharingLocation(): boolean {
  return locationInterval !== null;
}
