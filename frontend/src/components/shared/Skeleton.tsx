import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'rect' | 'circle' | 'text';
}

export function Skeleton({ className, variant = 'rect' }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse',
        variant === 'circle' ? 'rounded-full' : 'rounded-lg',
        variant === 'text' ? 'h-3 rounded' : '',
        className
      )}
      style={{ background: 'var(--bg-input)' }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
    >
      <Skeleton className="w-full h-32" />
      <Skeleton variant="text" className="w-3/4" />
      <Skeleton variant="text" className="w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="w-16 h-5" />
        <Skeleton className="w-16 h-5" />
      </div>
    </div>
  );
}
