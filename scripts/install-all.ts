import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const projectRoots = [
  'casino-agent',
  'poker-room-agent',
  'slot-machine-room-agent',
  'blackjack-room-agent',
  'agent-player-1',
  'agent-player-2',
  'client',
  'dps-facilitator',
];

for (const relativePath of projectRoots) {
  const projectPath = resolve(rootDir, relativePath);
  if (!existsSync(projectPath)) {
    console.warn(`[install-all] Skipping missing project: ${projectPath}`);
    continue;
  }

  console.log(`[install-all] Installing dependencies in ${projectPath}`);
  const result = spawnSync('bun', ['install'], {
    cwd: projectPath,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[install-all] Failed to install dependencies in ${projectPath}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[install-all] All sub-project installs completed.');
