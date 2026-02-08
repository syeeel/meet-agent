/**
 * AI Meeting Assistant - Bot Page
 * Connects to LiveKit room to display Hedra avatar and publish meeting audio
 *
 * Optimized for Recall.ai's headless Chrome environment:
 * - Minimal DOM in Hedra mode (no fallback UI, no status overlays)
 * - No CSS animations or unnecessary rendering
 * - No browser audio processing (Recall.ai handles echo cancellation)
 * - No DOM updates during playback
 */

// ==================== URL Params ====================

const urlParams = new URLSearchParams(window.location.search);
const LK_URL = urlParams.get('lk_url');
const LK_TOKEN = urlParams.get('lk_token');
const ROOM_NAME = urlParams.get('room');
const SESSION_TOKEN = urlParams.get('token');

// Determine mode based on LiveKit credentials
const isHedraMode = !!(LK_URL && LK_TOKEN);

// ==================== Hedra Mode: Strip DOM ====================

if (isHedraMode) {
  // Remove all unnecessary DOM elements to minimize rendering overhead
  const fallback = document.getElementById('fallback-container');
  if (fallback) fallback.remove();
  const hedraOverlay = document.getElementById('hedra-overlay');
  if (hedraOverlay) hedraOverlay.remove();
  // Disable stylesheet - all animations and styles are for fallback mode
  const stylesheet = document.querySelector('link[rel="stylesheet"]');
  if (stylesheet) stylesheet.remove();
  // Set body style with gradient background for letterbox areas
  // The video has background:transparent so this gradient shows through
  // on the left/right sides where the 1:1 avatar doesn't fill 16:9
  document.body.style.cssText = 'margin:0;padding:0;background:linear-gradient(135deg,#1a1a2e 0%,#2d1b3d 30%,#1e3a5f 70%,#1a1a2e 100%);overflow:hidden;';
}

// ==================== State ====================

const state = {
  room: null,
  isConnected: false,
};

// ==================== Elements ====================

const els = {
  avatarVideo: document.getElementById('avatar-video'),
  avatarAudio: document.getElementById('avatar-audio'),
  // Fallback-only elements (only used when not in Hedra mode)
  fallbackContainer: document.getElementById('fallback-container'),
  connectionStatus: document.getElementById('connection-status'),
  statusText: document.querySelector('#fallback-container .status-text'),
  listeningIndicator: document.getElementById('listening-indicator'),
  thinkingIndicator: document.getElementById('thinking-indicator'),
  speakingIndicator: document.getElementById('speaking-indicator'),
  transcriptList: document.getElementById('transcript-list'),
  aiResponse: document.getElementById('ai-response'),
};

// ==================== UI Helpers (fallback mode only) ====================

function updateFallbackStatus(status, text) {
  if (!els.connectionStatus) return;
  els.connectionStatus.className = `status ${status}`;
  if (els.statusText) els.statusText.textContent = text;
}

function showIndicator(name) {
  ['listening', 'thinking', 'speaking'].forEach((n) => {
    const el = els[`${n}Indicator`];
    if (el) el.classList.toggle('hidden', n !== name);
  });
}

function addTranscript(speaker, text) {
  if (!els.transcriptList) return;
  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.innerHTML = `<span class="transcript-speaker">${speaker}:</span><span class="transcript-text">${text}</span>`;
  els.transcriptList.appendChild(item);
  while (els.transcriptList.children.length > 10) {
    els.transcriptList.removeChild(els.transcriptList.firstChild);
  }
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

// ==================== LiveKit (Hedra Mode) ====================

async function connectLiveKit() {
  console.log('Connecting to LiveKit room:', ROOM_NAME);

  const { Room, RoomEvent, Track } = LivekitClient;

  const room = new Room({
    adaptiveStream: false,  // Disable downscaling - we always want full quality avatar
    dynacast: false,        // Disable dynamic codec switching for stable video
  });

  state.room = room;

  // Handle remote tracks - ONLY from Hedra avatar participant
  // Recall.ai captures the webpage's speaker output as the bot's microphone feed,
  // so we MUST play avatar audio here for it to reach meeting participants.
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(`Track subscribed: ${track.kind} from ${participant.identity}`);

    // Only attach tracks from the Hedra avatar agent
    const isHedra = participant.identity && participant.identity.startsWith('hedra-avatar');
    if (!isHedra) {
      console.log(`Ignoring track from non-avatar participant: ${participant.identity}`);
      return;
    }

    if (track.kind === Track.Kind.Video) {
      track.attach(els.avatarVideo);
      els.avatarVideo.style.display = 'block';
      console.log('Hedra avatar video attached');
    }

    if (track.kind === Track.Kind.Audio) {
      const audioEl = track.attach();
      audioEl.volume = 1.0;
      console.log('Hedra avatar audio attached');
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach();
    console.log(`Track unsubscribed: ${track.kind}`);
  });

  room.on(RoomEvent.Connected, () => {
    console.log('Connected to LiveKit room');
    state.isConnected = true;
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log('Disconnected from LiveKit room');
    state.isConnected = false;
    setTimeout(() => connectLiveKit(), 5000);
  });

  try {
    await room.connect(LK_URL, LK_TOKEN);
    console.log('LiveKit room connected');

    // Publish local microphone to the room (for the agent to hear meeting audio)
    // Disable all browser audio processing - Recall.ai's virtual audio device
    // handles echo cancellation internally. Processing here wastes CPU and
    // can introduce latency/artifacts in the constrained headless Chrome.
    const audioTrack = await LivekitClient.createLocalAudioTrack({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    await room.localParticipant.publishTrack(audioTrack);
    console.log('Local audio track published');
  } catch (err) {
    console.error('Failed to connect to LiveKit:', err);
  }
}

// ==================== Fallback Mode (No LiveKit) ====================

function startFallbackMode() {
  console.log('Starting in fallback mode (no LiveKit credentials)');
  if (els.fallbackContainer) els.fallbackContainer.style.display = 'block';
  updateFallbackStatus('connected', '接続済み (フォールバックモード)');
  showIndicator('listening');
}

// ==================== Init ====================

console.log('Bot page initializing...');
console.log('Hedra mode:', isHedraMode);

if (isHedraMode) {
  connectLiveKit();
} else {
  startFallbackMode();
}
