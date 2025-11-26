import { app } from './lib/agent';

const port = process.env.PORT ? Number(process.env.PORT) : 4500;

console.log(`Starting poker room agent on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
