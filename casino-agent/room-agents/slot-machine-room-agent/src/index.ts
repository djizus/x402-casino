import { app } from './lib/agent';

const port = process.env.PORT ? Number(process.env.PORT) : 4700;

console.log(`Starting slot machine room agent on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
