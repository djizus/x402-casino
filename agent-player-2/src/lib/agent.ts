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

const playerName = process.env.PLAYER_DISPLAY_NAME ?? "Player Two";
const aggressionFactor = process.env.PLAYER_AGGRESSION
  ? Number.parseFloat(process.env.PLAYER_AGGRESSION)
  : 0.6;

const GPT_MODEL = process.env.PLAYER_MODEL?.trim() || "gpt-4.1-mini";
const openAiKey = process.env.OPENAI_API_KEY ?? process.env.AX_OPENAI_API_KEY ?? "";

const axClient = createAxLLMClient({
  provider: "openai",
  model: GPT_MODEL,
  apiKey: openAiKey || undefined,
  x402: {
    ai: {
      name: "openai",
      apiKey: openAiKey || undefined,
      config: {
        model: GPT_MODEL,
      },
    },
  },
  logger: {
    warn(message, error) {
      if (error) {
        console.warn(`[player-2] ${message}`, error);
      } else {
        console.warn(`[player-2] ${message}`);
      }
    },
  },
});

if (!axClient.isConfigured()) {
  console.warn("[player-2] OpenAI client missing — reverting to heuristic play.");
}

const agent = await createAgent({
  name: process.env.AGENT_NAME ?? "poker-player-2",
  version: process.env.AGENT_VERSION ?? "0.1.0",
  description:
    process.env.AGENT_DESCRIPTION ??
    "GPT-powered poker agent that applies pressure with strategic bluffs.",
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

addEntrypoint({
  key: "signup",
  description: "Provide casino registration information.",
  input: signupInvitationSchema,
  output: playerSignupResponseSchema,
  handler: async (ctx) => {
    const invitation = signupInvitationSchema.parse(ctx.input);
    return {
      output: {
        displayName: playerName,
        actionSkill: "act",
        buyIn: invitation.maxBuyIn,
      },
    };
  },
});

addEntrypoint({
  key: "act",
  description: "Choose an action for the current betting round.",
  input: actionRequestSchema,
  output: actionResponseSchema,
  handler: async (ctx) => {
    const request = actionRequestSchema.parse(ctx.input);
    const action = await chooseAction(request);
    return {
      output: action,
    };
  },
});

const chooseAction = async (request: ActionRequest): Promise<ActionResponse> => {
  if (!axClient.ax) {
    return fallbackAggression(request);
  }

  try {
    const llm = axClient.ax;
    const response = await llm.chat({
      model: GPT_MODEL,
      chatPrompt: [
        {
          role: "system",
          content:
            "You are an aggressive but smart Texas Hold'em professional. " +
            "Always return JSON like {\"action\":\"...\",\"amount\":number,\"message\":\"...\"}. " +
            "Lean toward pressure when stack and board texture allow, but respect legal actions.",
        },
        {
          role: "user",
          content: buildActionPrompt(request),
        },
      ],
    });

    const rawDecision = response.results[0]?.content?.trim();
    if (rawDecision) {
      const parsed = parseActionFromModel(rawDecision);
      if (parsed) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("[player-2] GPT decision failed, reverting to heuristics.", error);
  }

  return fallbackAggression(request);
};

const fallbackAggression = (request: ActionRequest): ActionResponse => {
  const ranks = request.holeCards.map((card) => card.rank);
  const suited = request.holeCards[0].suit === request.holeCards[1].suit;
  const paired = ranks[0] === ranks[1];
  const highCard = Math.max(...ranks.map((rank) => rankStrength(rank)));
  const stageIndex = stageStrength(request.bettingRound);
  const bluffChance = Math.random();

  if (paired || highCard >= 12 + stageIndex) {
    return raiseOrBet(request, 0.25);
  }

  if (suited && highCard >= 10 && request.legalActions.includes("bet")) {
    return raiseOrBet(request, 0.18);
  }

  if (bluffChance < aggressionFactor && request.legalActions.includes("bet")) {
    return raiseOrBet(request, 0.08);
  }

  if (request.legalActions.includes("check")) {
    return { action: "check" };
  }

  if (request.legalActions.includes("call")) {
    return { action: "call", amount: request.currentBet };
  }

  return { action: "fold" };
};

const raiseOrBet = (request: ActionRequest, fraction: number): ActionResponse => {
  const base = Math.max(request.minimumRaise, Math.round(request.playerStack * fraction));
  const amount = Math.min(request.playerStack, base || request.minimumRaise || 1);
  if (request.legalActions.includes("raise")) {
    return { action: "raise", amount };
  }
  if (request.legalActions.includes("bet")) {
    return { action: "bet", amount };
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
    `Board: ${board}`,
    `Pot: ${request.pot}`,
    `Bet to call: ${request.currentBet}`,
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
    // ignore
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

const rankStrength = (rank: string): number => {
  const mapping: Record<string, number> = {
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
  return mapping[rank] ?? 0;
};

const stageStrength = (stage: ActionRequest["bettingRound"]): number => {
  switch (stage) {
    case "flop":
      return 1;
    case "turn":
      return 2;
    case "river":
      return 3;
    default:
      return 0;
  }
};

export { app };
