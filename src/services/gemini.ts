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

const SYSTEM_PROMPT = `あなたは会議に参加しているAIアシスタントです。

## 役割
- 参加者からの質問に簡潔かつ的確に回答してください
- 会議の流れを妨げないよう、回答は短く要点をまとめてください
- 専門用語は必要に応じて分かりやすく説明してください

## 制約
- 回答は音声で読み上げられるため、自然な日本語で話すように回答してください
- 箇条書きや記号は使わず、話し言葉で回答してください
- 長すぎる回答は避け、30秒以内で読み上げられる長さを目安にしてください
- 分からないことは正直に「分かりません」と答えてください`;

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
