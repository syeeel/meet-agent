import { defineAgent, type JobContext } from '@livekit/agents';
import { voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { AvatarSession } from '@livekit/agents-plugin-hedra';
import * as silero from '@livekit/agents-plugin-silero';

const SYSTEM_INSTRUCTIONS = `あなたは会議に参加しているAIアシスタントです。

## 役割
- 参加者からの質問に簡潔かつ的確に回答してください
- 会議の流れを妨げないよう、回答は短く要点をまとめてください
- 専門用語は必要に応じて分かりやすく説明してください

## 制約
- 回答は音声で読み上げられるため、自然な日本語で話すように回答してください
- 箇条書きや記号は使わず、話し言葉で回答してください
- 長すぎる回答は避け、30秒以内で読み上げられる長さを目安にしてください
- 分からないことは正直に「分かりません」と答えてください`;

// Use module.exports directly so that ESM dynamic import() in LiveKit's
// child process sees the agent as the default export (not nested under .default)
module.exports = defineAgent({
  prewarm: async () => {
    // Pre-load VAD model for faster startup
    await silero.VAD.load();
    console.log('Silero VAD model pre-loaded');
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log(`Agent connected to room: ${ctx.room.name}`);

    const vad = await silero.VAD.load();

    const realtimeModel = new google.beta.realtime.RealtimeModel({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      voice: 'Aoede',
      temperature: 0.7,
      instructions: SYSTEM_INSTRUCTIONS,
    });

    const session = new voice.AgentSession({
      llm: realtimeModel,
      vad,
    });

    const agent = new voice.Agent({
      instructions: SYSTEM_INSTRUCTIONS,
    });

    const useHedra = !!process.env.HEDRA_AVATAR_ID;

    // Disable RoomIO audio output when using Hedra to prevent it from
    // publishing a ParticipantAudioOutput track to the room. Without this,
    // bot-page would receive BOTH the agent's direct audio track AND
    // Hedra's avatar audio track, causing double playback / distortion.
    // Hedra's DataStreamAudioOutput handles audio routing to the avatar.
    await session.start({
      room: ctx.room,
      agent,
      outputOptions: {
        audioEnabled: !useHedra,
      },
    });
    console.log('Agent session started');

    // Start Hedra avatar AFTER session.start() so that avatar.start()
    // can set output.audio = DataStreamAudioOutput(16kHz) without being
    // overwritten. forwardAudio() auto-resamples Gemini 24kHz → 16kHz.
    if (useHedra) {
      const avatar = new AvatarSession({
        avatarId: process.env.HEDRA_AVATAR_ID!,
      });
      await avatar.start(session, ctx.room);
      console.log('Hedra avatar session started');
    } else {
      console.warn('HEDRA_AVATAR_ID not set, running without avatar');
    }

    // Greet the meeting
    await session.generateReply({
      instructions: '会議に参加したことを簡単に挨拶してください。「こんにちは、AIアシスタントです。ご質問があればお気軽にどうぞ。」のような短い挨拶をしてください。',
    });
  },
});
