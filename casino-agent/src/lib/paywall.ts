import { randomUUID } from 'node:crypto';

import { createPaymentHeader } from 'x402/client';
import { exact } from 'x402/schemes';
import { processPriceToAtomicAmount } from 'x402/shared';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from 'x402/types';
import { settleResponseHeader } from 'x402/types';
import { createWalletClient, getAddress, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainFromNetwork } from './networks';
type WalletSigner = Parameters<typeof createPaymentHeader>[0];

type QuoteRecord = {
  id: string;
  requirements: PaymentRequirements;
  expiresAt: number;
  timeout?: ReturnType<typeof setTimeout>;
};

type QuoteResponse = {
  paymentRequirements: PaymentRequirements;
  dpsPaymentRequirements: PaymentRequirements;
  quoteId: string;
  expiresAt: string;
};

type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
};

type FacilitatorConfig = {
  url: string;
  payTo: string;
  network: PaymentRequirements['network'];
  dpsSignerPrivateKey: Hex;
};

const X402_VERSION = 1;

const normalizeHex = (value: string) => {
  try {
    return getAddress(value);
  } catch {
    return value.toLowerCase();
  }
};

export class RegistrationPaywall {
  private readonly facilitatorUrl: string;
  private readonly payTo: string;
  private readonly network: PaymentRequirements['network'];
  private readonly quotesByRoom = new Map<string, Map<string, QuoteRecord>>();
  private readonly walletClient: WalletSigner;

  constructor(config: FacilitatorConfig) {
    this.facilitatorUrl = config.url.replace(/\/$/, '');
    this.payTo = normalizeHex(config.payTo);
    this.network = config.network;

    const chain = chainFromNetwork(config.network);
    const account = privateKeyToAccount(config.dpsSignerPrivateKey);
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    }) as unknown as WalletSigner;
  }

  public async createQuote(roomId: string, priceUsd: number, resourceUrl: string): Promise<PaymentRequirements> {
    const calculation = processPriceToAtomicAmount(priceUsd, this.network);
    if ('error' in calculation) {
      throw new Error(calculation.error);
    }
    const { maxAmountRequired, asset } = calculation;
    const assetAddress = normalizeHex(asset.address);
    const assetExtra = 'eip712' in asset ? asset.eip712 : undefined;

    const baseRequirements: PaymentRequirements = {
      scheme: 'exact',
      network: this.network,
      maxAmountRequired,
      resource: resourceUrl,
      description: `Poker room ${roomId} buy-in`,
      mimeType: 'application/json',
      payTo: this.payTo,
      maxTimeoutSeconds: 60,
      asset: assetAddress,
      extra: assetExtra ? { ...assetExtra } : undefined,
    };

    const quote = await this.requestDynamicQuote(baseRequirements, maxAmountRequired);
    await this.settleDpsInvoice(quote.dpsPaymentRequirements);
    this.rememberQuote(roomId, quote);
    return quote.paymentRequirements;
  }

  public async verifyAndSettle(roomId: string, paymentHeader: string | null): Promise<string> {
    const paymentPayload = this.decodePayment(requirePaymentHeader(paymentHeader));
    const quote = this.findMatchingQuote(roomId, paymentPayload);
    if (!quote) {
      throw new Error('Quoted price not found or expired for room');
    }
    if (quote.expiresAt <= Date.now()) {
      this.deleteQuote(roomId, quote.id);
      throw new Error('Quote expired');
    }

    const verifyResponse = await this.facilitatorFetch<VerifyResponse>('/verify', {
      paymentPayload,
      paymentRequirements: quote.requirements,
    });
    if (!verifyResponse.isValid) {
      throw new Error(verifyResponse.invalidReason ?? 'Payment verification failed');
    }

    const settleResponse = await this.facilitatorFetch<SettleResponse>('/settle', {
      paymentPayload,
      paymentRequirements: quote.requirements,
    });

    if (!settleResponse.success) {
      throw new Error(settleResponse.errorReason ?? 'Payment settlement failed');
    }

    this.deleteQuote(roomId, quote.id);
    return settleResponseHeader(settleResponse);
  }

  private decodePayment(header: string): PaymentPayload {
    const payload = exact.evm.decodePayment(header);
    payload.x402Version = X402_VERSION;
    return payload;
  }

  private async requestDynamicQuote(
    baseRequirements: PaymentRequirements,
    negotiatedAmount: string,
  ): Promise<QuoteResponse> {
    return this.facilitatorFetch<QuoteResponse>('/dps/quote', {
      paymentRequirements: baseRequirements,
      negotiatedAmount,
    });
  }

  private async settleDpsInvoice(paymentRequirements: PaymentRequirements): Promise<void> {
    const dpsPaymentHeader = await createPaymentHeader(this.walletClient, X402_VERSION, paymentRequirements);
    const paymentPayload = exact.evm.decodePayment(dpsPaymentHeader);
    paymentPayload.x402Version = X402_VERSION;

    const verifyResponse = await this.facilitatorFetch<VerifyResponse>('/verify', {
      paymentPayload,
      paymentRequirements,
    });
    if (!verifyResponse.isValid) {
      throw new Error(verifyResponse.invalidReason ?? 'Failed to verify DPS invoice');
    }

    const settleResponse = await this.facilitatorFetch<SettleResponse>('/settle', {
      paymentPayload,
      paymentRequirements,
    });

    if (!settleResponse.success) {
      throw new Error(settleResponse.errorReason ?? 'Failed to settle DPS invoice');
    }
  }

  private rememberQuote(roomId: string, quote: QuoteResponse) {
    const container = this.ensureRoomQuotes(roomId);
    const expiresAt = new Date(quote.expiresAt).getTime();
    const id = quote.quoteId ?? randomUUID();
    const timeout = setTimeout(() => {
      this.deleteQuote(roomId, id);
    }, Math.max(expiresAt - Date.now(), 0));

    container.set(id, {
      id,
      requirements: quote.paymentRequirements,
      expiresAt,
      timeout,
    });
  }

  private deleteQuote(roomId: string, quoteId: string) {
    const container = this.quotesByRoom.get(roomId);
    if (!container) return;
    const existing = container.get(quoteId);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }
    container.delete(quoteId);
    if (container.size === 0) {
      this.quotesByRoom.delete(roomId);
    }
  }

  private ensureRoomQuotes(roomId: string): Map<string, QuoteRecord> {
    if (!this.quotesByRoom.has(roomId)) {
      this.quotesByRoom.set(roomId, new Map());
    }
    return this.quotesByRoom.get(roomId)!;
  }

  private findMatchingQuote(roomId: string, paymentPayload: PaymentPayload): QuoteRecord | undefined {
    const container = this.quotesByRoom.get(roomId);
    if (!container || container.size === 0) {
      return undefined;
    }

    const payload = paymentPayload.payload;
    if (!('authorization' in payload)) {
      return container.values().next().value;
    }

    for (const record of container.values()) {
      if (record.requirements.scheme !== paymentPayload.scheme) continue;
      if (record.requirements.network !== paymentPayload.network) continue;
      const requirementPayTo = normalizeHex(record.requirements.payTo);
      const payloadPayTo = normalizeHex(payload.authorization.to);
      if (requirementPayTo !== payloadPayTo) continue;
      if (record.requirements.maxAmountRequired !== payload.authorization.value) continue;
      return record;
    }

    return undefined;
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

const requirePaymentHeader = (value: string | null): string => {
  if (!value) {
    throw new Error('Missing X-PAYMENT header');
  }
  return value;
};

export const PAYWALL_X402_VERSION = X402_VERSION;
