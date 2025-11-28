import assert from "node:assert/strict";
import test from "node:test";
import { DynamicQuoteStore, QuoteError } from "../dynamicQuotes";
import { DpsInvoiceStore } from "../dpsInvoices";
import { PaymentRequirements } from "x402/types";

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "100000",
  resource: "https://example.com/resource",
  description: "Example dynamic quote test",
  mimeType: "application/json",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 60,
  asset: "0x2222222222222222222222222222222222222222",
};

const createMutableClock = (startMs: number) => {
  let current = startMs;
  return {
    now: () => current,
    advanceMs: (delta: number) => {
      current += delta;
    },
  };
};

const cloneRequirements = (): PaymentRequirements => ({
  ...baseRequirements,
  extra: baseRequirements.extra ? { ...baseRequirements.extra } : undefined,
});

const createInvoiceStore = (clock: ReturnType<typeof createMutableClock>) =>
  new DpsInvoiceStore(
    {
      resourceUrl: "https://dps.local/payments",
      description: "DPS Fee",
      mimeType: "application/json",
      maxTimeoutSeconds: 30,
      feeBasisPoints: 100,
      minFeeAtomicUnits: "1",
      invoiceTtlSeconds: 300,
      evmPayTo: "0x3333333333333333333333333333333333333333",
      svmPayTo: "Test11111111111111111111111111111111111111111",
    },
    clock.now,
  );

test("createQuote stores negotiated amount and annotates extra metadata", () => {
  const clock = createMutableClock(Date.UTC(2024, 0, 1));
  const invoiceStore = createInvoiceStore(clock);
  const store = new DynamicQuoteStore(invoiceStore, clock.now);

  const { quote, invoice } = store.createQuote({
    paymentRequirements: cloneRequirements(),
    negotiatedAmount: "2500",
    ttlSeconds: 120,
  });

  assert.equal(quote.paymentRequirements.maxAmountRequired, "2500");
  assert.equal(quote.paymentRequirements.extra?.dynamicQuoteId, quote.id);
  assert.equal(quote.dpsInvoiceId, invoice.id);
  assert.equal(quote.createdAt.getTime(), clock.now());
  assert.equal(quote.expiresAt.getTime(), clock.now() + 120_000);
  assert.equal(invoice.paymentRequirements.extra?.dpsInvoiceId, invoice.id);
});

test("applyDynamicQuote returns canonical requirements before expiry", () => {
  const clock = createMutableClock(Date.UTC(2024, 0, 1));
  const invoiceStore = createInvoiceStore(clock);
  const store = new DynamicQuoteStore(invoiceStore, clock.now);
  const { quote, invoice } = store.createQuote({
    paymentRequirements: cloneRequirements(),
    negotiatedAmount: "999",
    ttlSeconds: 60,
  });
  invoiceStore.markInvoicePaid(invoice.id);

  const resolved = store.applyDynamicQuote({
    ...quote.paymentRequirements,
  });

  assert.deepEqual(resolved, quote.paymentRequirements);
});

test("applyDynamicQuote throws after quote expires", () => {
  const clock = createMutableClock(Date.UTC(2024, 0, 1));
  const invoiceStore = createInvoiceStore(clock);
  const store = new DynamicQuoteStore(invoiceStore, clock.now);
  const { quote, invoice } = store.createQuote({
    paymentRequirements: cloneRequirements(),
    negotiatedAmount: "321",
    ttlSeconds: 5,
  });
  invoiceStore.markInvoicePaid(invoice.id);

  clock.advanceMs(6_000);

  assert.throws(
    () => {
      store.applyDynamicQuote(quote.paymentRequirements);
    },
    QuoteError,
    "Dynamic quote expired",
  );
});

test("applyDynamicQuote requires DPS invoice to be paid", () => {
  const clock = createMutableClock(Date.UTC(2024, 0, 1));
  const invoiceStore = createInvoiceStore(clock);
  const store = new DynamicQuoteStore(invoiceStore, clock.now);
  const { quote, invoice } = store.createQuote({
    paymentRequirements: cloneRequirements(),
    negotiatedAmount: "111",
  });

  assert.throws(() => {
    store.applyDynamicQuote(quote.paymentRequirements);
  }, QuoteError);

  invoiceStore.markInvoicePaid(invoice.id);

  const resolved = store.applyDynamicQuote(quote.paymentRequirements);
  assert.deepEqual(resolved, quote.paymentRequirements);
});
