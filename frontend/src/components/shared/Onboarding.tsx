export function Onboarding() {
  return (
    <div className="flex items-center justify-center py-20 px-7">
      <div
        className="rounded-xl p-8 max-w-[540px] w-full text-center"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      >
        <h2
          className="text-[20px] font-semibold mb-2"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}
        >
          Welcome to Trend Watcher
        </h2>
        <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
          This tool automatically scans TikTok's For You Page and analyzes trends
          for your brands — Stella, HIT Kecoa, and NYU.
        </p>

        <ul className="text-left space-y-3 mb-6">
          <li className="flex items-start gap-3">
            <span
              className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--text-muted)' }}
            />
            <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Scans run automatically throughout the day based on your schedule
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span
              className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--text-muted)' }}
            />
            <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Each scan captures videos, scores engagement, and runs AI analysis
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span
              className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--text-muted)' }}
            />
            <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Brand fit scoring generates content ideas for each trend
            </span>
          </li>
        </ul>

        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Check the System Status page to monitor scan activity and adjust the schedule.
        </p>
      </div>
    </div>
  );
}
