import { io, Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;

export function getAlertsSocket(): Socket {
  if (!socket) {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';
    socket = io(`${wsUrl}/alerts`, {
      auth: { token: getToken() },
      transports: ['websocket'],
    });
  }
  return socket;
}
