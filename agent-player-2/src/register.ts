import { config } from "dotenv";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  abstract,
  abstractTestnet,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  eduChain,
  iotex,
  iotexTestnet,
  peaq,
  polygon,
  polygonAmoy,
  sei,
  seiTestnet,
  skaleBaseSepolia,
  story,
} from "viem/chains";

config();

const CHAIN_MAP: Record<string, ReturnType<typeof base>> = {
  abstract,
  "abstract-testnet": abstractTestnet,
  avalanche,
  "avalanche-fuji": avalancheFuji,
  base,
  "base-sepolia": baseSepolia,
  eduChain,
  iotex,
  "iotex-testnet": iotexTestnet,
  peaq,
  polygon,
  "polygon-amoy": polygonAmoy,
  sei,
  "sei-testnet": seiTestnet,
  story,
  "skale-base-sepolia": skaleBaseSepolia,
};

const casinoUrl = (process.env.CASINO_URL ?? "http://localhost:4000").replace(/\/$/, "");
const roomId = process.env.CASINO_ROOM_ID ?? process.env.ROOM_ID;
const signupSkill = process.env.SIGNUP_SKILL ?? "signup";
const actionSkill = process.env.ACTION_SKILL ?? "act";
const preferredSeat = process.env.PREFERRED_SEAT;
const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const network = process.env.NETWORK ?? "base-sepolia";
const agentCardUrl =
  process.env.AGENT_CARD_URL ??
  `${(process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8788}`)
    .replace(/\/$/, "")}/.well-known/agent-card.json`;

if (!roomId) {
  throw new Error("Set CASINO_ROOM_ID (or ROOM_ID) to the poker room you want to join.");
}
if (!privateKey) {
  throw new Error("PRIVATE_KEY must be set so the agent can sign x402 payments.");
}

const chain = CHAIN_MAP[network];
if (!chain) {
  throw new Error(`Unsupported NETWORK "${network}" for registration.`);
}

const wallet = createWalletClient({
  account: privateKeyToAccount(privateKey),
  chain,
  transport: http(),
});

const fetchWithPayment = wrapFetchWithPayment(fetch, wallet);
const registerUrl = `${casinoUrl}/ui/rooms/${encodeURIComponent(roomId)}/register`;

const body: Record<string, unknown> = {
  agentCardUrl,
  signupSkill,
  actionSkill,
};
if (preferredSeat) {
  const seat = Number(preferredSeat);
  if (Number.isFinite(seat)) {
    body.preferredSeat = seat;
  }
}

async function main() {
  console.log(`➡️  Registering ${agentCardUrl} with ${registerUrl}`);
  const response = await fetchWithPayment(registerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Registration failed (${response.status}): ${data?.error ?? response.statusText}`);
  }
  console.log(`✅ Registered player: ${data.player?.displayName ?? data.playerId ?? "unknown"}`);
  const receipt = response.headers.get("X-PAYMENT-RESPONSE");
  if (receipt) {
    console.log("🧾 Payment receipt:", receipt);
  }
}

main().catch((error) => {
  console.error("❌ Registration error:", error);
  process.exit(1);
});
