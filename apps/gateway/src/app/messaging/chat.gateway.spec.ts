import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import {
  CHAT_CHANNEL_PREFIX,
  CHAT_NAMESPACE,
  CHAT_SOCKET_EVENT,
  type ChatPush,
} from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import { FakeCatalog, FakeIdentity } from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

const WEB = 'http://localhost:4200';

/**
 * Live chat over a real Socket.IO server and Redis (ADR-0017, W2–W4):
 * token in the handshake, one room per user, Redis fan-out.
 */
describe('Chat socket (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let gw: GatewayHarness;
  let publisher: Redis;
  let url: string;
  const sockets: Socket[] = [];
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    await Promise.all([identity.start(), catalog.start()]);
    gw = await startGateway({
      redisUrl: redis.url,
      identityPort: identity.port,
      catalogPort: catalog.port,
    });
    await gw.app.listen(0, '127.0.0.1');
    const { port } = gw.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}${CHAT_NAMESPACE}`;
    publisher = new Redis(redis.url);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await publisher?.quit();
    await gw?.close();
    await Promise.all([identity?.stop(), catalog?.stop()]);
    process.env = savedEnv;
    await redis?.stop();
  });

  function connect(token?: string, origin = WEB): Socket {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      extraHeaders: { origin },
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  const bearerToken = async (userId: string) =>
    (await gw.bearer(userId)).slice('Bearer '.length);

  /** Resolves once the server has joined the socket to its room. */
  async function connected(socket: Socket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    // The room is joined right after the async token check.
    await new Promise((r) => setTimeout(r, 200));
  }

  function nextPush(socket: Socket): Promise<ChatPush> {
    return new Promise((resolve) => socket.once(CHAT_SOCKET_EVENT, resolve));
  }

  it('delivers a user’s pushes to their sockets only', async () => {
    const [alice, bob] = [randomUUID(), randomUUID()];
    const aliceSocket = connect(await bearerToken(alice));
    const bobSocket = connect(await bearerToken(bob));
    await Promise.all([connected(aliceSocket), connected(bobSocket)]);

    let bobGot = false;
    bobSocket.on(CHAT_SOCKET_EVENT, () => (bobGot = true));
    const push: ChatPush = {
      type: 'read',
      conversationId: randomUUID(),
      readerId: bob,
      readAt: new Date().toISOString(),
    };
    const received = nextPush(aliceSocket);
    await publisher.publish(CHAT_CHANNEL_PREFIX + alice, JSON.stringify(push));
    expect(await received).toEqual(push);
    await new Promise((r) => setTimeout(r, 200));
    expect(bobGot).toBe(false);
  });

  it.each([
    ['no token', undefined],
    ['a token signed with an untrusted key', 'forged'],
  ])('refuses a socket with %s', async (_, kind) => {
    const token =
      kind === 'forged'
        ? (await gw.forgedBearer()).slice('Bearer '.length)
        : undefined;
    const socket = connect(token);
    const error = new Promise((resolve) => socket.once('error', resolve));
    expect(await error).toMatchObject({ code: 'UNAUTHENTICATED' });
    await new Promise<void>((resolve) =>
      socket.connected ? socket.once('disconnect', () => resolve()) : resolve(),
    );
    expect(socket.connected).toBe(false);
  });

  it('refuses an origin outside the CORS allow-list', async () => {
    const socket = connect(
      await bearerToken(randomUUID()),
      'https://evil.test',
    );
    await expect(
      new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(undefined));
        socket.once('connect_error', reject);
      }),
    ).rejects.toBeDefined();
  });
});
