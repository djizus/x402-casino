import { createPaymentHeader } from 'x402/client';
import { exact } from 'x402/schemes';
import type { PaymentRequirements } from 'x402/types';
import { createWalletClient, getAddress, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainFromNetwork } from './networks';

type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
};

type SettleResponse = {
  success: boolean;
  errorReason?: string;
};

const X402_VERSION = 1;

const normalizeHex = (value: string) => {
  try {
    return getAddress(value);
  } catch {
    return value.toLowerCase();
  }
};

type PayoutConfig = {
  url: string;
  network: PaymentRequirements['network'];
  signerPrivateKey: Hex;
  asset: { address: string; extra?: Record<string, string> };
  resourceBaseUrl?: string;
};

type PayoutRequest = {
  roomId: string;
  payTo: string;
  amountAtomic: bigint | string;
  description?: string;
};

export class PayoutProcessor {
  private readonly facilitatorUrl: string;
  private readonly network: PaymentRequirements['network'];
  private readonly asset: { address: string; extra?: Record<string, string> };
  private readonly walletClient;
  private readonly resourceBaseUrl: string;

  constructor(config: PayoutConfig) {
    this.facilitatorUrl = config.url.replace(/\/$/, '');
    this.network = config.network;
    this.asset = config.asset;
    this.resourceBaseUrl = config.resourceBaseUrl ?? 'https://casino.local';

    const chain = chainFromNetwork(config.network);
    const account = privateKeyToAccount(config.signerPrivateKey);
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });
  }

  public async sendPayout(request: PayoutRequest): Promise<void> {
    const amount = typeof request.amountAtomic === 'bigint' ? request.amountAtomic.toString() : request.amountAtomic;
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: this.network,
      maxAmountRequired: amount,
      resource: `${this.resourceBaseUrl}/rooms/${encodeURIComponent(request.roomId)}/payout`,
      description: request.description ?? `Room ${request.roomId} payout`,
      mimeType: 'application/json',
      payTo: normalizeHex(request.payTo),
      maxTimeoutSeconds: 60,
      asset: normalizeHex(this.asset.address),
      extra: this.asset.extra,
    };

    const paymentHeader = await createPaymentHeader(
      this.walletClient as unknown as Parameters<typeof createPaymentHeader>[0],
      X402_VERSION,
      requirements,
    );
    const paymentPayload = exact.evm.decodePayment(paymentHeader);
    paymentPayload.x402Version = X402_VERSION;

    const verifyResponse = await this.facilitatorFetch<VerifyResponse>('/verify', {
      paymentPayload,
      paymentRequirements: requirements,
    });
    if (!verifyResponse.isValid) {
      throw new Error(verifyResponse.invalidReason ?? 'Failed to verify payout');
    }

    const settleResponse = await this.facilitatorFetch<SettleResponse>('/settle', {
      paymentPayload,
      paymentRequirements: requirements,
    });

    if (!settleResponse.success) {
      throw new Error(settleResponse.errorReason ?? 'Failed to settle payout');
    }
  }

  private async facilitatorFetch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.facilitatorUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Facilitator ${path} failed: ${text}`);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}
