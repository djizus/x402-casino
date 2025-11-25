import { app } from './lib/casino-agent';

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

console.log(`Starting casino agent on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
