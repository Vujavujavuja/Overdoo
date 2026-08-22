import type { FastifyInstance } from 'fastify';
import { trackFlight } from '../service.js';
import { listFlights, getFlight, rawFor } from '../db.js';

export async function flightRoutes(app: FastifyInstance) {
  app.post<{ Body: { carrier: string; flightNumber: string; date: string } }>(
    '/api/flights/track',
    async (req, reply) => {
      const { carrier, flightNumber, date } = req.body ?? ({} as any);
      if (!carrier || !flightNumber || !date) {
        return reply.code(400).send({ error: 'carrier, flightNumber and date are required' });
      }
      try {
        return await trackFlight(carrier.trim().toUpperCase(), String(flightNumber).trim(), date);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/api/flights', async () => listFlights.all());

  app.get<{ Params: { key: string } }>('/api/flights/:key', async (req, reply) => {
    const row = getFlight.get(req.params.key);
    if (!row) return reply.code(404).send({ error: 'unknown flight key' });
    return { ...row, evidence: rawFor.all(req.params.key) };
  });
}
