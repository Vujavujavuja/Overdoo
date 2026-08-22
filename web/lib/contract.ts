import { tipJarAbi } from "./abi";

/**
 * Set NEXT_PUBLIC_TIPJAR_ADDRESS in web/.env.local after deploying.
 * The deploy script prints the address.
 */
export const TIPJAR_ADDRESS = process.env
  .NEXT_PUBLIC_TIPJAR_ADDRESS as `0x${string}` | undefined;

export { tipJarAbi };
