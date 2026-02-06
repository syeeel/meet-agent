import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { AssemblyAI } from 'assemblyai';
import app from './server';

const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assemblyai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY || '' });

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
          name: 'ja-JP-Neural2-B',
          ssmlGender: 'FEMALE',
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 24000,
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

  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let audioChunks: Buffer[] = [];
  let isProcessing = false;
  let processTimeout: NodeJS.Timeout | null = null;

  const processAudio = async () => {
    if (audioChunks.length === 0 || isProcessing) return;

    isProcessing = true;
    const audioBuffer = Buffer.concat(audioChunks);
    audioChunks = [];

    if (audioBuffer.length < 24000) {
      console.log('Audio too short, skipping');
      isProcessing = false;
      return;
    }

    console.log(`Processing audio: ${audioBuffer.length} bytes`);

    try {
      // Convert PCM16 to WAV
      const wavBuffer = pcm16ToWav(audioBuffer, 24000);

      // Transcribe with AssemblyAI
      console.log('Sending to AssemblyAI...');
      const transcript = await assemblyai.transcripts.transcribe({
        audio: wavBuffer,
        language_code: 'ja',
      });

      const userText = transcript.text?.trim();
      if (!userText) {
        console.log('No speech detected');
        isProcessing = false;
        return;
      }

      console.log('User said:', userText);
      clientWs.send(JSON.stringify({ type: 'transcript', speaker: 'user', text: userText }));

      // Generate response with GPT-4
      conversationHistory.push({ role: 'user', content: userText });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `あなたは会議に参加しているAIアシスタントです。
参加者からの質問に簡潔かつ的確に日本語で回答してください。
回答は短く、20秒以内で話せる長さにしてください。`,
          },
          ...conversationHistory.slice(-10),
        ],
        max_tokens: 200,
      });

      const aiText = completion.choices[0]?.message?.content || 'すみません、応答できませんでした。';
      console.log('AI response:', aiText);

      conversationHistory.push({ role: 'assistant', content: aiText });
      clientWs.send(JSON.stringify({ type: 'response', text: aiText }));

      // Generate speech with Google Cloud TTS
      console.log('Generating speech with Google TTS...');
      const audioContent = await synthesizeSpeech(aiText);
      console.log(`TTS audio generated: ${audioContent.length} bytes`);

      // Send audio in chunks (skip WAV header - first 44 bytes)
      const pcmData = audioContent.slice(44);
      const chunkSize = 4800; // 100ms at 24kHz

      for (let i = 0; i < pcmData.length; i += chunkSize) {
        const chunk = pcmData.slice(i, i + chunkSize);
        const base64 = chunk.toString('base64');
        clientWs.send(JSON.stringify({ type: 'audio', data: base64 }));
      }

      clientWs.send(JSON.stringify({ type: 'audio_done' }));

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
        if (totalBytes > 240000) {
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
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Meet Agent - AI Meeting Assistant                ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                               ║
║  Using: AssemblyAI + GPT-4 + Google Cloud TTS              ║
╚════════════════════════════════════════════════════════════╝
  `);

  const required = ['RECALL_API_KEY', 'OPENAI_API_KEY', 'ASSEMBLYAI_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'BASE_URL'];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.warn(`⚠️  Missing: ${missing.join(', ')}`);
  }
});
