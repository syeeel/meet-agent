import OpenAI from 'openai';
import type { ChatMessage } from '../types';

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
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
 * Generate a response to a transcript using GPT-4
 */
export async function generateResponse(
  transcript: string,
  conversationHistory: ChatMessage[] = [],
  speaker?: string
): Promise<{ response: string; tokensUsed: number }> {
  const client = getClient();

  const userContent = speaker
    ? `[${speaker}]: ${transcript}`
    : transcript;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userContent },
  ];

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4',
    messages,
    max_tokens: 500,
    temperature: 0.7,
  });

  const response = completion.choices[0]?.message?.content || '';
  const tokensUsed = completion.usage?.total_tokens || 0;

  return { response, tokensUsed };
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

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `以下の内容を${maxLength}文字以内で要約してください。重要なポイントを簡潔にまとめてください。`,
      },
      { role: 'user', content },
    ],
    max_tokens: 300,
    temperature: 0.5,
  });

  return completion.choices[0]?.message?.content || '';
}
