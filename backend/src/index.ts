import Fastify from 'fastify';
import cors from '@fastify/cors';
import cron from 'node-cron';
import { config, assertFlightDataConfigured } from './config.js';
import { assertChain, addresses, opsAccount, publicClient } from './chain.js';
import { providers } from './providers/index.js';
import { flightRoutes } from './routes/flights.js';
import { claimRoutes } from './routes/claims.js';
import { poolRoutes } from './routes/pool.js';
import { opsRoutes } from './routes/ops.js';
import { allFlights } from './db.js';
import { trackFlight } from './service.js';

// Fastify cannot serialise BigInt; every route returns strings, but this keeps
// an accidental bigint from crashing a response.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

const app = Fastify({ logger: { level: 'warn' } });

async function main() {
  // Refuse to start without live flight data. No synthetic fallback exists.
  assertFlightDataConfigured();
  await assertChain();

  await app.register(cors, { origin: true });
  await app.register(flightRoutes);
  await app.register(claimRoutes);
  await app.register(poolRoutes);
  await app.register(opsRoutes);

  app.get('/api/health', async () => ({
    ok: true,
    chainId: await publicClient.getChainId(),
    ops: opsAccount?.address ?? null,
    contracts: addresses,
    providers: providers().map((p) => p.name),
    monPerEur: config.monPerEur,
  }));

  await app.listen({ port: config.port, host: '0.0.0.0' });

  console.log(`aeroclaim backend on :${config.port}`);
  console.log(`  chain     ${config.chainId} via ${config.rpcUrl}`);
  console.log(`  ops       ${opsAccount?.address ?? 'NOT SET'}`);
  console.log(`  providers ${providers().map((p) => p.name).join(', ')}`);

  // Re-poll watched flights in the window where an arrival can still change,
  // rather than burning free-tier quota on flights that have long since landed.
  cron.schedule('*/5 * * * *', async () => {
    const now = Date.now();
    for (const f of allFlights()) {
      const withinWindow =
        now > f.scheduled_arrival - 30 * 60_000 && now < f.scheduled_arrival + 8 * 3_600_000;
      if (!withinWindow || f.agreement >= 2) continue;
      try {
        await trackFlight(f.carrier, f.flight_number, f.flight_date);
      } catch {
        /* provider hiccup; next tick retries */
      }
    }
  });
}

main().catch((err) => {
  console.error('\nFATAL:', err.message, '\n');
  process.exit(1);
});
