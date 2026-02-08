/**
 * AI Meeting Assistant - Bot Page
 * Connects to LiveKit room to display Hedra avatar and publish meeting audio
 */

// ==================== URL Params ====================

const urlParams = new URLSearchParams(window.location.search);
const LK_URL = urlParams.get('lk_url');
const LK_TOKEN = urlParams.get('lk_token');
const ROOM_NAME = urlParams.get('room');
const SESSION_TOKEN = urlParams.get('token');

// Determine mode based on LiveKit credentials
const isHedraMode = !!(LK_URL && LK_TOKEN);

// ==================== State ====================

const state = {
  room: null,
  isConnected: false,
  isSpeaking: false,
  localAudioTrack: null,
};

// ==================== Elements ====================

const els = {
  avatarVideo: document.getElementById('avatar-video'),
  avatarAudio: document.getElementById('avatar-audio'),
  hedraOverlay: document.getElementById('hedra-overlay'),
  hedraStatus: document.getElementById('hedra-status'),
  fallbackContainer: document.getElementById('fallback-container'),
  connectionStatus: document.getElementById('connection-status'),
  statusText: document.querySelector('#fallback-container .status-text'),
  listeningIndicator: document.getElementById('listening-indicator'),
  thinkingIndicator: document.getElementById('thinking-indicator'),
  speakingIndicator: document.getElementById('speaking-indicator'),
  transcriptList: document.getElementById('transcript-list'),
  aiResponse: document.getElementById('ai-response'),
};

// ==================== UI Helpers ====================

function updateHedraStatus(status, text) {
  if (!els.hedraStatus) return;
  els.hedraStatus.className = `status ${status}`;
  const statusText = els.hedraStatus.querySelector('.status-text');
  if (statusText) statusText.textContent = text;
}

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
  console.log('LiveKit URL:', LK_URL);

  // Show Hedra UI, hide fallback
  els.hedraOverlay.style.display = 'block';
  els.fallbackContainer.style.display = 'none';

  const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

  const room = new Room({
    adaptiveStream: false,  // Disable downscaling - we always want full quality avatar
    dynacast: false,        // Disable dynamic codec switching for stable video
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
    },
  });

  state.room = room;

  // Handle remote tracks - ONLY from Hedra avatar participant
  // Recall.ai captures the webpage's speaker output as the bot's microphone feed,
  // so we MUST play avatar audio here for it to reach meeting participants.
  // We filter by participant identity to avoid playing duplicate audio from
  // the agent's own ParticipantAudioOutput track (if any).
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
      // Use a dedicated audio element to ensure clean playback
      // Recall.ai captures this audio output as the bot's voice in the meeting
      const audioEl = track.attach();
      audioEl.volume = 1.0;
      console.log('Hedra avatar audio attached');
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach();
    console.log(`Track unsubscribed: ${track.kind}`);
  });

  // Monitor active speakers - mute mic while avatar speaks to prevent feedback
  // The mic feed comes from Recall.ai (meeting audio). If we keep it publishing
  // while the avatar audio plays through the speaker, the mic picks up the avatar's
  // voice and sends it back to the agent, causing a feedback loop.
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const avatarSpeaking = speakers.some(
      (s) => s.identity && s.identity.startsWith('hedra-avatar')
    );

    if (avatarSpeaking && !state.isSpeaking) {
      state.isSpeaking = true;
      updateHedraStatus('speaking', '話しています...');
      if (state.localAudioTrack) {
        state.localAudioTrack.mute();
      }
    } else if (!avatarSpeaking && state.isSpeaking) {
      state.isSpeaking = false;
      updateHedraStatus('connected', '聞いています...');
      // Short delay before unmuting to avoid capturing tail-end audio
      if (state.localAudioTrack) {
        setTimeout(() => {
          if (state.localAudioTrack && !state.isSpeaking) {
            state.localAudioTrack.unmute();
          }
        }, 800);
      }
    }
  });

  room.on(RoomEvent.Connected, () => {
    console.log('Connected to LiveKit room');
    state.isConnected = true;
    updateHedraStatus('connected', '接続済み');
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log('Disconnected from LiveKit room');
    state.isConnected = false;
    updateHedraStatus('error', '切断されました');
    // Attempt reconnect after delay
    setTimeout(() => connectLiveKit(), 5000);
  });

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    try {
      const text = new TextDecoder().decode(payload);
      const msg = JSON.parse(text);
      handleDataMessage(msg);
    } catch (e) {
      // Ignore non-JSON data
    }
  });

  try {
    await room.connect(LK_URL, LK_TOKEN);
    console.log('LiveKit room connected');

    // Publish local microphone to the room (for the agent to hear meeting audio)
    const audioTrack = await LivekitClient.createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    state.localAudioTrack = audioTrack;
    await room.localParticipant.publishTrack(audioTrack);
    console.log('Local audio track published');
  } catch (err) {
    console.error('Failed to connect to LiveKit:', err);
    updateHedraStatus('error', '接続エラー');
    // Fallback to SVG mode
    els.hedraOverlay.style.display = 'none';
    els.fallbackContainer.style.display = 'block';
    updateFallbackStatus('error', 'LiveKit接続エラー - フォールバックモード');
  }
}

function handleDataMessage(msg) {
  if (msg.type === 'transcript') {
    addTranscript(msg.speaker === 'user' ? '参加者' : 'AI', msg.text);
  } else if (msg.type === 'response') {
    if (els.aiResponse) els.aiResponse.textContent = msg.text;
  }
}

// ==================== Fallback Mode (No LiveKit) ====================

function startFallbackMode() {
  console.log('Starting in fallback mode (no LiveKit credentials)');
  els.hedraOverlay.style.display = 'none';
  els.fallbackContainer.style.display = 'block';
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
