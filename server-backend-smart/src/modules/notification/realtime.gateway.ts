import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from 'src/common/types/request-context';

/**
 * WebSocket — docs/08-hop-dong-api.md mục 9.
 *
 * ```
 * wss://api.smartface.vn/ws?token=<accessToken>
 * ```
 *
 * Sự kiện: request.decided · request.pending · attendance.recorded ·
 *          fraud.flagged · notification.new · system.maintenance
 *
 * Mỗi client được join vào room theo employeeId, companyId và role — nhờ vậy
 * phát sự kiện không bị rò rỉ chéo tenant.
 */
@WebSocketGateway({ path: '/ws', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.query.token as string) ||
      (client.handshake.auth?.token as string) ||
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        issuer: this.config.get<string>('jwt.issuer'),
      });

      if (payload.companyId) client.join(`company:${payload.companyId}`);
      if (payload.employeeId) client.join(`employee:${payload.employeeId}`);
      client.join(`user:${payload.sub}`);
      for (const role of payload.roles ?? []) {
        if (payload.companyId) client.join(`company:${payload.companyId}:role:${role}`);
      }
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {
    // Không cần dọn dẹp: socket.io tự rời room khi ngắt kết nối.
  }

  emitToEmployee(employeeId: string, event: string, payload: unknown): void {
    this.server?.to(`employee:${employeeId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToCompany(companyId: string, event: string, payload: unknown): void {
    this.server?.to(`company:${companyId}`).emit(event, payload);
  }

  /** Cảnh báo gian lận mức cao → chỉ HR / Admin công ty (AF-09, AF-21). */
  emitToCompanyRoles(companyId: string, roles: string[], event: string, payload: unknown): void {
    for (const role of roles) {
      this.server?.to(`company:${companyId}:role:${role}`).emit(event, payload);
    }
  }

  broadcastSystem(event: string, payload: unknown): void {
    this.server?.emit(event, payload);
  }
}
