export type LifecycleStage = 'emerging' | 'growing' | 'peaking' | 'declining' | 'dead';
export type Classification = 'noise' | 'emerging_trend' | 'rising_trend' | 'hot_trend' | 'viral';
export type UrgencyLevel = 'act_now' | 'decide_today' | 'watch' | 'archive';
export type FeedbackType = 'gold' | 'good_wrong_timing' | 'wrong_brand' | 'trash';
export type ClientName = 'Stella' | 'HIT Kecoa' | 'NYU';

export interface Trend {
  id: string;
  hash: string;
  platform: string;
  title: string;
  url: string;
  author: string | null;
  author_tier: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  hashtags: string[];
  audio_id: string | null;
  audio_title: string | null;
  engagement_rate: number;
  velocity_score: number;
  replication_count: number;
  lifecycle_stage: LifecycleStage;
  momentum: number;
  trend_score: number;
  classification: Classification;
  urgency_level: UrgencyLevel;
  thumbnail_url: string | null;
  thumbnail_storage_url: string | null;
  video_embed_url: string | null;
  scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface TrendAnalysis {
  id: string;
  trend_id: string | null;
  analysis_type: 'deep_analysis' | 'cross_trend_synthesis';
  summary: string | null;
  why_trending: string | null;
  key_insights: string[] | null;
  brand_relevance_notes: string | null;
  recommended_action: string | null;
  confidence: number;
  relevance_score: number;
  virality_score: number;
  brand_safety_score: number;
  replication_signal_score: number;
  trash_check: { passed: boolean; reasons: string[] } | null;
  model_version: string | null;
  analyzed_at: string;
  created_at: string;
}

export interface ClientBrandFit {
  id: string;
  trend_id: string;
  brand_name: ClientName;
  client_name: string;
  brand_category: string | null;
  fit_score: number;
  fit_reasoning: string | null;
  content_angle: string | null;
  entry_angle: string | null;
  content_ideas: string[];
  risk_level: string;
  urgency_level: string | null;
  hours_to_act: number | null;
  brand_entry_confidence: number;
  brief_generated: string | null;
  created_at: string;
}

export interface EngagementSnapshot {
  id: string;
  trend_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  captured_at: string;
}

export interface TeamFeedback {
  id: string;
  trend_id: string;
  voted_by: string;
  vote: FeedbackType;
  note: string | null;
  client_name: string;
  feedback: string;
  notes: string;
  voted_at: string;
  created_at: string;
}

export interface SavedItem {
  id: string;
  trend_id: string;
  saved_at: string;
  collections: string[];
}

export interface Collection {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface ForYouResponse {
  high_potential: EnrichedTrend[];
  fun_to_replicate: EnrichedTrend[];
  rising_quietly: EnrichedTrend[];
  audio_going_viral: AudioMomentum[];
}

export interface EnrichedTrend extends Trend {
  analysis: TrendAnalysis | null;
  brand_fits: ClientBrandFit[];
  detected_formats: string[];
  reason: string;
}

export interface AudioMomentum {
  audio_id: string;
  audio_title: string;
  current_count: number;
  previous_count: number;
  growth_pct: number;
  status: 'rising' | 'stable' | 'declining';
  trend_ids?: string[];
}

export interface FormatDistribution {
  format: string;
  count: number;
  percentage: number;
  growth: number;
}
