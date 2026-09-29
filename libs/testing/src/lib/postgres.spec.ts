import { Client } from 'pg';
import { SERVICES, startPostgres, type TestPostgres } from './postgres';

// Guards ADR-0002: each service role can only touch its own schema.
describe('startPostgres (infra init script)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await startPostgres();
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function asService<T>(
    service: (typeof SERVICES)[number],
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ connectionString: pg.urlFor(service) });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it.each(SERVICES)(
    '%s role defaults to its own schema and can create tables there',
    async (service) => {
      await asService(service, async (c) => {
        const { rows } = await c.query('SELECT current_schema() AS s');
        expect(rows[0].s).toBe(service);
        await c.query('CREATE TABLE t (id int)');
        await c.query('DROP TABLE t');
      });
    },
  );

  it('has PostGIS available to service roles', async () => {
    await asService('catalog', async (c) => {
      const { rows } = await c.query(
        `SELECT ST_AsText(ST_MakePoint(23.72, 37.98)::geography::geometry) AS p`,
      );
      expect(rows[0].p).toBe('POINT(23.72 37.98)');
    });
  });

  it('denies reading or writing another service schema', async () => {
    await asService('catalog', (c) => c.query('CREATE TABLE items (id int)'));
    await asService('bookings', async (c) => {
      await expect(c.query('SELECT * FROM catalog.items')).rejects.toThrow(
        /permission denied for schema catalog/,
      );
      await expect(
        c.query('CREATE TABLE catalog.sneaky (id int)'),
      ).rejects.toThrow(/permission denied for schema catalog/);
    });
  });

  it('denies creating objects in public', async () => {
    await asService('identity', async (c) => {
      await expect(c.query('CREATE TABLE public.t (id int)')).rejects.toThrow(
        /permission denied for schema public/,
      );
    });
  });
});
