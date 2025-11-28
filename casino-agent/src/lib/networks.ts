import { base, baseSepolia } from 'viem/chains';

export const chainFromNetwork = (network: string) => {
  if (network === 'base') return base;
  if (network === 'base-sepolia' || network === 'base_testnet') return baseSepolia;
  throw new Error(`Unsupported PAYMENTS_NETWORK: ${network}`);
};
