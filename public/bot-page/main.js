/**
 * AI Meeting Assistant - Bot Page
 * Supports HeyGen Interactive Avatar (SDK voice chat) with SVG fallback
 *
 * HeyGen mode: SDK handles session, STT, LLM, TTS, and avatar rendering
 * Fallback mode: mic audio sent to server via WebSocket -> server handles STT/LLM/TTS
 */

const CONFIG = {
  sampleRate: 16000,
  sendIntervalMs: 500,
};

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search);
const SESSION_TOKEN = urlParams.get('token');
const HEYGEN_TOKEN = urlParams.get('heygen_token');
const USE_HEYGEN = !!(HEYGEN_TOKEN && window.HeyGenSDK);

const state = {
  ws: null,
  audioContext: null,
  playbackContext: null,
  isConnected: false,
  isSpeaking: false,
  audioQueue: [],
  isPlaying: false,
  audioStreamDone: false,
  avatar: null,
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
    elements.heygenBadge.className = `heygen-badge ${status}`;
    elements.heygenBadgeText.textContent = text || STATUS_LABELS[status] || status;
  } else {
    elements.connectionStatus.className = `status ${status}`;
    elements.statusText.textContent = text || STATUS_LABELS[status] || status;
  }
}

function showIndicator(name) {
  if (USE_HEYGEN) {
    updateStatus(name, STATUS_LABELS[name]);
  } else {
    ['listening', 'thinking', 'speaking'].forEach((n) => {
      elements[`${n}Indicator`].classList.toggle('hidden', n !== name);
    });
  }
}

function addTranscript(speaker, text) {
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

// ==================== HeyGen Interactive Avatar (SDK) ====================

async function initHeyGenInteractiveAvatar() {
  if (!USE_HEYGEN) return false;

  const { StreamingAvatar, StreamingEvents, AvatarQuality } = window.HeyGenSDK;

  console.log('Initializing HeyGen Interactive Avatar via SDK...');

  try {
    const avatar = new StreamingAvatar({ token: HEYGEN_TOKEN });
    state.avatar = avatar;

    // Register event listeners
    avatar.on(StreamingEvents.STREAM_READY, (event) => {
      console.log('Stream ready:', event);
      if (avatar.mediaStream) {
        elements.avatarVideo.srcObject = avatar.mediaStream;
        elements.avatarVideo.classList.add('active');
        elements.fallbackContainer.classList.add('hidden');
      }
      updateStatus('listening', '聞いています...');
      showIndicator('listening');
    });

    avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
      console.warn('Stream disconnected');
      updateStatus('error', '切断されました');
    });

    avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
      console.log('Avatar started talking');
      showIndicator('speaking');
    });

    avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
      console.log('Avatar stopped talking');
      showIndicator('listening');
    });

    avatar.on(StreamingEvents.USER_START, (event) => {
      console.log('User started talking', JSON.stringify(event));
      showIndicator('listening');
    });

    avatar.on(StreamingEvents.USER_STOP, (event) => {
      console.log('User stopped talking', JSON.stringify(event));
      showIndicator('thinking');
    });

    avatar.on(StreamingEvents.USER_SILENCE, (event) => {
      console.log('User silence', JSON.stringify(event));
    });

    avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
      console.log('User message:', event.message, JSON.stringify(event));
    });

    avatar.on(StreamingEvents.USER_END_MESSAGE, (event) => {
      console.log('User final message:', event.message, JSON.stringify(event));
    });

    avatar.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (event) => {
      console.log('Avatar message:', event.message, JSON.stringify(event));
    });

    avatar.on(StreamingEvents.AVATAR_END_MESSAGE, (event) => {
      console.log('Avatar final message:', event.message, JSON.stringify(event));
    });

    // Create and start avatar session
    const avatarName = new URLSearchParams(window.location.search).get('avatar') || 'Wayne_20240711';

    console.log('Creating avatar session...');
    const sessionInfo = await avatar.createStartAvatar({
      quality: AvatarQuality.High,
      avatarName: avatarName,
      knowledgeBase: `あなたは伊勢 誠（いせ まこと）という人物として会話してください。

【プロフィール】
- 45歳男性、千葉県船橋市在住
- 妻（42歳・看護師）、長女（高校1年）、長男（中学1年）の4人家族
- IT企業で20年の経験を持つビジネスコンサルタント。DX推進・業務改善が専門
- 早稲田大学商学部卒業後、大手SIerを経て独立

【性格・話し方】
- 落ち着いた口調で、相手の話をよく聞いてから答える
- 丁寧語を基本としつつ、親しみやすさも忘れない
- 難しいことを分かりやすく例え話で説明するのが得意
- 「なるほど」「いい質問ですね」など相槌を自然に入れる

【趣味・関心】
- 週末はロードバイクで房総半島を走るのが楽しみ
- コーヒーにこだわりがあり、自家焙煎している
- 読書好き。ビジネス書だけでなく歴史小説も好む（司馬遼太郎のファン）
- 最近は長男と一緒にプログラミング（Python）を学んでいる

【会話のルール】
- 回答は短く、20秒以内で話せる長さにすること
- 箇条書きや記号は使わず、自然な話し言葉で答えること
- 分からないことは正直に「すみません、それはちょっと分からないですね」と答えること
- プライベートの話題を振られたら、上記のペルソナに沿って自然に答えること`,
      language: 'ja',
    });

    console.log('Avatar session created:', sessionInfo.session_id);

    // Start voice chat - SDK handles mic capture, STT, LLM, and TTS internally
    console.log('Starting voice chat...');
    await avatar.startVoiceChat({ isInputAudioMuted: false });
    console.log('Voice chat started');

    return true;
  } catch (error) {
    console.error('HeyGen Interactive Avatar init failed:', error);
    return false;
  }
}

