import type { FastifyInstance } from 'fastify';
import { formatEther, parseEther } from 'viem';
import { getClaim, nextClaimId, markInPursuit, settleRecovery, settleWriteOff, explorerTx } from '../chain.js';
import { getAssignmentByClaim } from '../db.js';
import { currentState, demandLetter, recordTransition, recordOutcome, eventsFor } from '../collection.js';
import { config } from '../config.js';

const STATUS = ['None', 'Purchased', 'InPursuit', 'Recovered', 'WrittenOff'];

export async function opsRoutes(app: FastifyInstance) {
  app.get('/api/ops/queue', async () => {
    const next = await nextClaimId();
    const rows = [];
    for (let i = 1n; i < next; i++) {
      const c = await getClaim(i);
      if (c.status === 0) continue;
      const a = getAssignmentByClaim.get(Number(i)) as any;
      rows.push({
        id: i.toString(),
        passenger: c.passenger,
        passengerName: a?.passenger_name ?? null,
        statutoryMon: formatEther(c.statutoryAmount),
        purchaseMon: formatEther(c.purchasePrice),
        recoveredMon: formatEther(c.recoveredAmount),
        onChainStatus: STATUS[c.status],
        collectionState: currentState(Number(i)),
        ageDays: Math.floor((Date.now() / 1000 - Number(c.purchasedAt)) / 86400),
        events: eventsFor(Number(i)),
      });
    }
    return rows.sort((a, b) => b.ageDays - a.ageDays);
  });

  app.post<{ Params: { id: string } }>('/api/ops/pursue/:id', async (req, reply) => {
    const id = Number(req.params.id);
    try {
      const c = await getClaim(BigInt(id));
      const a = getAssignmentByClaim.get(id) as any;
      const letter = demandLetter({
        claimId: id,
        carrier: a?.carrier ?? 'CARRIER',
        flightNumber: a?.flight_number ?? '',
        flightDate: a?.flight_date ?? '',
        depAirport: a?.dep_airport ?? '',
        arrAirport: a?.arr_airport ?? '',
        delayMinutes: a?.delay_minutes ?? 0,
        statutoryEur: Number(formatEther(c.statutoryAmount)) / config.monPerEur,
        passengerName: a?.passenger_name ?? 'Passenger',
        assignmentHash: c.assignmentHash,
      });
      recordTransition(id, 'DemandSent', letter, 'Formal demand generated');
      const tx = await markInPursuit(BigInt(id));
      return { ok: true, txHash: tx, explorer: explorerTx(tx), letter };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/ops/letter/:id', async (req, reply) => {
    const events = eventsFor(Number(req.params.id)) as any[];
    const withDoc = [...events].reverse().find((e) => e.document);
    if (!withDoc) return reply.code(404).send({ error: 'no demand letter generated yet' });
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="demand-${req.params.id}.txt"`);
    return withDoc.document;
  });

  app.post<{ Params: { id: string }; Body: { recoveredMon: string; carrier?: string } }>(
    '/api/ops/settle/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      try {
        const amount = parseEther(String(req.body?.recoveredMon ?? '0'));
        const c = await getClaim(BigInt(id));
        let tx: string;
        if (amount === 0n) {
          tx = await settleWriteOff(BigInt(id));
          recordTransition(id, 'NEBEscalated', null, 'No recovery, escalated then written off');
          recordOutcome(req.body?.carrier ?? 'XX', false, 0);
        } else {
          tx = await settleRecovery(BigInt(id), amount);
          recordOutcome(
            req.body?.carrier ?? 'XX',
            true,
            Number(formatEther(c.statutoryAmount)) / config.monPerEur,
          );
        }
        return { ok: true, txHash: tx, explorer: explorerTx(tx) };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
