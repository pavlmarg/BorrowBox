import {
  createEnvelope,
  DISPLAY_NAME_MAX_LENGTH,
  UserDeletionRequestedV1,
  UserRegisteredV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import {
  InvalidEventError,
  parsePayload,
  UserDeletionPayload,
  UserNamePayload,
} from './user-event-payloads';

const userId = '00000000-0000-4000-8000-000000000001';

function registered(payload: Record<string, unknown>): EventEnvelope {
  return createEnvelope(UserRegisteredV1, {
    userId,
    email: 'maria@example.com',
    displayName: 'Maria',
    locale: 'el',
    ...payload,
  } as never);
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a throw');
}

describe('parsePayload', () => {
  it('returns only the fields Catalog keeps', () => {
    const payload = parsePayload(registered({}), UserNamePayload);
    expect(payload).toBeInstanceOf(UserNamePayload);
    expect(payload).toMatchObject({ userId, displayName: 'Maria' });
  });

  it('accepts a deletion with just the user id', () => {
    const envelope = createEnvelope(UserDeletionRequestedV1, { userId });
    expect(parsePayload(envelope, UserDeletionPayload).userId).toBe(userId);
  });

  it.each([
    ['a missing name', { displayName: undefined }],
    ['an empty name', { displayName: '' }],
    [
      'a name over the limit',
      { displayName: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) },
    ],
    ['a malformed user id', { userId: 'not-a-uuid' }],
  ])('rejects %s', (_, payload) => {
    expect(() => parsePayload(registered(payload), UserNamePayload)).toThrow(
      InvalidEventError,
    );
  });

  it('rejects broken envelope fields', () => {
    const envelope = { ...registered({}), eventId: 'x', occurredAt: 'today' };
    expect(errorOf(() => parsePayload(envelope, UserNamePayload)).message).toBe(
      'Invalid user.registered event: eventId, occurredAt',
    );
  });

  it('names fields, never values', () => {
    const message = errorOf(() =>
      parsePayload(
        registered({ userId: 'secret-value', displayName: '' }),
        UserNamePayload,
      ),
    ).message;
    expect(message).toBe(
      'Invalid user.registered event: payload.userId, payload.displayName',
    );
    expect(message).not.toContain('secret-value');
  });
});
