/**
 * AI Meeting Assistant - Bot Page
 * Captures meeting audio and plays TTS responses
 * Supports HeyGen Streaming Avatar (LiveKit) with SVG fallback
 */

const CONFIG = {
  sampleRate: 16000,
  sendIntervalMs: 500,
};

// Parse URL parameters for HeyGen LiveKit credentials
const urlParams = new URLSearchParams(window.location.search);
const LK_URL = urlParams.get('lk_url');
const LK_TOKEN = urlParams.get('lk_token');
const SESSION_TOKEN = urlParams.get('token');
const USE_HEYGEN = !!(LK_URL && LK_TOKEN);

const state = {
  ws: null,
  audioContext: null,
  playbackContext: null,
  isConnected: false,
  isSpeaking: false,
  audioQueue: [],
  isPlaying: false,
  audioStreamDone: false,
  livekitRoom: null,
  heygenGraceTimer: null,
};

const elements = {
  // Fallback overlay elements
  connectionStatus: document.getElementById('connection-status'),
  statusText: document.querySelector('#overlay .status-text'),
  listeningIndicator: document.getElementById('listening-indicator'),
  thinkingIndicator: document.getElementById('thinking-indicator'),
  speakingIndicator: document.getElementById('speaking-indicator'),
  transcriptList: document.getElementById('transcript-list'),
  aiResponse: document.getElementById('ai-response'),
  avatarVideo: document.getElementById('avatar-video'),
  fallbackContainer: document.getElementById('fallback-container'),
  overlay: document.getElementById('overlay'),
  // HeyGen overlay elements
  heygenOverlay: document.getElementById('heygen-overlay'),
  heygenBadge: document.getElementById('heygen-status-badge'),
  heygenBadgeText: document.querySelector('.heygen-badge-text'),
};

// ==================== UI ====================

const STATUS_LABELS = {
  connecting: '接続中...',
  connected: '接続済み',
  listening: '聞いています...',
  thinking: '考えています...',
  speaking: '会話中...',
  error: '接続エラー',
};

function updateStatus(status, text) {
  if (USE_HEYGEN) {
    // HeyGen mode: update the top-right badge only
    elements.heygenBadge.className = `heygen-badge ${status}`;
    elements.heygenBadgeText.textContent = text || STATUS_LABELS[status] || status;
  } else {
    // Fallback mode: update the full overlay
    elements.connectionStatus.className = `status ${status}`;
    elements.statusText.textContent = text || STATUS_LABELS[status] || status;
  }
}

function showIndicator(name) {
  if (USE_HEYGEN) {
    // HeyGen mode: update badge text/state instead of showing indicator panels
    updateStatus(name, STATUS_LABELS[name]);
  } else {
    // Fallback mode: toggle indicator panels
    ['listening', 'thinking', 'speaking'].forEach((n) => {
      elements[`${n}Indicator`].classList.toggle('hidden', n !== name);
    });
  }
}

function addTranscript(speaker, text) {
  // In HeyGen mode, skip transcript UI (it's hidden)
  if (USE_HEYGEN) return;

  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.innerHTML = `<span class="transcript-speaker">${speaker}:</span><span class="transcript-text">${text}</span>`;
  elements.transcriptList.appendChild(item);
  while (elements.transcriptList.children.length > 10) {
    elements.transcriptList.removeChild(elements.transcriptList.firstChild);
  }
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
}

// ==================== HeyGen Avatar (LiveKit) ====================

