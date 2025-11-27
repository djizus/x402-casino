import { app } from './lib/agent';

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const host = process.env.HOST || 'localhost';

console.log(`Starting agent server on port ${port}...`);
console.log(`\n📋 Agent Registration URL:`);
console.log(`   http://${host}:${port}/.well-known/ai-agent.json`);
console.log(`\n   Copy this URL to register the agent\n`);

export default {
  port,
  fetch: app.fetch,
};
