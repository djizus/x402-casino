import assert from "node:assert/strict";
import test from "node:test";
import { DpsInvoiceError, DpsInvoiceStore } from "../dpsInvoices";
import { PaymentRequirements } from "x402/types";

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "5000",
  resource: "https://seller.example/api",
  description: "Seller payment",
  mimeType: "application/json",
  payTo: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  maxTimeoutSeconds: 120,
  asset: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const createClock = (startMs: number) => {
  let current = startMs;
  return {
    now: () => current,
    advanceMs: (ms: number) => {
      current += ms;
    },
  };
};

test("createInvoice emits canonical requirements and fee", () => {
  const clock = createClock(Date.UTC(2024, 0, 1));
  const store = new DpsInvoiceStore(
    {
      resourceUrl: "https://dps.example/payments",
      description: "DPS Fee",
      mimeType: "application/json",
      maxTimeoutSeconds: 45,
      feeBasisPoints: 200,
      minFeeAtomicUnits: "10",
      invoiceTtlSeconds: 600,
      evmPayTo: "0xcccccccccccccccccccccccccccccccccccccccc",
      svmPayTo: "Test11111111111111111111111111111111111111111",
    },
    clock.now,
  );

  const invoice = store.createInvoice({
    baseRequirements,
    negotiatedAmount: "10000",
  });

  assert.equal(invoice.amount, "200");
  assert.equal(invoice.paymentRequirements.extra?.dpsInvoiceId, invoice.id);
  assert.equal(invoice.paymentRequirements.payTo, "0xcccccccccccccccccccccccccccccccccccccccc");
  assert.equal(invoice.paymentRequirements.maxTimeoutSeconds, 45);
  assert.equal(invoice.createdAt.getTime(), clock.now());
  assert.equal(invoice.expiresAt.getTime(), clock.now() + 600_000);
});

test("applyInvoice enforces expiration", () => {
  const clock = createClock(Date.UTC(2024, 0, 1));
  const store = new DpsInvoiceStore(
    {
      resourceUrl: "https://dps.example/payments",
      description: "DPS Fee",
      mimeType: "application/json",
      maxTimeoutSeconds: 45,
      feeBasisPoints: 100,
      minFeeAtomicUnits: "1",
      invoiceTtlSeconds: 5,
      evmPayTo: "0xcccccccccccccccccccccccccccccccccccccccc",
      svmPayTo: "Test11111111111111111111111111111111111111111",
    },
    clock.now,
  );

  const invoice = store.createInvoice({
    baseRequirements,
    negotiatedAmount: "1000",
  });

  const resolved = store.applyInvoice(invoice.paymentRequirements);
  assert.deepEqual(resolved, invoice.paymentRequirements);

  clock.advanceMs(6_000);

  assert.throws(() => {
    store.applyInvoice(invoice.paymentRequirements);
  }, DpsInvoiceError);
});

test("markInvoicePaid toggles status", () => {
  const clock = createClock(Date.UTC(2024, 0, 1));
  const store = new DpsInvoiceStore(
    {
      resourceUrl: "https://dps.example/payments",
      description: "DPS Fee",
      mimeType: "application/json",
      maxTimeoutSeconds: 45,
      feeBasisPoints: 100,
      minFeeAtomicUnits: "1",
      invoiceTtlSeconds: 600,
      evmPayTo: "0xcccccccccccccccccccccccccccccccccccccccc",
      svmPayTo: "Test11111111111111111111111111111111111111111",
    },
    clock.now,
  );

  const invoice = store.createInvoice({
    baseRequirements,
    negotiatedAmount: "1000",
  });

  assert.equal(store.isInvoicePaid(invoice.id), false);
  store.markInvoicePaid(invoice.id);
  assert.equal(store.isInvoicePaid(invoice.id), true);
});
