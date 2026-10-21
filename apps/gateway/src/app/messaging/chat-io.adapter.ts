import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO with the same CORS allow-list as the REST API (W2), on the
 * gateway's own HTTP server. Long-polling is kept as a fallback for
 * networks that block websockets.
 */
export class ChatIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
      // CORS headers don't stop a websocket upgrade: check the Origin too.
      // Non-browser clients send none; they still need a valid token.
      allowRequest: (
        req: IncomingMessage,
        callback: (err: string | null | undefined, success: boolean) => void,
      ) => {
        const origin = req.headers.origin;
        callback(null, origin === undefined || this.origins.includes(origin));
      },
      // Messages go out over REST; clients only listen, so frames stay small.
      maxHttpBufferSize: 10_000,
    });
  }
}
