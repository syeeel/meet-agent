// Recall.ai API Types

export interface CreateBotOptions {
  meetingUrl: string;
  botName?: string;
  webpageUrl: string;
}

export interface OutputMediaConfig {
  camera?: {
    kind: 'webpage';
    config: {
      url: string;
    };
  };
  screenshare?: {
    kind: 'webpage';
    config: {
      url: string;
    };
  };
}

export interface TranscriptionOptions {
  provider: 'default' | 'assembly_ai' | 'deepgram' | 'aws';
}

export interface CreateBotRequest {
  meeting_url: string;
  bot_name: string;
  output_media?: OutputMediaConfig;
  transcription_options?: TranscriptionOptions;
}

export interface Bot {
  id: string;
  meeting_url: string;
  bot_name: string;
  status: BotStatus;
  created_at: string;
  join_at?: string;
  recording?: Recording;
}

export type BotStatus =
  | 'ready'
  | 'joining_call'
  | 'in_waiting_room'
  | 'in_call_not_recording'
  | 'in_call_recording'
  | 'call_ended'
  | 'done'
  | 'fatal';

export interface Recording {
  id: string;
  started_at: string;
  completed_at?: string;
}

// Transcript Types

export interface TranscriptWord {
  text: string;
  start_timestamp: number;
  end_timestamp: number;
  confidence: number;
}

export interface TranscriptMessage {
  transcript: {
    speaker: string;
    speaker_id?: number;
    words: TranscriptWord[];
    is_final: boolean;
  };
}

// OpenAI Types

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ConversationContext {
  messages: ChatMessage[];
  speaker?: string;
}

// API Request/Response Types

export interface CreateBotApiRequest {
  meetingUrl: string;
  botName?: string;
}

export interface ChatApiRequest {
  transcript: string;
  speaker?: string;
  context?: ChatMessage[];
}

export interface ChatApiResponse {
  response: string;
  tokens_used?: number;
}

export interface ApiErrorResponse {
  error: string;
  details?: string;
}
