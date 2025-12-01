import { randomUUID } from "node:crypto";
import type { PaymentRequirements } from "x402/types";
import { DpsInvoiceStore, InvoiceRecord } from "./dpsInvoices.ts";

const ATOMIC_VALUE_REGEX = /^\d+$/;
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

export type CreateQuoteParams = {
  paymentRequirements: PaymentRequirements;
  negotiatedAmount: string;
  ttlSeconds?: number;
};

export type QuoteRecord = {
  id: string;
  paymentRequirements: PaymentRequirements;
  negotiatedAmount: string;
  createdAt: Date;
  expiresAt: Date;
  dpsInvoiceId: string;
};

export type QuoteCreationResult = {
  quote: QuoteRecord;
  invoice: InvoiceRecord;
};

export class DynamicQuoteStore {
  private readonly quotes = new Map<string, QuoteRecord>();
  private readonly invoiceStore: DpsInvoiceStore;
  private readonly now: () => number;

  constructor(invoiceStore: DpsInvoiceStore, now: () => number = () => Date.now()) {
    this.invoiceStore = invoiceStore;
    this.now = now;
  }

  createQuote(params: CreateQuoteParams): QuoteCreationResult {
    const negotiatedAmount = this.validateAmount(params.negotiatedAmount);
    const ttlSeconds = this.validateTtl(params.ttlSeconds);
    const id = randomUUID();
    const createdMs = this.now();
    const createdAt = new Date(createdMs);
    const expiresAt = new Date(createdMs + ttlSeconds * 1000);

    const invoice = this.invoiceStore.createInvoice({
      baseRequirements: params.paymentRequirements,
      negotiatedAmount,
    });

    const canonicalRequirements = this.decorateRequirements(
      params.paymentRequirements,
      id,
      negotiatedAmount,
      invoice.id,
    );

    const record: QuoteRecord = {
      id,
      paymentRequirements: canonicalRequirements,
      negotiatedAmount,
      createdAt,
      expiresAt,
      dpsInvoiceId: invoice.id,
    };

    this.quotes.set(id, record);

    return { quote: record, invoice };
  }

  applyDynamicQuote(paymentRequirements: PaymentRequirements): PaymentRequirements {
    const quoteId = paymentRequirements.extra?.dynamicQuoteId;
    if (!quoteId) {
      return paymentRequirements;
    }

    const record = this.quotes.get(quoteId);
    if (!record) {
      throw new QuoteError("Dynamic quote not found");
    }

    if (record.expiresAt.getTime() <= this.now()) {
      this.quotes.delete(quoteId);
      throw new QuoteError("Dynamic quote expired");
    }

    if (!this.invoiceStore.isInvoicePaid(record.dpsInvoiceId)) {
      throw new QuoteError("Dynamic quote blocked until DPS fee is paid");
    }

    return record.paymentRequirements;
  }

  private decorateRequirements(
    requirements: PaymentRequirements,
    quoteId: string,
    negotiatedAmount: string,
    invoiceId: string,
  ): PaymentRequirements {
    return {
      ...requirements,
      maxAmountRequired: negotiatedAmount,
      extra: {
        ...(requirements.extra ?? {}),
        dynamicQuoteId: quoteId,
        dpsInvoiceId: invoiceId,
      },
    };
  }

  private validateAmount(value: string): string {
    if (typeof value !== "string" || !ATOMIC_VALUE_REGEX.test(value)) {
      throw new QuoteError("Negotiated amount must be a non-negative integer string");
    }
    return value;
  }

  private validateTtl(ttlSeconds?: number): number {
    if (typeof ttlSeconds === "undefined") {
      return DEFAULT_TTL_SECONDS;
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new QuoteError(`ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}`);
    }
    return ttlSeconds;
  }
}
