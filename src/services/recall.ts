import type { Bot, CreateBotOptions, CreateBotRequest } from '../types';

function getApiBase(): string {
  const region = process.env.RECALL_API_REGION || 'asia';
  switch (region) {
    case 'eu':
      return 'https://eu-west-1.recall.ai/api/v1';
    case 'us':
      return 'https://us-west-2.recall.ai/api/v1';
    case 'asia':
    default:
      return 'https://ap-northeast-1.recall.ai/api/v1'; // Tokyo
  }
}

const RECALL_API_BASE = getApiBase();

function getAuthHeaders(): Record<string, string> {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) {
    throw new Error('RECALL_API_KEY is not set');
  }
  return {
    'Authorization': `Token ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a new bot and have it join a meeting
 */
export async function createBot(options: CreateBotOptions): Promise<Bot> {
  const requestBody: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName || 'AI Assistant',
    // Use 4-core instances for WebRTC-heavy workloads (LiveKit + Hedra avatar)
    // Default instances lack CPU for simultaneous WebRTC decode + render
    variant: {
      zoom: 'web_4_core',
      google_meet: 'web_4_core',
      microsoft_teams: 'web_4_core',
    },
    output_media: {
      camera: {
        kind: 'webpage',
        config: {
          url: options.webpageUrl,
        },
      },
    },
  };

  const response = await fetch(`${RECALL_API_BASE}/bot`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create bot: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<Bot>;
}

/**
 * Get bot information by ID
 */
export async function getBot(botId: string): Promise<Bot> {
  const response = await fetch(`${RECALL_API_BASE}/bot/${botId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get bot: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<Bot>;
}

/**
 * List all bots
 */
export async function listBots(): Promise<{ results: Bot[] }> {
  const response = await fetch(`${RECALL_API_BASE}/bot`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list bots: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<{ results: Bot[] }>;
}

/**
 * Remove a bot from the meeting
 */
export async function removeBot(botId: string): Promise<void> {
  const response = await fetch(`${RECALL_API_BASE}/bot/${botId}/leave_call`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to remove bot: ${response.status} ${errorText}`);
  }
}

/**
 * Start output media (if not started at bot creation)
 */
export async function startOutputMedia(
  botId: string,
  webpageUrl: string,
  target: 'camera' | 'screenshare' = 'camera'
): Promise<void> {
  const response = await fetch(`${RECALL_API_BASE}/bot/${botId}/output_media`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      [target]: {
        kind: 'webpage',
        config: {
          url: webpageUrl,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start output media: ${response.status} ${errorText}`);
  }
}

/**
 * Stop output media
 */
export async function stopOutputMedia(
  botId: string,
  target: 'camera' | 'screenshare' = 'camera'
): Promise<void> {
  const response = await fetch(
    `${RECALL_API_BASE}/bot/${botId}/output_media?${target}=true`,
    {
      method: 'DELETE',
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to stop output media: ${response.status} ${errorText}`);
  }
}

/**
 * Send a chat message to the meeting
 */
export async function sendChatMessage(botId: string, message: string): Promise<void> {
  const response = await fetch(`${RECALL_API_BASE}/bot/${botId}/send_chat_message`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send chat message: ${response.status} ${errorText}`);
  }
}
