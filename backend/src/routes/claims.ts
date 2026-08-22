import type { FastifyInstance } from 'fastify';
import type { Address, Hex } from 'viem';
import { buildOffer, prepareAssignment, acceptClaim } from '../service.js';
import { getClaim, explorerTx } from '../chain.js';
import { getAssignmentByClaim, collectionEventsFor, latestCollectionState } from '../db.js';

const STATUS = ['None', 'Purchased', 'InPursuit', 'Recovered', 'WrittenOff'];

export async function claimRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { carrier: string; flightNumber: string; date: string } }>(
    '/api/claims/offer',
    async (req, reply) => {
      const { carrier, flightNumber, date } = req.query;
      if (!carrier || !flightNumber || !date) {
        return reply.code(400).send({ error: 'carrier, flightNumber and date are required' });
      }
      try {
        return await buildOffer(carrier.toUpperCase(), String(flightNumber), date);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  /** Returns the exact legal text plus the EIP-712 payload the wallet must sign. */
  app.post<{
    Body: {
      carrier: string;
      flightNumber: string;
      date: string;
      passengerAddress: string;
      passengerName: string;
    };
  }>('/api/claims/prepare', async (req, reply) => {
    const { carrier, flightNumber, date, passengerAddress, passengerName } = req.body ?? ({} as any);
    if (!carrier || !flightNumber || !date || !passengerAddress) {
      return reply.code(400).send({ error: 'missing fields' });
    }
    try {
      const p = await prepareAssignment(
        carrier.toUpperCase(),
        String(flightNumber),
        date,
        passengerAddress,
        passengerName || 'Passenger',
      );
      return { text: p.text, documentHash: p.documentHash, typedData: p.typedData, offer: p.offer };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: {
      carrier: string;
      flightNumber: string;
      date: string;
      passengerAddress: Address;
      passengerName: string;
      signature: Hex;
    };
  }>('/api/claims/accept', async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.carrier || !b.flightNumber || !b.date || !b.passengerAddress || !b.signature) {
      return reply.code(400).send({ error: 'missing fields' });
    }
    try {
      return await acceptClaim({
        carrier: b.carrier.toUpperCase(),
        flightNumber: String(b.flightNumber),
        date: b.date,
        passengerAddress: b.passengerAddress,
        passengerName: b.passengerName || 'Passenger',
        signature: b.signature,
      });
    } catch (err) {
      req.log.error({ err }, 'accept failed');
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/claims/:id', async (req, reply) => {
    const id = BigInt(req.params.id);
    const c = await getClaim(id);
    if (c.status === 0) return reply.code(404).send({ error: 'unknown claim' });

    const assignment = getAssignmentByClaim.get(Number(id)) as any;
    return {
      id: req.params.id,
      flightKey: c.flightKey,
      passenger: c.passenger,
      statutoryWei: c.statutoryAmount.toString(),
      purchaseWei: c.purchasePrice.toString(),
      recoveredWei: c.recoveredAmount.toString(),
      assignmentHash: c.assignmentHash,
      status: STATUS[c.status] ?? 'Unknown',
      purchasedAt: Number(c.purchasedAt),
      resolvedAt: Number(c.resolvedAt),
      collectionState: (latestCollectionState.get(Number(id)) as any)?.to_state ?? 'Purchased',
      collectionEvents: collectionEventsFor.all(Number(id)),
      assignmentText: assignment?.document_text ?? null,
      passengerName: assignment?.passenger_name ?? null,
      explorer: explorerTx(''),
    };
  });
}
