import { assertChain, addresses, poolState, registryStats, opsAccount, publicClient } from '../chain.js';

await assertChain();
console.log('chain id OK:', await publicClient.getChainId());
console.log('ops account:', opsAccount?.address ?? 'NOT SET');
console.log('contracts   :', JSON.stringify(addresses, null, 1));
const p = await poolState();
console.log('pool        :', {
  idle: p.idle.toString(), deployed: p.deployed.toString(),
  totalAssets: p.totalAssets.toString(), sharePrice: p.sharePrice.toString(),
});
console.log('registry    :', await registryStats());
