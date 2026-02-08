import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { AgentServer, ServerOptions, cli } from '@livekit/agents';
import { fileURLToPath } from 'url';
import path from 'path';
import app from './server';

const PORT = process.env.PORT || 3000;

// Start Express HTTP server for REST API (bot management, webhooks, etc.)
const httpServer = createServer(app);

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Meet Agent - AI Meeting Assistant                ║
╠════════════════════════════════════════════════════════════╣
║  REST API running on port ${PORT}                              ║
║  Using: Gemini Live API + Hedra Avatar + LiveKit           ║
╚════════════════════════════════════════════════════════════╝
  `);

  const required = [
    'RECALL_API_KEY',
    'GOOGLE_API_KEY',
    'HEDRA_API_KEY',
    'HEDRA_AVATAR_ID',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'BASE_URL',
  ];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.warn(`Warning: Missing env vars: ${missing.join(', ')}`);
  }
});

// Start LiveKit Agent Server
// The agent file is loaded dynamically by the framework in a child process.
// Even in dev mode (ts-node), the child process uses native ESM import(),
// so we always point to the compiled .js file in dist/.
const agentFilePath = path.resolve(__dirname, '..', 'dist', 'agent.js');

cli.runApp(
  new ServerOptions({
    agent: agentFilePath,
    wsURL: process.env.LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    port: Number(process.env.AGENT_PORT) || 8081,
    production: process.env.NODE_ENV === 'production',
  })
);
