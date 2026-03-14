import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {
    // Intentionally empty — React already logs to console in dev mode.
    // In production, errors propagate to window.onerror for monitoring.
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8">
          <h2
            className="text-[16px] font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Something went wrong
          </h2>
          <p
            className="text-[13px] mb-4 text-center max-w-[400px]"
            style={{ color: 'var(--text-muted)' }}
          >
            An unexpected error occurred. Try refreshing the page or click retry below.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-lg text-[12px]"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              color: 'var(--text-primary)',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
