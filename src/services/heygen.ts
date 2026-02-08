/**
 * HeyGen Streaming Avatar API client
 * Manages avatar sessions with LiveKit WebRTC delivery
 */

const HEYGEN_API_BASE = 'https://api.heygen.com';

interface HeyGenSession {
  sessionId: string;
  token: string;
  livekitUrl: string;
  livekitToken: string;
  keepAliveTimer: NodeJS.Timeout | null;
}

// In-memory session store (key = bot-level identifier)
const sessions = new Map<string, HeyGenSession>();

function getApiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error('HEYGEN_API_KEY is not set');
  return key;
}

export function isHeyGenEnabled(): boolean {
  return !!process.env.HEYGEN_API_KEY;
}

/** Create a session-scoped access token */
export async function createSessionToken(): Promise<string> {
  const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.create_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen create_token failed: ${err}`);
  }

  const data = await res.json() as { data: { token: string } };
  return data.data.token;
}

/** Create a new streaming session and get LiveKit credentials */
export async function createSession(
  token: string,
  avatarId?: string
): Promise<{ sessionId: string; livekitUrl: string; livekitToken: string }> {
  const avatar = avatarId || process.env.HEYGEN_AVATAR_NAME || 'Wayne_20240711';

  const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.new`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      version: 'v2',
      avatar_id: avatar,
      quality: 'high',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen streaming.new failed: ${err}`);
  }

  const data = await res.json() as {
    data: {
      session_id: string;
      url: string;
      access_token: string;
    };
  };

  return {
    sessionId: data.data.session_id,
    livekitUrl: data.data.url,
    livekitToken: data.data.access_token,
  };
}

/** Start the streaming session (avatar becomes active) */
export async function startSession(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen streaming.start failed: ${err}`);
  }
}

/** Send text for the avatar to speak (repeat mode = TTS + lip sync) */
export async function sendTask(token: string, sessionId: string, text: string): Promise<void> {
  const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
      text,
      task_type: 'repeat',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen streaming.task failed: ${err}`);
  }
}

/** Stop and destroy the streaming session */
export async function stopSession(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`HeyGen streaming.stop warning: ${err}`);
  }
}

/** Send keep-alive ping to prevent session timeout */
async function sendKeepAlive(token: string, sessionId: string): Promise<void> {
  try {
    const res = await fetch(`${HEYGEN_API_BASE}/v1/streaming.keep_alive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
    });

    if (!res.ok) {
      console.warn('HeyGen keep_alive failed:', await res.text());
    }
  } catch (err) {
    console.warn('HeyGen keep_alive error:', err);
  }
}

/**
 * Initialize a full HeyGen session: token → new → start → keepalive
 * Returns LiveKit credentials for the bot page to connect.
 */
export async function initializeSession(id: string): Promise<{
  sessionToken: string;
  livekitUrl: string;
  livekitToken: string;
}> {
  console.log(`[HeyGen] Initializing session for ${id}...`);

  // Clean up any leftover sessions to avoid concurrent limit errors
  await destroyAllSessions();

  const token = await createSessionToken();
  const { sessionId, livekitUrl, livekitToken } = await createSession(token);

  console.log(`[HeyGen] Session created: ${sessionId}`);

  await startSession(token, sessionId);
  console.log(`[HeyGen] Session started`);

  // Start keep-alive timer (every 60 seconds)
  const keepAliveTimer = setInterval(() => {
    sendKeepAlive(token, sessionId);
  }, 60_000);

  const session: HeyGenSession = {
    sessionId,
    token,
    livekitUrl,
    livekitToken,
    keepAliveTimer,
  };

  sessions.set(id, session);

  return { sessionToken: token, livekitUrl, livekitToken };
}

/** Destroy a session: stop streaming + clear keepalive */
export async function destroySession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;

  console.log(`[HeyGen] Destroying session for ${id}...`);

  if (session.keepAliveTimer) {
    clearInterval(session.keepAliveTimer);
  }

  try {
    await stopSession(session.token, session.sessionId);
    console.log(`[HeyGen] Session stopped`);
  } catch (err) {
    console.warn(`[HeyGen] Error stopping session:`, err);
  }

  sessions.delete(id);
}

/** Get a session by its identifier */
export function getSession(id: string): HeyGenSession | undefined {
  return sessions.get(id);
}

/** Get a session by its identifier (sessionToken from server, used when client sends init message) */
export function getSessionByToken(token: string): { id: string; session: HeyGenSession } | undefined {
  const session = sessions.get(token);
  if (session) {
    return { id: token, session };
  }
  return undefined;
}

/** Destroy all active sessions (used for cleanup on server start / before new session) */
export async function destroyAllSessions(): Promise<void> {
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    await destroySession(id);
  }
}
