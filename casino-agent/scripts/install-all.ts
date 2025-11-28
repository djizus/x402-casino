import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const casinoDir = resolve(new URL('..', import.meta.url).pathname);
const projects = [
  '../poker-room-agent',
  '../slot-machine-room-agent',
  '../blackjack-room-agent',
  '../agent-player-1',
  '../agent-player-2',
  '../casino-dashboard',
  '../dps-facilitator',
].map((rel) => resolve(casinoDir, rel));

for (const projectPath of projects) {
  console.log(`[postinstall] Installing dependencies in ${projectPath}`);
  const result = spawnSync('bun', ['install'], {
    cwd: projectPath,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[postinstall] Failed to install dependencies in ${projectPath}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[postinstall] All sub-project installs completed.');