async function initHeyGenAvatar() {
  if (!USE_HEYGEN) return false;

  console.log('Initializing HeyGen avatar via LiveKit...');
  console.log('LiveKit URL:', LK_URL);

  try {
    const { Room, RoomEvent } = LivekitClient;
    const room = new Room();
    state.livekitRoom = room;

    // Handle tracks from the HeyGen avatar
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`Track subscribed: ${track.kind} from ${participant.identity}`);

      if (track.kind === 'video') {
        track.attach(elements.avatarVideo);
        elements.avatarVideo.classList.add('active');
        elements.fallbackContainer.classList.add('hidden');
        console.log('Avatar video attached');
      } else if (track.kind === 'audio') {
        // Attach audio to a separate element so it plays through speakers
        const audioEl = track.attach();
        document.body.appendChild(audioEl);
        console.log('Avatar audio attached');
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      console.log(`Track unsubscribed: ${track.kind}`);
      track.detach();
    });

    // Detect when the avatar actually stops speaking via ActiveSpeakersChanged.
    // This fires with the list of currently speaking participants and is the
    // most reliable way to know when audio output has truly ended.
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const avatarSpeaking = speakers.some(
        (p) => p.identity !== room.localParticipant.identity
      );
      if (avatarSpeaking) {
        state.isSpeaking = true;
        showIndicator('speaking');
        // Clear any pending grace timer – avatar is still talking
        if (state.heygenGraceTimer) {
          clearTimeout(state.heygenGraceTimer);
          state.heygenGraceTimer = null;
        }
      } else if (state.isSpeaking) {
        // Avatar stopped speaking – add short grace period for silence gap
        // between sentences, then resume mic
        if (!state.heygenGraceTimer) {
          state.heygenGraceTimer = setTimeout(() => {
            state.heygenGraceTimer = null;
            state.isSpeaking = false;
            showIndicator('listening');
            console.log('Avatar stopped speaking, resuming mic');
          }, 2000);
        }
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      console.warn('LiveKit disconnected');
    });

    await room.connect(LK_URL, LK_TOKEN);
    console.log('LiveKit room connected:', room.name);
    return true;
  } catch (error) {
    console.error('HeyGen avatar init failed:', error);
    return false;
  }
}

function activateHeyGenMode() {
  // Show HeyGen badge, hide full overlay
  elements.heygenOverlay.classList.remove('hidden');
  elements.overlay.classList.add('hidden');
}

function fallbackToSvg() {
  elements.avatarVideo.classList.remove('active');
  elements.fallbackContainer.classList.remove('hidden');
  // Show full overlay, hide HeyGen badge
  elements.overlay.classList.remove('hidden');
  elements.heygenOverlay.classList.add('hidden');
  console.log('Using SVG fallback avatar');
}

