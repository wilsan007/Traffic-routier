import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// Canal temps réel des opérations : positions des agents + messagerie
@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: 'ops' })
export class OpsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OpsGateway.name);

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string);
    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
    } catch {
      this.logger.warn(`Connexion ops refusée: ${client.id}`);
      client.disconnect(true);
    }
  }

  emitAgentLocation(location: unknown) {
    this.server.emit('agent.location', location);
  }

  emitMessage(message: unknown) {
    this.server.emit('message.new', message);
  }
}
