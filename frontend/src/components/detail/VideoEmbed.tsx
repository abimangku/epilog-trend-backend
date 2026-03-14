import { useEffect, useRef, useState } from 'react';

interface VideoEmbedProps {
  url: string | null;
  thumbnailUrl?: string | null;
}

export function VideoEmbed({ url, thumbnailUrl }: VideoEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const videoId = url?.match(/\/video\/(\d+)/)?.[1];

  useEffect(() => {
    if (!videoId) return;

    // Timeout: if embed doesn't load within 5 seconds, show fallback
    const timer = setTimeout(() => {
      setStatus((prev) => (prev === 'loading' ? 'failed' : prev));
    }, 5000);

    // Load TikTok embed script
    const existingScript = document.querySelector('script[src*="tiktok.com/embed"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.tiktok.com/embed.js';
      script.async = true;
      script.onload = () => {
        setStatus('ready');
        clearTimeout(timer);
      };
      script.onerror = () => {
        setStatus('failed');
        clearTimeout(timer);
      };
      document.body.appendChild(script);
    } else {
      setStatus('ready');
      clearTimeout(timer);
    }

    return () => clearTimeout(timer);
  }, [videoId]);

  useEffect(() => {
    if (status === 'ready' && videoId && (window as any).tiktokEmbed) {
      (window as any).tiktokEmbed.lib.render();
    }
  }, [status, videoId]);

  if (!videoId) return null;

  // Loading skeleton
  if (status === 'loading') {
    return (
      <div className="rounded-lg overflow-hidden bg-white/5 animate-pulse" style={{ minHeight: 400 }}>
        <div className="flex items-center justify-center h-full min-h-[400px] text-white/30 text-sm">
          Loading TikTok embed...
        </div>
      </div>
    );
  }

  // Fallback card when embed fails
  if (status === 'failed') {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10 bg-white/5">
        {thumbnailUrl && (
          <div className="aspect-[9/16] max-h-[300px] overflow-hidden">
            <img
              src={thumbnailUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        )}
        <div className="p-4 text-center">
          <p className="text-white/50 text-sm mb-3">TikTok embed unavailable</p>
          <a
            href={url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
          >
            Open on TikTok
          </a>
        </div>
      </div>
    );
  }

  // Normal embed
  return (
    <div ref={containerRef} className="rounded-lg overflow-hidden">
      <blockquote
        className="tiktok-embed"
        cite={url || ''}
        data-video-id={videoId}
        style={{ maxWidth: '100%' }}
      >
        <section />
      </blockquote>
    </div>
  );
}