// ==================== WebSocket ====================

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/audio`;
  console.log('Connecting to:', url);

  state.ws = new WebSocket(url);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
    state.isConnected = true;
    updateStatus('connected', '接続済み');
    showIndicator('listening');

    // Send init message with session token so server can link HeyGen session
    if (SESSION_TOKEN) {
      state.ws.send(JSON.stringify({ type: 'init', sessionToken: SESSION_TOKEN }));
    }

    startAudioCapture();
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  state.ws.onerror = (e) => {
    console.error('WebSocket error:', e);
    updateStatus('error', '接続エラー');
  };

  state.ws.onclose = () => {
    state.isConnected = false;
    updateStatus('connecting', '再接続中...');
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg) {
  console.log('Message:', msg.type);

  if (msg.type === 'transcript') {
    addTranscript(msg.speaker === 'user' ? '参加者' : 'AI', msg.text);
    if (msg.speaker === 'user') {
      showIndicator('thinking');
      if (USE_HEYGEN) {
        // Suppress mic while AI is processing + speaking
        state.isSpeaking = true;
      }
    }
  } else if (msg.type === 'response') {
    if (!USE_HEYGEN) {
      elements.aiResponse.textContent = msg.text;
    }
    addTranscript('AI', msg.text);
    if (USE_HEYGEN) {
      state.isSpeaking = true;
      showIndicator('speaking');
    }
  } else if (msg.type === 'response_append') {
    if (!USE_HEYGEN) {
      elements.aiResponse.textContent += msg.text;
    }
  } else if (msg.type === 'audio') {
    // In HeyGen mode, audio comes via LiveKit - ignore WebSocket audio
    if (USE_HEYGEN) return;

    // Fallback: Receive TTS audio chunk - start playing immediately
    state.isSpeaking = true;
    showIndicator('speaking');
    const audioData = base64ToBuffer(msg.data);
    state.audioQueue.push(audioData);
    // Start playback as soon as first chunk arrives
    if (!state.isPlaying) {
      playNextAudio();
    }
  } else if (msg.type === 'audio_done') {
    console.log('Audio stream complete');
    if (USE_HEYGEN) {
      // Server finished sending all tasks to HeyGen.
      // The ActiveSpeakersChanged event will handle mic re-enable when
      // avatar truly stops speaking. This is a safety fallback in case
      // that event doesn't fire.
      if (state.heygenGraceTimer) {
        clearTimeout(state.heygenGraceTimer);
      }
      state.heygenGraceTimer = setTimeout(() => {
        state.heygenGraceTimer = null;
        if (state.isSpeaking) {
          state.isSpeaking = false;
          showIndicator('listening');
          console.log('HeyGen fallback timer: resuming mic');
        }
      }, 15000);
      return;
    }
    state.audioStreamDone = true;
  } else if (msg.type === 'error') {
    console.error('Server error:', msg.message);
    state.isSpeaking = false;
    showIndicator('listening');
  }
}

// ==================== Audio Capture ====================

async function startAudioCapture() {
  try {
    console.log('Starting audio capture...');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: CONFIG.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    console.log('Got audio stream');

    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CONFIG.sampleRate,
    });

    const source = state.audioContext.createMediaStreamSource(stream);
    const processor = state.audioContext.createScriptProcessor(4096, 1, 1);

    let audioBuffer = [];

    processor.onaudioprocess = (e) => {
      if (!state.isConnected || state.isSpeaking) return;

      const data = e.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16(data);
      audioBuffer.push(...pcm16);
    };

    source.connect(processor);
    processor.connect(state.audioContext.destination);

    setInterval(() => {
      if (audioBuffer.length > 0 && state.isConnected && !state.isSpeaking) {
        const data = new Int16Array(audioBuffer);
        audioBuffer = [];
        const base64 = bufferToBase64(data.buffer);
        state.ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      }
    }, CONFIG.sendIntervalMs);

    console.log('Audio capture started');

  } catch (error) {
    console.error('Audio capture failed:', error);
    updateStatus('error', 'マイクエラー');
  }
}

// ==================== Audio Playback (Fallback only) ====================

async function playNextAudio() {
  if (state.audioQueue.length === 0) {
    // If audio_done received and queue empty, we're done speaking
    if (state.audioStreamDone) {
      state.isPlaying = false;
      state.isSpeaking = false;
      state.audioStreamDone = false;
      showIndicator('listening');
    } else {
      // More audio chunks may still be coming, wait
      state.isPlaying = false;
    }
    return;
  }

  state.isPlaying = true;

  try {
    if (!state.playbackContext) {
      state.playbackContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: CONFIG.sampleRate,
      });
    }

    // Play one chunk at a time (each chunk = one sentence)
    const audioData = state.audioQueue.shift();
    const int16 = new Int16Array(audioData);

    // Convert Int16 PCM to Float32
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = state.playbackContext.createBuffer(1, float32.length, CONFIG.sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = state.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.playbackContext.destination);

    source.onended = () => {
      console.log('Sentence playback finished');
      playNextAudio();
    };

    console.log(`Playing sentence: ${float32.length} samples`);
    source.start();

  } catch (error) {
    console.error('Playback error:', error);
    state.isPlaying = false;
    state.isSpeaking = false;
    showIndicator('listening');
  }
}

// ==================== Utilities ====================

function float32ToPcm16(float32) {
  const pcm16 = [];
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16.push(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return pcm16;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ==================== Init ====================

console.log('Initializing...');
console.log('HeyGen mode:', USE_HEYGEN);

(async () => {
  if (USE_HEYGEN) {
    updateStatus('connecting', '接続中...');
    const success = await initHeyGenAvatar();
    if (success) {
      activateHeyGenMode();
    } else {
      fallbackToSvg();
    }
  } else {
    fallbackToSvg();
    updateStatus('connecting', '接続中...');
  }

  connect();
})();
