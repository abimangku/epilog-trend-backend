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

export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg p-3 flex flex-col items-center gap-1.5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            <Skeleton className="w-12 h-6" />
            <Skeleton variant="text" className="w-16" />
          </div>
        ))}
      </div>

      {/* Video embed area */}
      <Skeleton className="w-full h-[300px]" />

      {/* Title lines */}
      <div className="space-y-2">
        <Skeleton variant="text" className="w-full h-4" />
        <Skeleton variant="text" className="w-2/3 h-4" />
      </div>

      {/* Badges */}
      <div className="flex gap-1.5">
        <Skeleton className="w-16 h-5" />
        <Skeleton className="w-20 h-5" />
        <Skeleton className="w-14 h-5" />
      </div>

      {/* Analysis lines */}
      <div className="space-y-2">
        <Skeleton variant="text" className="w-full" />
        <Skeleton variant="text" className="w-full" />
        <Skeleton variant="text" className="w-4/5" />
      </div>
    </div>
  );
}

export function BrandFitSkeleton() {
  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
    >
      {/* Brand name row */}
      <div className="flex items-center gap-2">
        <Skeleton variant="circle" className="w-6 h-6" />
        <Skeleton variant="text" className="w-24" />
      </div>

      {/* Score */}
      <Skeleton className="w-16 h-7" />

      {/* Entry angle lines */}
      <div className="space-y-2">
        <Skeleton variant="text" className="w-full" />
        <Skeleton variant="text" className="w-3/4" />
      </div>
    </div>
  );
}
