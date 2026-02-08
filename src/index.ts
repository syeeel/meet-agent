import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';
import app from './server';
import { isHeyGenEnabled, destroyAllSessions } from './services/heygen';

const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Initialize Gemini client
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Google Cloud STT V2 with service account (Chirp 2)
const sttAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const STT_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
const STT_LOCATION = 'asia-northeast1';

// Cache access token to avoid re-fetching on every STT call (~100-200ms savings)
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) {
    return cachedAccessToken;
  }
  const client = await sttAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  cachedAccessToken = tokenResponse.token || '';
  // Refresh 60 seconds before expiry (tokens typically last 3600s)
  tokenExpiresAt = now + 3500 * 1000;
  console.log('Access token refreshed');
  return cachedAccessToken;
}

async function transcribeSpeech(audioBuffer: Buffer): Promise<string> {
  const accessToken = await getAccessToken();

  // Wrap raw PCM in WAV header so autoDecodingConfig can detect the format
  const wavBuffer = pcm16ToWav(audioBuffer, 16000);
  const base64Audio = wavBuffer.toString('base64');

  const response = await fetch(
    `https://${STT_LOCATION}-speech.googleapis.com/v2/projects/${STT_PROJECT_ID}/locations/${STT_LOCATION}/recognizers/_:recognize`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        config: {
          autoDecodingConfig: {},
          languageCodes: ['ja-JP'],
          model: 'chirp_2',
        },
        content: base64Audio,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google STT error: ${error}`);
  }

  const data = await response.json() as {
    results?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };

  const transcript = data.results
    ?.map(r => r.alternatives?.[0]?.transcript || '')
    .join('') || '';

  console.log('STT response:', JSON.stringify(data).slice(0, 300));
  return transcript.trim();
}

// Google Cloud TTS with API key
async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_CLOUD_API_KEY not set');
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'ja-JP',
          name: 'ja-JP-Chirp3-HD-Aoede',
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 16000,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google TTS error: ${error}`);
  }

  const data = await response.json() as { audioContent: string };
  return Buffer.from(data.audioContent, 'base64');
}

// WebSocket server for audio processing
const wss = new WebSocketServer({ server, path: '/ws/audio' });

