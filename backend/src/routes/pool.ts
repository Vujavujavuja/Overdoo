import type { FastifyInstance } from 'fastify';
import { formatEther } from 'viem';
import { poolState, registryStats, publicClient, contracts, addresses } from '../chain.js';

export async function poolRoutes(app: FastifyInstance) {
  /** Every figure here is an on-chain read. Nothing is cached server-side. */
  app.get('/api/pool', async () => {
    const [p, s] = await Promise.all([poolState(), registryStats()]);
    const resolved = Number(s.recovered) + Number(s.written);
    return {
      address: addresses.CapitalPool,
      idleWei: p.idle.toString(),
      deployedWei: p.deployed.toString(),
      totalAssetsWei: p.totalAssets.toString(),
      totalSharesWei: p.totalShares.toString(),
      sharePriceWei: p.sharePrice.toString(),
      idleMon: formatEther(p.idle),
      deployedMon: formatEther(p.deployed),
      totalAssetsMon: formatEther(p.totalAssets),
      sharePrice: Number(formatEther(p.sharePrice)),
      claims: {
        total: Number(s.total),
        recovered: Number(s.recovered),
        writtenOff: Number(s.written),
        outstanding: Number(s.outstanding),
      },
      recoveryRate: resolved === 0 ? null : Number(s.recovered) / resolved,
    };
  });

  app.get('/api/pool/events', async () => {
    const latest = await publicClient.getBlockNumber();
    // Public RPCs cap log ranges; a recent window is enough for a live feed.
    const from = latest > 5000n ? latest - 5000n : 0n;
    const logs = await publicClient.getLogs({
      address: contracts.pool.address,
      fromBlock: from,
      toBlock: latest,
    });
    return logs.slice(-50).map((l) => ({
      blockNumber: l.blockNumber?.toString(),
      txHash: l.transactionHash,
      topics: l.topics,
      data: l.data,
    }));
  });
}
