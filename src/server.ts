import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { AccessToken } from 'livekit-server-sdk';
import { createBot, getBot, listBots, removeBot, sendChatMessage } from './services/recall';
import type {
  CreateBotApiRequest,
  ChatMessage,
  ApiErrorResponse,
  BotSession,
} from './types';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory conversation storage
const conversations = new Map<string, ChatMessage[]>();

// Bot session tracking (botId -> session info)
const botSessions = new Map<string, BotSession>();

// Store for SSE clients
const transcriptClients = new Map<string, Response[]>();

// Error handler wrapper
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Generate a LiveKit access token for a participant
 */
async function createLiveKitToken(roomName: string, participantIdentity: string): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create a new bot and join a meeting
app.post(
  '/api/bot/create',
  asyncHandler(async (req: Request<{}, {}, CreateBotApiRequest>, res) => {
    const { meetingUrl, botName } = req.body;

    if (!meetingUrl) {
      res.status(400).json({ error: 'meetingUrl is required' } as ApiErrorResponse);
      return;
    }

    const baseUrl = process.env.BASE_URL;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!baseUrl) {
      res.status(500).json({ error: 'BASE_URL is not configured' } as ApiErrorResponse);
      return;
    }
    if (!livekitUrl) {
      res.status(500).json({ error: 'LIVEKIT_URL is not configured' } as ApiErrorResponse);
      return;
    }

    // Generate session token and LiveKit room
    const sessionToken = generateSessionToken();
    const roomName = `meet-agent-${sessionToken}`;

    // Generate LiveKit token for the bot-page participant
    const livekitToken = await createLiveKitToken(roomName, `bot-page-${sessionToken}`);

    // Build bot page URL with LiveKit connection params
    const params = new URLSearchParams({
      token: sessionToken,
      lk_url: livekitUrl,
      lk_token: livekitToken,
      room: roomName,
    });
    const webpageUrl = `${baseUrl}/bot-page/index.html?${params.toString()}`;

    const bot = await createBot({
      meetingUrl,
      botName,
      webpageUrl,
    });

    // Store session info
    botSessions.set(bot.id, {
      botId: bot.id,
      roomName,
      sessionToken,
    });

    // Initialize conversation for this bot
    conversations.set(bot.id, []);

    res.json({
      ...bot,
      sessionToken,
      roomName,
    });
  })
);

// Get bot status
app.get(
  '/api/bot/:id',
  asyncHandler(async (req, res) => {
    const bot = await getBot(req.params.id);
    res.json(bot);
  })
);

// List all bots
app.get(
  '/api/bot',
  asyncHandler(async (_req, res) => {
    const bots = await listBots();
    res.json(bots);
  })
);

// Remove bot from meeting
app.post(
  '/api/bot/:id/leave',
  asyncHandler(async (req, res) => {
    const botId = req.params.id;

    await removeBot(botId);

    // Cleanup
    conversations.delete(botId);
    botSessions.delete(botId);

    res.json({ success: true });
  })
);

// Send chat message through bot
app.post(
  '/api/bot/:id/chat',
  asyncHandler(async (req, res) => {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' } as ApiErrorResponse);
      return;
    }
    await sendChatMessage(req.params.id, message);
    res.json({ success: true });
  })
);

// Recall.ai webhook endpoint
app.post('/api/webhook/recall', (req, res) => {
  const event = req.body;
  console.log('Recall.ai webhook event:', JSON.stringify(event, null, 2));

  switch (event.event) {
    case 'bot.status_change':
      console.log(`Bot ${event.data.bot_id} status changed to: ${event.data.status}`);
      break;
    case 'bot.transcription':
      console.log(`Transcription from bot ${event.data.bot_id}:`, event.data.transcript);
      break;
    default:
      console.log('Unknown event type:', event.event);
  }

  res.json({ received: true });
});

// Real-time transcription webhook from Recall.ai
app.post('/api/webhook/transcript', (req, res) => {
  const data = req.body;
  console.log('Transcript webhook received:', JSON.stringify(data, null, 2));

  // Broadcast to all connected SSE clients
  transcriptClients.forEach((clients) => {
    clients.forEach((client) => {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  });

  res.json({ received: true });
});

// SSE endpoint for bot page to receive transcripts
app.get('/api/transcript/stream', (req, res) => {
  const token = req.query.token as string || 'default';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!transcriptClients.has(token)) {
    transcriptClients.set(token, []);
  }
  transcriptClients.get(token)!.push(res);

  console.log(`SSE client connected (token: ${token})`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = transcriptClients.get(token);
    if (clients) {
      const index = clients.indexOf(res);
      if (index > -1) {
        clients.splice(index, 1);
      }
    }
    console.log(`SSE client disconnected (token: ${token})`);
  });
});

// Test endpoint: join LiveKit room directly (no Recall.ai) to verify avatar quality
app.get(
  '/api/test/room',
  asyncHandler(async (_req, res) => {
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!livekitUrl) {
      res.status(500).json({ error: 'LIVEKIT_URL is not configured' } as ApiErrorResponse);
      return;
    }

    const sessionToken = generateSessionToken();
    const roomName = `meet-agent-${sessionToken}`;
    const identity = `test-viewer-${sessionToken}`;
    const livekitToken = await createLiveKitToken(roomName, identity);

    const params = new URLSearchParams({
      token: sessionToken,
      lk_url: livekitUrl,
      lk_token: livekitToken,
      room: roomName,
    });

    res.json({
      roomName,
      viewerUrl: `/bot-page/index.html?${params.toString()}`,
      livekitUrl,
      livekitToken,
      identity,
    });
  })
);

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  } as ApiErrorResponse);
});

// Generate a simple session token
function generateSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

export default app;