wss.on('connection', (clientWs) => {
  console.log('Client connected');

  let conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  let audioChunks: Buffer[] = [];
  let isProcessing = false;
  let processTimeout: NodeJS.Timeout | null = null;

  const processAudio = async () => {
    if (audioChunks.length === 0 || isProcessing) return;

    isProcessing = true;
    const audioBuffer = Buffer.concat(audioChunks);
    audioChunks = [];

    if (audioBuffer.length < 16000) {
      console.log('Audio too short, skipping');
      isProcessing = false;
      return;
    }

    console.log(`Processing audio: ${audioBuffer.length} bytes`);

    try {
      // Transcribe with Google Cloud STT
      console.log('Sending to Google STT...');
      const userText = await transcribeSpeech(audioBuffer);

      if (!userText) {
        console.log('No speech detected');
        isProcessing = false;
        return;
      }

      console.log('User said:', userText);
      clientWs.send(JSON.stringify({ type: 'transcript', speaker: 'user', text: userText }));

      // Generate response with Gemini 2.5 Flash Lite (streaming)
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: {
          role: 'user',
          parts: [{ text: `あなたは伊勢 誠（いせ まこと）という人物として会話してください。

【プロフィール】
- 45歳男性、千葉県船橋市在住
- 妻（42歳・看護師）、長女（高校1年）、長男（中学1年）の4人家族
- IT企業で20年の経験を持つビジネスコンサルタント。DX推進・業務改善が専門
- 早稲田大学商学部卒業後、大手SIerを経て独立

【性格・話し方】
- 落ち着いた口調で、相手の話をよく聞いてから答える
- 丁寧語を基本としつつ、親しみやすさも忘れない
- 難しいことを分かりやすく例え話で説明するのが得意

【趣味・関心】
- 週末はロードバイクで房総半島を走るのが楽しみ
- コーヒーにこだわりがあり、自家焙煎している
- 読書好き。司馬遼太郎のファン
- 最近は長男と一緒にプログラミング（Python）を学んでいる

【会話のルール】
- 回答は短く、20秒以内で話せる長さにすること
- 箇条書きや記号は使わず、自然な話し言葉で答えること
- 分からないことは正直に答えること` }],
        },
      });

      // Ensure history starts with 'user' role
      let history = conversationHistory.slice(-10);
      while (history.length > 0 && history[0].role !== 'user') {
        history = history.slice(1);
      }

      const chat = model.startChat({ history });

      // Stream Gemini response and send TTS sentence-by-sentence
      const streamResult = await chat.sendMessageStream(userText);
      let sentenceBuffer = '';
      let fullResponse = '';
      let sentenceIndex = 0;

      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (!text) continue;
        sentenceBuffer += text;
        fullResponse += text;

        // Detect sentence boundaries (Japanese punctuation)
        const sentenceMatch = sentenceBuffer.match(/^(.*?[。！？\n])(.*)/s);
        if (sentenceMatch) {
          const sentence = sentenceMatch[1].trim();
          sentenceBuffer = sentenceMatch[2];

          if (sentence) {
            sentenceIndex++;
            console.log(`Sentence ${sentenceIndex}: "${sentence}"`);

            // Send text immediately so client can display it
            if (sentenceIndex === 1) {
              clientWs.send(JSON.stringify({ type: 'response', text: sentence }));
            } else {
              clientWs.send(JSON.stringify({ type: 'response_append', text: sentence }));
            }

            const audioContent = await synthesizeSpeech(sentence);
            const pcmData = audioContent.slice(44);
            const base64 = pcmData.toString('base64');
            clientWs.send(JSON.stringify({ type: 'audio', data: base64 }));
          }
        }
      }

      // Handle any remaining text after stream ends
      if (sentenceBuffer.trim()) {
        const sentence = sentenceBuffer.trim();
        sentenceIndex++;
        console.log(`Sentence ${sentenceIndex} (final): "${sentence}"`);

        if (sentenceIndex === 1) {
          clientWs.send(JSON.stringify({ type: 'response', text: sentence }));
        } else {
          clientWs.send(JSON.stringify({ type: 'response_append', text: sentence }));
        }

        const audioContent = await synthesizeSpeech(sentence);
        const pcmData = audioContent.slice(44);
        const base64 = pcmData.toString('base64');
        clientWs.send(JSON.stringify({ type: 'audio', data: base64 }));
      }

      const aiText = fullResponse || 'すみません、応答できませんでした。';
      console.log('AI full response:', aiText);

      conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
      conversationHistory.push({ role: 'model', parts: [{ text: aiText }] });
      clientWs.send(JSON.stringify({ type: 'audio_done' }));

      // Discard audio buffered during processing/playback (echo/self-hearing)
      audioChunks = [];
      packetCount = 0;
      if (processTimeout) {
        clearTimeout(processTimeout);
        processTimeout = null;
      }

    } catch (error: any) {
      console.error('Error:', error.message || error);
      clientWs.send(JSON.stringify({ type: 'error', message: 'Processing failed' }));
    }

    isProcessing = false;
  };

  let packetCount = 0;
  clientWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'audio') {
        const audioData = Buffer.from(message.data, 'base64');
        audioChunks.push(audioData);
        packetCount++;

        if (packetCount % 20 === 0) {
          const totalBytes = audioChunks.reduce((sum, c) => sum + c.length, 0);
          console.log(`Packets: ${packetCount}, Bytes: ${totalBytes}`);
        }

        if (processTimeout) clearTimeout(processTimeout);

        const totalBytes = audioChunks.reduce((sum, c) => sum + c.length, 0);
        if (totalBytes > 320000) {
          processAudio();
        } else {
          processTimeout = setTimeout(processAudio, 2000);
        }
      }
    } catch (error) {
      console.error('Message error:', error);
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (processTimeout) clearTimeout(processTimeout);
  });
});

function pcm16ToWav(pcmData: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, 44);

  return buffer;
}

server.listen(PORT, () => {
  const useHeyGen = isHeyGenEnabled();

  if (useHeyGen) {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           Meet Agent - AI Meeting Assistant                ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${String(PORT).padEnd(5)}                          ║
║  Mode:   HeyGen Interactive Avatar                        ║
║  STT:    HeyGen (Deepgram)                                ║
║  LLM:    GPT-4o mini (via HeyGen)                         ║
║  TTS:    HeyGen Avatar (lip-sync)                         ║
║  Fallback WebSocket pipeline available for non-HeyGen     ║
╚════════════════════════════════════════════════════════════╝
    `);
  } else {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           Meet Agent - AI Meeting Assistant                ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${String(PORT).padEnd(5)}                          ║
║  Mode:   Fallback (SVG + Google TTS)                      ║
║  STT:    Google STT (Chirp 2)                             ║
║  LLM:    Gemini 2.5 Flash Lite                            ║
║  TTS:    Google TTS                                       ║
╚════════════════════════════════════════════════════════════╝
    `);
  }

  const required: string[] = ['RECALL_API_KEY', 'BASE_URL'];
  if (!useHeyGen) {
    required.push('GEMINI_API_KEY', 'GOOGLE_CLOUD_API_KEY');
  }
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.warn(`⚠️  Missing: ${missing.join(', ')}`);
  }
});

// Graceful shutdown: clean up HeyGen sessions so they don't linger
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received – cleaning up...`);
  destroyAllSessions().finally(() => {
    process.exit(0);
  });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
