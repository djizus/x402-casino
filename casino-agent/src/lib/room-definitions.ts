import { z } from 'zod';

import type { RoomLauncher } from './room-launcher';
import type { RoomConfig, RoomState, SignupInvitation } from './protocol';

export type RoomAgentSkills = {
  configure: string;
  register: string;
  start: string;
  summary: string;
};

export type GameConfigField = {
  key: string;
  label: string;
  type: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  helperText?: string;
};

export type RoomGameDefinition<Config extends RoomConfig = RoomConfig> = {
  type: string;
  label: string;
  description: string;
  supportsRegistration: boolean;
  configSchema: z.ZodType<Config>;
  defaultConfig: Config;
  configFields: GameConfigField[];
  normalizeConfig: (payload: unknown, defaults: Config) => Config;
  roomAgent: {
    skills: RoomAgentSkills;
    defaultCardUrl?: string;
    launcher?: RoomLauncher;
  };
  registration?: {
    buildInvitation: (args: { casinoName: string; roomId: string; config: Config }) => SignupInvitation;
    clampBuyIn: (value: number | undefined, config: Config) => number;
  };
  shouldAutoStart?: (args: { summary?: RoomState; config: Config }) => boolean;
};

export type GameMetadata = {
  type: string;
  label: string;
  description: string;
  supportsRegistration: boolean;
  configFields: GameConfigField[];
  defaultConfig: Record<string, unknown>;
};
