import { useEffect, useRef, useState } from 'react';

interface VideoEmbedProps {
  url: string | null;
}

export function VideoEmbed({ url }: VideoEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  const videoId = url?.match(/\/video\/(\d+)/)?.[1];

  useEffect(() => {
    if (!videoId || !containerRef.current) return;

    // Load TikTok embed script
    const existingScript = document.querySelector('script[src*="tiktok.com/embed"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.tiktok.com/embed.js';
      script.async = true;
      script.onload = () => setLoaded(true);
      document.body.appendChild(script);
    } else {
      setLoaded(true);
    }
  }, [videoId]);

  useEffect(() => {
    if (loaded && videoId && (window as any).tiktokEmbed) {
      (window as any).tiktokEmbed.lib.render();
    }
  }, [loaded, videoId]);

  if (!videoId) return null;

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
