import { UserDeletionRequestedV1, UserRegisteredV1 } from './events';
import { IdentityRpc, type IdentityRpcPattern } from './rpc';

describe('identity events', () => {
  it('use versioned routing keys', () => {
    expect(UserRegisteredV1.routingKey).toBe('user.registered.v1');
    expect(UserDeletionRequestedV1.routingKey).toBe(
      'user.deletion_requested.v1',
    );
  });
});

describe('IdentityRpc patterns', () => {
  const patterns = Object.values(IdentityRpc);

  it('are unique and namespaced to identity', () => {
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const p of patterns) expect(p).toMatch(/^identity\.[a-z.]+$/);
  });

  it('each have a contract entry', () => {
    // Compile-time check: every pattern is a key of IdentityRpcContract.
    const typed: IdentityRpcPattern[] = patterns;
    expect(typed).toHaveLength(9);
  });
});
