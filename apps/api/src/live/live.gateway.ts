import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface LiveFrame {
  streamId: string;
  frame: string;
  timestamp: number;
}

export interface StreamInfo {
  streamId: string;
  userId: string;
  officerName: string;
  startedAt: number;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:4000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  },
  namespace: 'live',
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LiveGateway.name);
  private activeStreams = new Map<string, StreamInfo>();

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string);
    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      this.logger.warn(`Connexion live refusée (token invalide): ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const streamId = client.data.streamId;
    if (streamId && this.activeStreams.has(streamId)) {
      this.activeStreams.delete(streamId);
      this.server.emit('stream.ended', { streamId });
      this.logger.log(`Stream ${streamId} ended`);
    }
  }

  @SubscribeMessage('stream.start')
  handleStreamStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { officerName?: string },
  ) {
    const streamId = `live-${client.data.userId}-${Date.now()}`;
    const info: StreamInfo = {
      streamId,
      userId: client.data.userId,
      officerName: data?.officerName ?? 'Agent',
      startedAt: Date.now(),
    };
    client.data.streamId = streamId;
    this.activeStreams.set(streamId, info);
    this.server.emit('stream.started', info);
    this.logger.log(`Stream ${streamId} started by ${info.officerName}`);
    return { streamId };
  }

  @SubscribeMessage('stream.frame')
  handleStreamFrame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { streamId: string; frame: string },
  ) {
    const streamId = client.data.streamId;
    if (!streamId || !this.activeStreams.has(streamId)) return;
    this.server.emit('stream.frame', {
      streamId,
      frame: data.frame,
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('stream.stop')
  handleStreamStop(@ConnectedSocket() client: Socket) {
    const streamId = client.data.streamId;
    if (streamId && this.activeStreams.has(streamId)) {
      this.activeStreams.delete(streamId);
      this.server.emit('stream.ended', { streamId });
      this.logger.log(`Stream ${streamId} stopped`);
    }
  }

  @SubscribeMessage('stream.list')
  handleStreamList() {
    return Array.from(this.activeStreams.values());
  }
}
