import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function SetupProgress({
  title,
  description,
  error,
  progress,
  children,
}: {
  title: string;
  description?: string;
  error?: string;
  progress?: number;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const [displayProgress, setDisplayProgress] = useState(progress);
  const fraction =
    typeof displayProgress === 'number' && Number.isFinite(displayProgress)
      ? Math.max(0, Math.min(1, displayProgress))
      : undefined;

  useLayoutEffect(() => {
    if (!error) setDisplayProgress(progress);
  }, [error, progress]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <main className="setup-progress" ref={panel} tabIndex={-1} aria-label={title}>
      <div className="setup-progress-content">
        <svg
          className="setup-progress-mark"
          viewBox="0 0 64 64"
          data-active={!error}
          data-determinate={fraction !== undefined}
          aria-hidden="true"
        >
          <circle
            className="setup-progress-track"
            cx="32"
            cy="32"
            r="25"
            fill="none"
            strokeWidth="4"
          />
          <circle
            className="setup-progress-arc"
            cx="32"
            cy="32"
            r="25"
            pathLength="100"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
            style={
              fraction === undefined ? undefined : { strokeDasharray: `${fraction * 100} 100` }
            }
          />
          <g
            className="setup-progress-tip"
            style={
              fraction === undefined ? undefined : { transform: `rotate(${fraction * 360}deg)` }
            }
          >
            <circle className="setup-progress-dot" cx="32" cy="7" r="8" strokeWidth="2" />
          </g>
        </svg>
        <div
          className="setup-progress-message"
          data-analytics-private
          role={error ? 'alert' : 'status'}
        >
          <h1>{title}</h1>
          {description && <p>{description}</p>}
          {error && <p data-analytics-private>{error}</p>}
        </div>
        {fraction !== undefined && !error && (
          <progress
            className="setup-progress-download"
            aria-label="Download progress"
            max={1}
            value={fraction}
          />
        )}
        {children && <div className="setup-progress-actions">{children}</div>}
      </div>
      <p className="setup-progress-note">
        Your workspace, browser and data stay on this computer. Your chosen AI providers process
        requests; browsing and connected apps contact external services.
      </p>
    </main>
  );
}
