import { app } from './lib/agent';

const port = process.env.PORT ? Number(process.env.PORT) : 4600;

console.log(`Starting blackjack room agent on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
