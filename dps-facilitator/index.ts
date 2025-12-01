/* eslint-env node */
import { config } from "dotenv";
import express from "express";
import type { Request, Response } from "express";
import { settle, verify } from "x402/facilitator";
import {
  PaymentPayloadSchema,
  PaymentRequirementsSchema,
  SupportedEVMNetworks,
  SupportedSVMNetworks,
  createConnectedClient,
  createSigner,
  isSvmSignerWallet,
} from "x402/types";
import type {
  ConnectedClient,
  PaymentPayload,
  PaymentRequirements,
  Signer,
  SupportedPaymentKind,
  X402Config,
} from "x402/types";
import { DpsInvoiceError, DpsInvoiceStore } from "./dpsInvoices.ts";
import { DynamicQuoteStore, QuoteError } from "./dynamicQuotes.ts";

config();

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || "";
const SVM_PRIVATE_KEY = process.env.SVM_PRIVATE_KEY || "";
const SVM_RPC_URL = process.env.SVM_RPC_URL || "";

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseAtomicString = (value: string | undefined, fallback: string): string =>
  value && /^\d+$/.test(value) ? value : fallback;

const dpsInvoiceStore = new DpsInvoiceStore({
  resourceUrl: process.env.DPS_PAYMENT_RESOURCE || "https://dps.local/payments",
  description: process.env.DPS_PAYMENT_DESCRIPTION || "Dynamic Pricing Service Fee",
  mimeType: process.env.DPS_PAYMENT_MIME_TYPE || "application/json",
  maxTimeoutSeconds: parsePositiveInt(process.env.DPS_PAYMENT_TIMEOUT_SECONDS, 300),
  feeBasisPoints: parseNonNegativeInt(process.env.DPS_FEE_BPS, 100),
  minFeeAtomicUnits: parseAtomicString(process.env.DPS_MIN_FEE_ATOMIC, "1"),
  invoiceTtlSeconds: parsePositiveInt(process.env.DPS_INVOICE_TTL_SECONDS, 900),
  evmPayTo: process.env.DPS_EVM_PAY_TO,
  svmPayTo: process.env.DPS_SVM_PAY_TO,
});

const dynamicQuoteStore = new DynamicQuoteStore(dpsInvoiceStore);

if (!EVM_PRIVATE_KEY && !SVM_PRIVATE_KEY) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Create X402 config with custom RPC URL if provided
const x402Config: X402Config | undefined = SVM_RPC_URL
  ? { svmConfig: { rpcUrl: SVM_RPC_URL } }
  : undefined;

const logError = (context: string, error: unknown) => {
  if (error instanceof Error) {
    console.error(`${context}: ${error.message}`);
    console.error(error);
    return;
  }

  console.error(`${context}:`, error);
};

const logInfo = (...parts: unknown[]) => {
  console.log("[dps-facilitator]", ...parts);
};

const describePaymentIdentifier = (requirements: PaymentRequirements) =>
  requirements.extra?.dynamicQuoteId ?? requirements.extra?.dpsInvoiceId ?? "no-extra";

const app = express();

// Configure express to parse JSON bodies
app.use(express.json());

type VerifyRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

type SettleRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

type CreateQuoteRequest = {
  paymentRequirements: PaymentRequirements;
  negotiatedAmount: string;
  ttlSeconds?: number;
};

const normalizePaymentRequirements = (requirements: PaymentRequirements) => {
  if (requirements.extra?.dynamicQuoteId) {
    return dynamicQuoteStore.applyDynamicQuote(requirements);
  }

  if (requirements.extra?.dpsInvoiceId) {
    return dpsInvoiceStore.applyInvoice(requirements);
  }

  return requirements;
};

app.get("/verify", (req: Request, res: Response) => {
  res.json({
    endpoint: "/verify",
    description: "POST to verify x402 payments",
    body: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
  });
});

app.post("/verify", async (req: Request, res: Response) => {
  try {
    const body: VerifyRequest = req.body;
    const parsedRequirements = PaymentRequirementsSchema.parse(body.paymentRequirements);
    const paymentRequirements = normalizePaymentRequirements(parsedRequirements);
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    logInfo("/verify", describePaymentIdentifier(paymentRequirements), paymentRequirements.payTo);

    // use the correct client/signer based on the requested network
    // svm verify requires a Signer because it signs & simulates the txn
    let client: Signer | ConnectedClient;
    if (SupportedEVMNetworks.includes(paymentRequirements.network)) {
      client = createConnectedClient(paymentRequirements.network);
    } else if (SupportedSVMNetworks.includes(paymentRequirements.network)) {
      client = await createSigner(paymentRequirements.network, SVM_PRIVATE_KEY);
    } else {
      throw new Error("Invalid network");
    }

    // verify
    const valid = await verify(client, paymentPayload, paymentRequirements, x402Config);
    logInfo(
      "/verify result",
      describePaymentIdentifier(paymentRequirements),
      valid.isValid ? "valid" : valid.invalidReason ?? "invalid",
    );
    res.json(valid);
  } catch (error) {
    if (error instanceof QuoteError || error instanceof DpsInvoiceError) {
      res.status(409).json({ error: error.message });
      return;
    }
    logError("verify failed", error);
    res.status(400).json({ error: "Invalid request" });
  }
});

