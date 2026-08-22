import { createConfig, http } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * viem ships a `monadTestnet` chain def (id 10143). We override the explorer to
 * MonadVision, which is the one the Monad docs point at.
 */
export const monad = {
  ...monadTestnet,
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
} as const;

export const config = createConfig({
  chains: [monad],
  connectors: [injected()],
  transports: {
    [monad.id]: http("https://testnet-rpc.monad.xyz"),
  },
  // Monad blocks are ~400ms. The wagmi default (4s) would make the live feed
  // feel slower than the chain actually is.
  pollingInterval: 500,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
