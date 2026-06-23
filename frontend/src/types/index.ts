export interface Channel {
  id?: number;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected';
  auto_mod: boolean;
  mem_window_seconds: number;
  detect_threshold: number;
  auto_mute_threshold: number;
  trigger_after_n?: number;
}

export interface ChatMessage {
  id: string;
  channel: string;
  username: string;
  message: string;
  role: 'Viewer' | 'Sub' | 'VIP' | 'Mod' | 'Broadcaster';
  score: number;
  reasons: string[];
  ts: number;
  color: string;
}

export interface QueueItem {
  id: string;
  channel: string;
  username: string;
  score: number;
  lastMsg: string;
  reasons: string[];
  color: string;
  muted: boolean;
  ts: number;
  /** How many times this user has been flagged for spam (累計) */
  spamCount?: number;
}

export interface ModerationLog {
  id: number;
  channel_name: string;
  username: string;
  message: string;
  spam_score: number;
  reasons: string[];
  action: string;
  duration_seconds: number | null;
  performed_by: string;
  created_at: string;
}

export interface AppSettings {
  detect_threshold: number;
  auto_mute_threshold: number;
  similarity_threshold: number;
  burst_limit: number;
  mem_window_seconds: number;
  link_detection: boolean;
  auto_mode: boolean;
  default_mute_duration: number;
  ignored_roles?: string[];
}
