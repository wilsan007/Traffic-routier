import Constants from 'expo-constants';
import { io, Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export async function getAlertsSocket(): Promise<Socket> {
  if (!socket) {
    const wsUrl =
      process.env.EXPO_PUBLIC_WS_URL ?? (Constants.expoConfig?.extra?.wsUrl as string) ?? 'ws://localhost:3001';
    const token = await getToken();
    socket = io(`${wsUrl}/alerts`, {
      auth: { token },
      transports: ['websocket'],
    });
  }
  return socket;
}
