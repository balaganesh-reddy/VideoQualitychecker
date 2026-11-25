import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, RotateCcw } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  title?: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function VideoPlayer({ src, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrent(video.currentTime);
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    };
    const onMeta = () => setDuration(video.duration);
    const onEnd = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnd);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('ended', onEnd);
    };
  }, [src]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.play();
    setPlaying(true);
  };

  const fullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) video.requestFullscreen();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const pct = Number(e.target.value);
    video.currentTime = (pct / 100) * video.duration;
    setProgress(pct);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 shadow-lg">
      <div className="relative flex-1 min-h-0 bg-black group">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain"
          onClick={togglePlay}
          playsInline
        />
        {!playing && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40"
            aria-label="Play video"
          >
            <span className="flex items-center justify-center w-16 h-16 rounded-full bg-white/90 text-neutral-900 shadow-xl transition-transform hover:scale-110">
              <Play className="w-7 h-7 ml-1" fill="currentColor" />
            </span>
          </button>
        )}
        {title && (
          <div className="absolute top-0 left-0 right-0 px-4 py-2 bg-gradient-to-b from-black/70 to-transparent text-white text-sm font-medium pointer-events-none">
            {title}
          </div>
        )}
      </div>

      <div className="bg-neutral-900 px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-neutral-400 tabular-nums w-20">{formatTime(current)}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={progress}
            onChange={seek}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-neutral-700 accent-sky-500"
            style={{
              background: `linear-gradient(to right, #0ea5e9 ${progress}%, #404040 ${progress}%)`,
            }}
          />
          <span className="text-xs font-mono text-neutral-400 tabular-nums w-20 text-right">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
          </button>
          <button
            onClick={toggleMute}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={restart}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors"
            aria-label="Restart"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <button
            onClick={fullscreen}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
