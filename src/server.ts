import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { createBot, getBot, listBots, removeBot, sendChatMessage } from './services/recall';
import { generateResponse, shouldRespond } from './services/openai';
import type {
  CreateBotApiRequest,
  ChatApiRequest,
  ChatApiResponse,
  ApiErrorResponse,
  ChatMessage,
} from './types';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory conversation storage (use Redis/DB in production)
const conversations = new Map<string, ChatMessage[]>();

// Store for SSE clients (to push transcripts to bot page)
const transcriptClients = new Map<string, Response[]>();

// Error handler wrapper
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
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
    if (!baseUrl) {
      res.status(500).json({ error: 'BASE_URL is not configured' } as ApiErrorResponse);
      return;
    }

    // Generate a session token for security
    const sessionToken = generateSessionToken();
    const webpageUrl = `${baseUrl}/bot-page/index.html?token=${sessionToken}`;

    const bot = await createBot({
      meetingUrl,
      botName,
      webpageUrl,
    });

    // Initialize conversation for this bot
    conversations.set(bot.id, []);

    res.json({
      ...bot,
      sessionToken,
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
    await removeBot(req.params.id);
    conversations.delete(req.params.id);
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

// Process transcript and generate AI response
app.post(
  '/api/chat',
  asyncHandler(async (req: Request<{}, {}, ChatApiRequest>, res) => {
    const { transcript, speaker, context } = req.body;

    if (!transcript) {
      res.status(400).json({ error: 'transcript is required' } as ApiErrorResponse);
      return;
    }

    // Use provided context or empty array
    const conversationHistory = context || [];

    const { response, tokensUsed } = await generateResponse(
      transcript,
      conversationHistory,
      speaker
    );

    const result: ChatApiResponse = {
      response,
      tokens_used: tokensUsed,
    };

    res.json(result);
  })
);

// Check if transcript should trigger a response
app.post('/api/chat/should-respond', (req, res) => {
  const { transcript, triggerWords } = req.body;

  if (!transcript) {
    res.status(400).json({ error: 'transcript is required' } as ApiErrorResponse);
    return;
  }

  const should = shouldRespond(transcript, triggerWords);
  res.json({ shouldRespond: should });
});

// Recall.ai webhook endpoint
app.post('/api/webhook/recall', (req, res) => {
  const event = req.body;
  console.log('Recall.ai webhook event:', JSON.stringify(event, null, 2));

  // Handle different event types
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

  // Add this client to the list
  if (!transcriptClients.has(token)) {
    transcriptClients.set(token, []);
  }
  transcriptClients.get(token)!.push(res);

  console.log(`SSE client connected (token: ${token})`);

  // Send a heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Remove client on disconnect
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
