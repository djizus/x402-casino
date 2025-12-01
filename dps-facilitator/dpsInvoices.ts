import { randomUUID } from "node:crypto";
import {
  PaymentRequirements,
  SupportedEVMNetworks,
  SupportedSVMNetworks,
} from "x402/types";

const ATOMIC_VALUE_REGEX = /^\d+$/;
const DEFAULT_TTL_SECONDS = 3600;
const MAX_TTL_SECONDS = 86400;

export class DpsInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpsInvoiceError";
  }
}

export type InvoiceRecord = {
  id: string;
  paymentRequirements: PaymentRequirements;
  amount: string;
  createdAt: Date;
  expiresAt: Date;
  status: "pending" | "paid";
};

export type DpsInvoiceStoreConfig = {
  resourceUrl: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  feeBasisPoints: number;
  minFeeAtomicUnits: string;
  invoiceTtlSeconds?: number;
  evmPayTo?: string;
  svmPayTo?: string;
};

export type CreateInvoiceParams = {
  baseRequirements: PaymentRequirements;
  negotiatedAmount: string;
  ttlSeconds?: number;
};

export class DpsInvoiceStore {
  private readonly invoices = new Map<string, InvoiceRecord>();
  private readonly config: DpsInvoiceStoreConfig;
  private readonly now: () => number;

  constructor(config: DpsInvoiceStoreConfig, now: () => number = () => Date.now()) {
    this.config = config;
    this.now = now;
  }

  createInvoice(params: CreateInvoiceParams): InvoiceRecord {
    const negotiatedAmount = this.validateAmount(params.negotiatedAmount);
    const ttlSeconds = this.validateTtl(params.ttlSeconds ?? this.config.invoiceTtlSeconds ?? DEFAULT_TTL_SECONDS);
    const amount = this.calculateFee(negotiatedAmount);
    const payTo = this.resolvePayTo(params.baseRequirements.network);

    const id = randomUUID();
    const createdMs = this.now();
    const createdAt = new Date(createdMs);
    const expiresAt = new Date(createdMs + ttlSeconds * 1000);

    const paymentRequirements: PaymentRequirements = {
      scheme: "exact",
      network: params.baseRequirements.network,
      maxAmountRequired: amount,
      resource: this.config.resourceUrl,
      description: this.config.description,
      mimeType: this.config.mimeType,
      payTo,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds,
      asset: params.baseRequirements.asset,
      extra: {
        ...(params.baseRequirements.extra ?? {}),
        dpsInvoiceId: id,
      },
    };

    const record: InvoiceRecord = {
      id,
      paymentRequirements,
      amount,
      createdAt,
      expiresAt,
      status: "pending",
    };

    this.invoices.set(id, record);
    return record;
  }

  applyInvoice(paymentRequirements: PaymentRequirements): PaymentRequirements {
    const invoiceId = paymentRequirements.extra?.dpsInvoiceId;
    if (!invoiceId) {
      return paymentRequirements;
    }

    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new DpsInvoiceError("DPS invoice not found");
    }

    if (invoice.expiresAt.getTime() <= this.now()) {
      this.invoices.delete(invoiceId);
      throw new DpsInvoiceError("DPS invoice expired");
    }

    return invoice.paymentRequirements;
  }

  markInvoicePaid(invoiceId: string) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new DpsInvoiceError("DPS invoice not found");
    }

    invoice.status = "paid";
  }

  isInvoicePaid(invoiceId: string): boolean {
    const invoice = this.invoices.get(invoiceId);
    return Boolean(invoice && invoice.status === "paid");
  }

  private calculateFee(negotiatedAmount: string): string {
    const feeBps = this.config.feeBasisPoints;
    const minFee = this.parseAtomic(this.config.minFeeAtomicUnits);
    const amount = this.parseAtomic(negotiatedAmount);
    if (feeBps <= 0) {
      return negotiatedAmount;
    }
    const fee = (amount * BigInt(feeBps)) / 10_000n;
    const normalizedFee = fee < minFee ? minFee : fee;
    return normalizedFee.toString();
  }

  private resolvePayTo(network: PaymentRequirements["network"]): string {
    if (SupportedEVMNetworks.includes(network)) {
      if (!this.config.evmPayTo) {
        throw new DpsInvoiceError("DPS EVM payTo address is not configured");
      }
      return this.config.evmPayTo;
    }

    if (SupportedSVMNetworks.includes(network)) {
      if (!this.config.svmPayTo) {
        throw new DpsInvoiceError("DPS SVM payTo address is not configured");
      }
      return this.config.svmPayTo;
    }

    throw new DpsInvoiceError("Unsupported network for DPS payment");
  }

  private validateTtl(ttlSeconds: number): number {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new DpsInvoiceError(`Invoice ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`);
    }
    return ttlSeconds;
  }

  private validateAmount(value: string): string {
    if (typeof value !== "string" || !ATOMIC_VALUE_REGEX.test(value)) {
      throw new DpsInvoiceError("Negotiated amount must be a non-negative integer string");
    }
    return value;
  }

  private parseAtomic(value: string): bigint {
    if (!ATOMIC_VALUE_REGEX.test(value)) {
      throw new DpsInvoiceError("Atomic values must be numeric strings");
    }
    return BigInt(value);
  }
}