app.get("/settle", (req: Request, res: Response) => {
  res.json({
    endpoint: "/settle",
    description: "POST to settle x402 payments",
    body: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
  });
});

app.get("/supported", async (req: Request, res: Response) => {
  let kinds: SupportedPaymentKind[] = [];

  // evm
  if (EVM_PRIVATE_KEY) {
    kinds.push({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
    });
  }

  // svm
  if (SVM_PRIVATE_KEY) {
    const signer = await createSigner("solana-devnet", SVM_PRIVATE_KEY);
    const feePayer = isSvmSignerWallet(signer) ? signer.address : undefined;

    kinds.push({
      x402Version: 1,
      scheme: "exact",
      network: "solana-devnet",
      extra: {
        feePayer,
      },
    });
  }
  res.json({
    kinds,
  });
});

app.post("/settle", async (req: Request, res: Response) => {
  try {
    const body: SettleRequest = req.body;
    const parsedRequirements = PaymentRequirementsSchema.parse(body.paymentRequirements);
    const paymentRequirements = normalizePaymentRequirements(parsedRequirements);
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    logInfo("/settle", describePaymentIdentifier(paymentRequirements), paymentRequirements.payTo);

    // use the correct private key based on the requested network
    let signer: Signer;
    if (SupportedEVMNetworks.includes(paymentRequirements.network)) {
      signer = await createSigner(paymentRequirements.network, EVM_PRIVATE_KEY);
    } else if (SupportedSVMNetworks.includes(paymentRequirements.network)) {
      signer = await createSigner(paymentRequirements.network, SVM_PRIVATE_KEY);
    } else {
      throw new Error("Invalid network");
    }

    // settle
    const response = await settle(signer, paymentPayload, paymentRequirements, x402Config);
    logInfo(
      "/settle result",
      describePaymentIdentifier(paymentRequirements),
      response.success ? "success" : response.errorReason ?? "failed",
    );

    const invoiceId = paymentRequirements.extra?.dpsInvoiceId;
    if (invoiceId) {
      dpsInvoiceStore.markInvoicePaid(invoiceId);
    }

    res.json(response);
  } catch (error) {
    if (error instanceof QuoteError || error instanceof DpsInvoiceError) {
      res.status(409).json({ error: error.message });
      return;
    }
    logError("settle failed", error);
    res.status(400).json({ error: `Invalid request: ${error}` });
  }
});

app.post("/dps/quote", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<CreateQuoteRequest>;
    if (!body?.paymentRequirements || typeof body.negotiatedAmount === "undefined") {
      throw new QuoteError("paymentRequirements and negotiatedAmount are required");
    }

    const paymentRequirements = PaymentRequirementsSchema.parse(body.paymentRequirements);
    const negotiatedAmount =
      typeof body.negotiatedAmount === "string"
        ? body.negotiatedAmount
        : String(body.negotiatedAmount);

    const ttlSeconds =
      typeof body.ttlSeconds === "undefined" ? undefined : Number(body.ttlSeconds);

    if (ttlSeconds !== undefined && Number.isNaN(ttlSeconds)) {
      throw new QuoteError("ttlSeconds must be numeric");
    }

    const { quote, invoice } = dynamicQuoteStore.createQuote({
      paymentRequirements,
      negotiatedAmount,
      ttlSeconds,
    });
    logInfo(
      "/dps/quote",
      quote.id,
      `amount=${quote.negotiatedAmount}`,
      `expires=${quote.expiresAt.toISOString()}`,
    );

    res.json({
      quoteId: quote.id,
      negotiatedAmount: quote.negotiatedAmount,
      expiresAt: quote.expiresAt.toISOString(),
      paymentRequirements: quote.paymentRequirements,
      dpsPaymentRequirements: invoice.paymentRequirements,
      dpsInvoiceId: invoice.id,
      dpsInvoiceExpiresAt: invoice.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof QuoteError || error instanceof DpsInvoiceError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logError("quote failed", error);
    res.status(400).json({ error: "Invalid request" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening at http://localhost:${process.env.PORT || 3000}`);
  logInfo("ready", `port=${process.env.PORT || 3000}`);
});
