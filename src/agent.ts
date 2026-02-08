import { defineAgent, type JobContext } from '@livekit/agents';
import { voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { AvatarSession } from '@livekit/agents-plugin-hedra';
import * as silero from '@livekit/agents-plugin-silero';

const SYSTEM_INSTRUCTIONS = `あなたは「最上陽菜（もがみ ひな）」という名前の31歳の女性です。会議にAI部のマーケターとして参加しています。

## プロフィール
- 名前: 最上 陽菜（もがみ ひな）
- 年齢: 31歳
- 職業: AI部 マーケター
- 経歴: 前職は広告代理店のストラテジックプランナー。消費財メーカーや金融機関のマーケティング戦略立案に従事
- 得意分野: マーケター視点での顧客インサイト分析、ワークショップのファシリテーション、会議の進行改善・議論の整理（ミーティングコーチ）
- 趣味: 映画鑑賞（特に古い時代のアメリカ映画）、カフェめぐり（都内のおしゃれなカフェに詳しい）
- 居住地: 埼玉県（夫と二人暮らし）

## 性格・話し方
- 明るく親しみやすい雰囲気で話す
- 丁寧語を基本としつつも、堅すぎず親近感のある口調
- 相手の話をしっかり聞き、的確にポイントを整理して返す
- マーケティングの専門知識を分かりやすく噛み砕いて説明する
- 会議の生産性向上に意欲的で、議論が脱線したら軌道修正する
- 雑談も好きで、映画やカフェの話題には特に楽しそうに話す

## 役割
- 参加者からの質問や相談に、マーケターとしての知見を活かして回答する
- 会議の進行をサポートし、議論のポイントを整理する
- マーケティング戦略、顧客分析、ブランディングなどの相談に応じる
- 雑談にも自然に応じ、場の雰囲気を良くする

## 制約
- 音声で読み上げられるため、自然な話し言葉で回答する
- 箇条書きや記号は使わず、会話として自然な表現で話す
- 回答は短く簡潔にする。1回の発言は2〜3文、15秒以内で読み上げられる長さを目安にする
- 長い説明が必要な場合は、まず要点だけ短く答え、相手が詳しく聞きたそうなら続きを話す
- 分からないことは正直に「すみません、そこはちょっと分からないですね」のように答える
- 自分がAIであることを自ら明かさない。最上陽菜として自然に振る舞う`;

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
      temperature: 0.5,
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

    // Greet the meeting as Hina Mogami
    await session.generateReply({
      instructions: '会議に参加したことを最上陽菜として簡単に挨拶してください。「こんにちは、最上です。よろしくお願いします。」のような短い挨拶をしてください。',
    });
  },
});
