import React, { useState, useEffect, useRef } from 'react';
import './TemporalReplayControls.css';

interface TemporalReplayControlsProps {
  onTimeChange: (timestamp: number) => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onLiveToggle: (isLive: boolean) => void;
  isLive?: boolean;
}

type PlaybackSpeed = 1 | 4 | 16;
type WindowOption = { label: string; ms: number };

const WINDOW_OPTIONS: WindowOption[] = [
  { label: '6h',  ms: 6  * 3600_000 },
  { label: '24h', ms: 24 * 3600_000 },
  { label: '48h', ms: 48 * 3600_000 },
  { label: '7d',  ms: 7  * 86400_000 },
];

const TemporalReplayControls: React.FC<TemporalReplayControlsProps> = ({
  onTimeChange,
  onPlaybackSpeedChange,
  onLiveToggle,
  isLive: externalIsLive = true,
}) => {
  const [isLive, setIsLive] = useState<boolean>(externalIsLive);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [windowMs, setWindowMs] = useState<number>(48 * 3600_000);

  const playbackTimerRef = useRef<number | null>(null);

  const minTime = Date.now() - windowMs;
  const maxTime = Date.now();

  // Format timestamp for display
  const formatTimestamp = (timestamp: number): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(new Date(timestamp));
  };

  // Calculate time offset from now
  const getTimeOffset = (timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours === 0 && diffMinutes === 0) {
      return 'LIVE';
    } else if (diffHours === 0) {
      return `-${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `-${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffHours / 24);
      const remainingHours = diffHours % 24;
      return `-${days} day${days !== 1 ? 's' : ''} ${remainingHours}h ago`;
    }
  };

  // Handle playback
  useEffect(() => {
    if (isPlaying && !isLive) {
      playbackTimerRef.current = window.setInterval(() => {
        setCurrentTime((prev) => {
          const newTime = prev + (1000 * playbackSpeed); // Advance by 1 second * speed
          if (newTime >= maxTime) {
            // Reached live time
            setIsPlaying(false);
            handleGoLive();
            return maxTime;
          }
          onTimeChange(newTime);
          return newTime;
        });
      }, 1000); // Update every 1 second

      return () => {
        if (playbackTimerRef.current) {
          clearInterval(playbackTimerRef.current);
        }
      };
    }
  }, [isPlaying, isLive, playbackSpeed, onTimeChange, maxTime]);

  // Handle scrubber change
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseInt(e.target.value);
    setCurrentTime(newTime);
    setIsLive(false);
    onTimeChange(newTime);
    onLiveToggle(false);
  };

  // Handle play/pause
  const handlePlayPause = () => {
    if (isLive) {
      setIsLive(false);
      setCurrentTime(Date.now() - 1000 * 60); // Start 1 minute ago
      onLiveToggle(false);
    }
    setIsPlaying((prev) => !prev);
  };

  // Handle skip to start
  const handleSkipToStart = () => {
    setCurrentTime(minTime);
    setIsLive(false);
    setIsPlaying(false);
    onTimeChange(minTime);
    onLiveToggle(false);
  };

  // Handle skip to end / go live
  const handleSkipToEnd = () => {
    handleGoLive();
  };

  // Handle go live
  const handleGoLive = () => {
    setCurrentTime(Date.now());
    setIsLive(true);
    setIsPlaying(false);
    onTimeChange(Date.now());
    onLiveToggle(true);
  };

  // Handle speed change
  const handleSpeedChange = (speed: PlaybackSpeed) => {
    setPlaybackSpeed(speed);
    onPlaybackSpeedChange(speed);
  };

  // Sync with external isLive prop
  useEffect(() => {
    setIsLive(externalIsLive);
    if (externalIsLive) {
      setCurrentTime(Date.now());
      setIsPlaying(false);
    }
  }, [externalIsLive]);

  return (
    <div className="temporal-replay-controls">
      {/* Time Display */}
      <div className="replay-time-display">
        <div className="current-timestamp">{formatTimestamp(currentTime)}</div>
        <div className="time-offset">{getTimeOffset(currentTime)}</div>
      </div>

      {/* Window selector */}
      <div className="replay-window-selector">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            className={`window-button ${windowMs === opt.ms ? 'window-active' : ''}`}
            onClick={() => {
              setWindowMs(opt.ms);
              if (!isLive) setCurrentTime(t => Math.max(t, Date.now() - opt.ms));
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Scrubber */}
      <div className="replay-scrubber-container">
        <div className="scrubber-label-start">-{WINDOW_OPTIONS.find(o => o.ms === windowMs)?.label ?? '48h'}</div>
        <input
          type="range"
          min={minTime}
          max={maxTime}
          value={currentTime}
          onChange={handleScrubberChange}
          disabled={isLive}
          className="time-scrubber"
        />
        <div className="scrubber-label-end">NOW</div>
      </div>

      {/* Playback Controls */}
      <div className="replay-playback-controls">
        <button
          className="playback-button"
          onClick={handleSkipToStart}
          disabled={isLive}
          aria-label="Skip to start"
          title="Skip to start (-48h)"
        >
          ⏮
        </button>
        <button
          className="playback-button playback-button-primary"
          onClick={handlePlayPause}
          disabled={isLive}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause playback' : 'Start playback'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="playback-button"
          onClick={handleSkipToEnd}
          aria-label="Skip to end"
          title="Skip to end (LIVE)"
        >
          ⏭
        </button>
      </div>

      {/* Speed Selector */}
      <div className="replay-speed-controls">
        <span className="speed-label">Speed:</span>
        {([1, 4, 16] as PlaybackSpeed[]).map((speed) => (
          <button
            key={speed}
            className={`speed-button ${playbackSpeed === speed ? 'speed-active' : ''}`}
            onClick={() => handleSpeedChange(speed)}
            disabled={isLive}
          >
            {speed}×
          </button>
        ))}
      </div>

      {/* Live Button */}
      <div className="replay-live-container">
        <button
          className={`live-button ${isLive ? 'live-active' : 'live-inactive'}`}
          onClick={handleGoLive}
        >
          {isLive ? '● LIVE' : 'GO LIVE'}
        </button>
      </div>
    </div>
  );
};

export default TemporalReplayControls;