function activateHeyGenMode() {
  elements.heygenOverlay.classList.remove('hidden');
  elements.overlay.classList.add('hidden');
}

function fallbackToSvg() {
  elements.avatarVideo.classList.remove('active');
  elements.fallbackContainer.classList.remove('hidden');
  elements.overlay.classList.remove('hidden');
  elements.heygenOverlay.classList.add('hidden');
  console.log('Using SVG fallback avatar');
}

// ==================== Fallback: Server WebSocket ====================

function connectToServer() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/audio`;
  console.log('Connecting to server:', url);

  state.ws = new WebSocket(url);

  state.ws.onopen = () => {
    console.log('Server WebSocket connected');
    state.isConnected = true;
    updateStatus('connected', '接続済み');
    showIndicator('listening');
    startAudioCapture();
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  state.ws.onerror = (e) => {
    console.error('Server WebSocket error:', e);
    updateStatus('error', '接続エラー');
  };

  state.ws.onclose = () => {
    state.isConnected = false;
    updateStatus('connecting', '再接続中...');
    setTimeout(connectToServer, 3000);
  };
}

function handleServerMessage(msg) {
  console.log('Message:', msg.type);

  if (msg.type === 'transcript') {
    addTranscript(msg.speaker === 'user' ? '参加者' : 'AI', msg.text);
    if (msg.speaker === 'user') {
      showIndicator('thinking');
    }
  } else if (msg.type === 'response') {
    elements.aiResponse.textContent = msg.text;
    addTranscript('AI', msg.text);
  } else if (msg.type === 'response_append') {
    elements.aiResponse.textContent += msg.text;
  } else if (msg.type === 'audio') {
    state.isSpeaking = true;
    showIndicator('speaking');
    const audioData = base64ToBuffer(msg.data);
    state.audioQueue.push(audioData);
    if (!state.isPlaying) {
      playNextAudio();
    }
  } else if (msg.type === 'audio_done') {
    console.log('Audio stream complete');
    state.audioStreamDone = true;
  } else if (msg.type === 'error') {
    console.error('Server error:', msg.message);
    state.isSpeaking = false;
    showIndicator('listening');
  }
}

// ==================== Audio Capture (Fallback only) ====================

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
    if (state.audioStreamDone) {
      state.isPlaying = false;
      state.isSpeaking = false;
      state.audioStreamDone = false;
      showIndicator('listening');
    } else {
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

    const audioData = state.audioQueue.shift();
    const int16 = new Int16Array(audioData);

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
    activateHeyGenMode();
    const success = await initHeyGenInteractiveAvatar();
    if (success) {
      // HeyGen SDK handles everything - no server WebSocket needed
      console.log('HeyGen Interactive Avatar ready');
    } else {
      // HeyGen init failed, fall back to SVG + server pipeline
      fallbackToSvg();
      connectToServer();
    }
  } else {
    // No HeyGen: use SVG fallback + server audio pipeline
    fallbackToSvg();
    updateStatus('connecting', '接続中...');
    connectToServer();
  }
})();
