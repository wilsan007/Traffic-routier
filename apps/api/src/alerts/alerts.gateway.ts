import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:4000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  },
  namespace: 'alerts',
})
export class AlertsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AlertsGateway.name);

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string);
    try {
      this.jwtService.verify(token);
    } catch {
      this.logger.warn(`Connexion websocket refusée (token invalide): ${client.id}`);
      client.disconnect(true);
    }
  }

  emitNewAlert(alert: unknown) {
    this.server.emit('alert.new', alert);
  }

  emitAlertUpdate(alert: unknown) {
    this.server.emit('alert.update', alert);
  }
}
