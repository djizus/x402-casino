import { createAgent } from "@lucid-agents/core";
import { http } from "@lucid-agents/http";
import { a2a } from "@lucid-agents/a2a";
import { createAgentApp } from "@lucid-agents/hono";
import { createAxLLMClient } from "@lucid-agents/core/axllm";

import {
  ActionRequest,
  ActionResponse,
  actionRequestSchema,
  actionResponseSchema,
  playerSignupResponseSchema,
  signupInvitationSchema,
} from "./protocol";

const playerName = process.env.PLAYER_DISPLAY_NAME ?? "Player One";

const GEMINI_MODEL = process.env.PLAYER_MODEL?.trim() || "gemini-1.5-pro";
const geminiApiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  process.env.AX_GEMINI_API_KEY ??
  "";

const axClient = createAxLLMClient({
  provider: "google-gemini",
  model: GEMINI_MODEL,
  apiKey: geminiApiKey || undefined,
  x402: {
    ai: {
      name: "google-gemini",
      apiKey: geminiApiKey || undefined,
      config: {
        model: GEMINI_MODEL,
      },
    },
  },
  logger: {
    warn(message, error) {
      if (error) {
        console.warn(`[player-1] ${message}`, error);
      } else {
        console.warn(`[player-1] ${message}`);
      }
    },
  },
});

if (!axClient.isConfigured()) {
  console.warn(
    "[player-1] Gemini client is not configured — falling back to scripted play."
  );
}

const agent = await createAgent({
  name: process.env.AGENT_NAME ?? "poker-player-1",
  version: process.env.AGENT_VERSION ?? "0.1.0",
  description:
    process.env.AGENT_DESCRIPTION ??
    "Gemini-powered poker agent that prefers solid, low-variance lines.",
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

addEntrypoint({
  key: "signup",
  description: "Respond to casino invitations with table preferences.",
  input: signupInvitationSchema,
  output: playerSignupResponseSchema,
  handler: async (ctx) => {
    signupInvitationSchema.parse(ctx.input);
    return {
      output: {
        displayName: playerName,
      },
    };
  },
});

addEntrypoint({
  key: "play",
  description: "Choose a poker action based on the current table state.",
  input: actionRequestSchema,
  output: actionResponseSchema,
  handler: async (ctx) => {
    const request = actionRequestSchema.parse(ctx.input);
    const action = await selectAction(request);
    return {
      output: action,
    };
  },
});

const rankStrength: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const selectAction = async (request: ActionRequest): Promise<ActionResponse> => {
  if (!axClient.ax) {
    return baselineStrategy(request);
  }

  try {
    const aiAction = await generateActionWithGemini(request);
    if (aiAction) {
      return aiAction;
    }
  } catch (error) {
    console.warn("[player-1] Gemini decision failed, falling back.", error);
  }

  return baselineStrategy(request);
};

const generateActionWithGemini = async (
  request: ActionRequest
): Promise<ActionResponse | null> => {
  const llm = axClient.ax;
  if (!llm) {
    return null;
  }

  const response = await llm.chat({
    model: GEMINI_MODEL,
    chatPrompt: [
      {
        role: "system",
        content:
          "You are a disciplined Texas Hold'em poker assistant. " +
          "Return a single JSON object describing the best action. " +
          "Use this shape: {\"action\":\"fold|check|call|bet|raise|all-in\",\"amount\":number,\"message\":\"short rationale\"}. " +
          "Keep the amount within the player's stack and legal moves. Never include extra text outside JSON.",
      },
      {
        role: "user",
        content: buildActionPrompt(request),
      },
    ],
  });

  const raw = response.results[0]?.content?.trim();
  if (!raw) {
    return null;
  }

  const parsed = parseActionFromModel(raw);
  return parsed ?? null;
};

const baselineStrategy = (request: ActionRequest): ActionResponse => {
  const score = request.holeCards.reduce(
    (total, card) => total + (rankStrength[card.rank] ?? 0),
    0
  );
  const isPaired = request.holeCards[0].rank === request.holeCards[1].rank;
  const isSuited = request.holeCards[0].suit === request.holeCards[1].suit;
  const aggressive = isPaired || score >= 22 || (isSuited && score >= 18);

  if (aggressive && request.legalActions.includes("bet")) {
    const amount = Math.min(
      request.playerStack,
      Math.max(request.minimumRaise, Math.round(request.playerStack * 0.1))
    );
    return { action: "bet", amount };
  }

  if (request.legalActions.includes("check")) {
    return { action: "check" };
  }

  if (request.legalActions.includes("call")) {
    return { action: "call", amount: request.currentBet };
  }

  if (!aggressive && request.legalActions.includes("fold")) {
    return { action: "fold" };
  }

  return { action: "all-in", amount: request.playerStack };
};

const buildActionPrompt = (request: ActionRequest): string => {
  const cards = request.holeCards.map((card) => `${card.rank}${card.suit[0]}`).join(" ");
  const board =
    request.communityCards.length > 0
      ? request.communityCards.map((card) => `${card.rank}${card.suit[0]}`).join(" ")
      : "none";

  return [
    `Stage: ${request.bettingRound}`,
    `Hole cards: ${cards}`,
    `Community cards: ${board}`,
    `Pot: ${request.pot}`,
    `Current bet to call: ${request.currentBet}`,
    `Stack: ${request.playerStack}`,
    `Minimum raise: ${request.minimumRaise}`,
    `Legal actions: ${request.legalActions.join(", ")}`,
  ].join("\n");
};

const parseActionFromModel = (raw: string): ActionResponse | undefined => {
  const snippet = extractJson(raw);
  try {
    const candidate = JSON.parse(snippet);
    const result = actionResponseSchema.safeParse(candidate);
    if (result.success) {
      return result.data;
    }
  } catch {
    // ignore parse failures
  }
  return undefined;
};

const extractJson = (raw: string): string => {
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return raw.trim();
};

export { app };
