import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatMessage } from '../types';

let genaiClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    genaiClient = new GoogleGenerativeAI(apiKey);
  }
  return genaiClient;
}

const SYSTEM_PROMPT = `あなたは伊勢 誠（いせ まこと）という人物として会話してください。

## プロフィール
- 45歳男性、千葉県船橋市在住
- 妻（42歳・看護師）、長女（高校1年）、長男（中学1年）の4人家族
- IT企業で20年の経験を持つビジネスコンサルタント。DX推進・業務改善が専門
- 早稲田大学商学部卒業後、大手SIerを経て独立

## 性格・話し方
- 落ち着いた口調で、相手の話をよく聞いてから答える
- 丁寧語を基本としつつ、親しみやすさも忘れない
- 難しいことを分かりやすく例え話で説明するのが得意
- 「なるほど」「いい質問ですね」など相槌を自然に入れる

## 趣味・関心
- 週末はロードバイクで房総半島を走るのが楽しみ
- コーヒーにこだわりがあり、自家焙煎している
- 読書好き。ビジネス書だけでなく歴史小説も好む（司馬遼太郎のファン）
- 最近は長男と一緒にプログラミング（Python）を学んでいる

## 会話のルール
- 回答は音声で読み上げられるため、自然な日本語の話し言葉で答えること
- 箇条書きや記号は使わず、話し言葉で回答すること
- 長すぎる回答は避け、30秒以内で読み上げられる長さを目安にすること
- 分からないことは正直に「すみません、それはちょっと分からないですね」と答えること
- プライベートの話題を振られたら、上記のペルソナに沿って自然に答えること`;

/**
 * Generate a response to a transcript using Gemini 3 Flash
 */
export async function generateResponse(
  transcript: string,
  conversationHistory: ChatMessage[] = [],
  speaker?: string
): Promise<{ response: string; tokensUsed: number }> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction: {
      role: 'user',
      parts: [{ text: SYSTEM_PROMPT }],
    },
  });

  const userContent = speaker
    ? `[${speaker}]: ${transcript}`
    : transcript;

  // Convert ChatMessage format to Gemini history format
  const geminiHistory = conversationHistory.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: msg.content }],
  })).filter((msg) => msg.role === 'user' || msg.role === 'model');

  const chat = model.startChat({
    history: geminiHistory,
  });

  const result = await chat.sendMessage(userContent);
  const response = result.response.text() || '';

  return { response, tokensUsed: 0 };
}

/**
 * Check if the transcript contains a trigger word that should invoke AI response
 */
export function shouldRespond(
  transcript: string,
  triggerWords: string[] = ['アシスタント', 'AI', '質問があります', 'ねえ']
): boolean {
  const lowerTranscript = transcript.toLowerCase();
  return triggerWords.some((trigger) =>
    lowerTranscript.includes(trigger.toLowerCase())
  );
}

/**
 * Summarize a conversation or meeting content
 */
export async function summarizeContent(
  content: string,
  maxLength: number = 200
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-3-flash-preview' });

  const result = await model.generateContent(
    `以下の内容を${maxLength}文字以内で要約してください。重要なポイントを簡潔にまとめてください。\n\n${content}`
  );

  return result.response.text() || '';
}
