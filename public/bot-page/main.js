/**
 * AI Meeting Assistant - Bot Page
 * Captures meeting audio and plays TTS responses
 */

const CONFIG = {
  sampleRate: 16000,
  sendIntervalMs: 500,
};

const state = {
  ws: null,
  audioContext: null,
  playbackContext: null,
  isConnected: false,
  isSpeaking: false,
  audioQueue: [],
  isPlaying: false,
};

const elements = {
  connectionStatus: document.getElementById('connection-status'),
  statusText: document.querySelector('.status-text'),
  listeningIndicator: document.getElementById('listening-indicator'),
  thinkingIndicator: document.getElementById('thinking-indicator'),
  speakingIndicator: document.getElementById('speaking-indicator'),
  transcriptList: document.getElementById('transcript-list'),
  aiResponse: document.getElementById('ai-response'),
};

// ==================== UI ====================

function updateStatus(status, text) {
  elements.connectionStatus.className = `status ${status}`;
  elements.statusText.textContent = text;
}

function showIndicator(name) {
  ['listening', 'thinking', 'speaking'].forEach((n) => {
    elements[`${n}Indicator`].classList.toggle('hidden', n !== name);
  });
}

function addTranscript(speaker, text) {
  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.innerHTML = `<span class="transcript-speaker">${speaker}:</span><span class="transcript-text">${text}</span>`;
  elements.transcriptList.appendChild(item);
  while (elements.transcriptList.children.length > 10) {
    elements.transcriptList.removeChild(elements.transcriptList.firstChild);
  }
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
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
    }
  } else if (msg.type === 'response') {
    elements.aiResponse.textContent = msg.text;
    addTranscript('AI', msg.text);
  } else if (msg.type === 'audio') {
    // Receive TTS audio chunk - buffer until all chunks arrive
    state.isSpeaking = true;
    showIndicator('speaking');
    const audioData = base64ToBuffer(msg.data);
    state.audioQueue.push(audioData);
  } else if (msg.type === 'audio_done') {
    console.log('Audio stream complete');
    // Play all buffered audio at once
    if (!state.isPlaying) {
      playNextAudio();
    }
  } else if (msg.type === 'error') {
    console.error('Server error:', msg.message);
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

// ==================== Audio Playback ====================

async function playNextAudio() {
  if (state.audioQueue.length === 0) {
    state.isPlaying = false;
    state.isSpeaking = false;
    showIndicator('listening');
    return;
  }

  state.isPlaying = true;

  try {
    if (!state.playbackContext) {
      state.playbackContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: CONFIG.sampleRate,
      });
    }

    // Combine all queued PCM audio
    const allAudio = state.audioQueue.splice(0, state.audioQueue.length);
    let totalLength = 0;
    allAudio.forEach((a) => (totalLength += a.byteLength));

    const combined = new Int16Array(totalLength / 2);
    let offset = 0;
    allAudio.forEach((a) => {
      const arr = new Int16Array(a);
      combined.set(arr, offset);
      offset += arr.length;
    });

    // Convert Int16 PCM to Float32
    const float32 = new Float32Array(combined.length);
    for (let i = 0; i < combined.length; i++) {
      float32[i] = combined[i] / 32768;
    }

    const buffer = state.playbackContext.createBuffer(1, float32.length, CONFIG.sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = state.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.playbackContext.destination);

    source.onended = () => {
      console.log('Audio playback finished');
      // Check if more audio arrived
      if (state.audioQueue.length > 0) {
        playNextAudio();
      } else {
        state.isPlaying = false;
        state.isSpeaking = false;
        showIndicator('listening');
      }
    };

    console.log(`Playing audio: ${float32.length} samples`);
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
updateStatus('connecting', '接続中...');
connect();
