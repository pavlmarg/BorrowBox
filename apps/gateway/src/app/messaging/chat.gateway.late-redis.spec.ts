import { randomUUID } from 'node:crypto';
import {
  connect as connectTcp,
  createServer,
  type AddressInfo,
  type Server,
} from 'node:net';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import {
  CHAT_CHANNEL_PREFIX,
  CHAT_NAMESPACE,
  CHAT_SOCKET_EVENT,
  type ChatPush,
} from '@borrowbox/contracts';
import { freePort } from '@borrowbox/service-kit/testing';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import { FakeCatalog, FakeIdentity } from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

/**
 * Live chat when Redis is down while the gateway starts: the fan-out must
 * subscribe by itself once Redis is reachable. Its own file, because the
 * gateway's config is read once per test file.
 */
describe('Chat socket with Redis down at startup (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let gw: GatewayHarness;
  let publisher: Redis;
  let proxy: Server;
  let proxyPort: number;
  let socket: Socket | undefined;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    await Promise.all([identity.start(), catalog.start()]);
    // The gateway gets an address where nothing listens yet; later a proxy
    // opens it and forwards to the real Redis (same password).
    proxyPort = await freePort();
    const lateUrl = new URL(redis.url);
    lateUrl.hostname = '127.0.0.1';
    lateUrl.port = String(proxyPort);
    gw = await startGateway({
      redisUrl: lateUrl.toString(),
      identityPort: identity.port,
      catalogPort: catalog.port,
    });
    await gw.app.listen(0, '127.0.0.1');
    publisher = new Redis(redis.url);

    const target = new URL(redis.url);
    proxy = createServer((client) => {
      const upstream = connectTcp(Number(target.port), target.hostname);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
  });

  afterAll(async () => {
    socket?.disconnect();
    await publisher?.quit();
    await gw?.close();
    await new Promise((r) => (proxy.listening ? proxy.close(r) : r(null)));
    await Promise.all([identity?.stop(), catalog?.stop()]);
    process.env = savedEnv;
    await redis?.stop();
  });

  it('delivers pushes once Redis comes up', async () => {
    const { port } = gw.app.getHttpServer().address() as AddressInfo;
    const user = randomUUID();
    socket = io(`http://127.0.0.1:${port}${CHAT_NAMESPACE}`, {
      auth: { token: (await gw.bearer(user)).slice('Bearer '.length) },
      transports: ['websocket'],
      extraHeaders: { origin: 'http://localhost:4200' },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket?.once('connect', () => resolve());
      socket?.once('connect_error', reject);
    });

    await new Promise<void>((r) => proxy.listen(proxyPort, '127.0.0.1', r));
    const push: ChatPush = {
      type: 'read',
      conversationId: randomUUID(),
      readerId: randomUUID(),
      readAt: new Date().toISOString(),
    };
    // ioredis reconnects with a backoff of up to 2 s: publish until it lands.
    let got: unknown;
    socket.once(CHAT_SOCKET_EVENT, (p: unknown) => (got = p));
    const deadline = Date.now() + 20_000;
    while (got === undefined && Date.now() < deadline) {
      await publisher.publish(CHAT_CHANNEL_PREFIX + user, JSON.stringify(push));
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(got).toEqual(push);
    expect(socket.connected).toBe(true);
  });
});
