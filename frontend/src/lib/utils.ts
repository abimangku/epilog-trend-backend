import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export function getBrandColor(brand: string): string {
  const colors: Record<string, string> = {
    Stella: 'var(--brand-stella)',
    'HIT Kecoa': 'var(--brand-hitkecoa)',
    NYU: 'var(--brand-nyu)',
  };
  return colors[brand] || 'var(--text-muted)';
}

export function getLifecycleColor(stage: string): string {
  const colors: Record<string, string> = {
    emerging: 'var(--lifecycle-emerging)',
    growing: 'var(--lifecycle-growing)',
    peaking: 'var(--lifecycle-peaking)',
    declining: 'var(--lifecycle-declining)',
    dead: 'var(--lifecycle-dead)',
  };
  return colors[stage] || 'var(--text-muted)';
}

export function getClassificationColor(classification: string): string {
  const colors: Record<string, string> = {
    viral: 'var(--classification-viral)',
    hot_trend: 'var(--classification-hot)',
    rising_trend: 'var(--lifecycle-growing)',
    emerging_trend: 'var(--lifecycle-emerging)',
    noise: 'var(--text-muted)',
  };
  return colors[classification] || 'var(--text-muted)';
}

export function formatClassification(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function formatLifecycle(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
