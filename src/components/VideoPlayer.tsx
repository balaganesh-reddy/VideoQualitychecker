import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, RotateCcw } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  title?: string;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mediaErrorMessage(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Video loading was interrupted. Try selecting the file again.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The video could not be read. Reconnect the SD card and select the file again.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'This video file is damaged or uses a codec this browser cannot decode.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This format or codec is not supported by this browser. Try Chrome or Edge, or convert the clip to MP4 (H.264/AAC).';
    default:
      return 'The video could not be played. Try reconnecting the SD card and selecting it again.';
  }
}

export default function VideoPlayer({ src, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reset = () => {
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      setCurrent(0);
      setError('');
    };
    const onTime = () => {
      setCurrent(video.currentTime);
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    };
    const onMeta = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setError('');
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError(mediaErrorMessage(video));
    };

    reset();
    video.addEventListener('loadstart', reset);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnd);
    video.addEventListener('error', onError);
    video.load();
    return () => {
      video.removeEventListener('loadstart', reset);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnd);
      video.removeEventListener('error', onError);
    };
  }, [src]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setError('');
      try {
        await video.play();
      } catch {
        setError(mediaErrorMessage(video));
      }
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const restart = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setError('');
    try {
      await video.play();
    } catch {
      setError(mediaErrorMessage(video));
    }
  };

  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const fullscreen = () => {
    const video = videoRef.current;
    if (video?.requestFullscreen) void video.requestFullscreen();
  };

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const pct = Number(event.target.value);
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
          onClick={() => void togglePlay()}
          playsInline
          preload="metadata"
          controls
        />
        {!playing && !error && (
          <button
            onClick={() => void togglePlay()}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/35"
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
        {error && (
          <div role="alert" className="absolute inset-x-3 bottom-3 rounded-lg border border-red-400/40 bg-neutral-950/95 p-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="bg-neutral-900 px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-neutral-400 tabular-nums w-20">{formatTime(current)}</span>
          <input type="range" min={0} max={100} step={0.1} value={progress} onChange={seek} aria-label="Seek video" className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-neutral-700 accent-sky-500" style={{ background: `linear-gradient(to right, #0ea5e9 ${progress}%, #404040 ${progress}%)` }} />
          <span className="text-xs font-mono text-neutral-400 tabular-nums w-20 text-right">{formatTime(duration)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void togglePlay()} className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
          </button>
          <button onClick={toggleMute} className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors" aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button onClick={() => void restart()} className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors" aria-label="Restart"><RotateCcw className="w-4 h-4" /></button>
          <label className="ml-2 flex items-center gap-2 text-xs text-neutral-300">
            <span>Speed</span>
            <select value={playbackRate} onChange={(event) => changePlaybackRate(Number(event.target.value))} className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-sky-500" aria-label="Playback speed">
              {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
          </label>
          <div className="flex-1" />
          <button onClick={fullscreen} className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-800 text-white hover:bg-sky-600 transition-colors" aria-label="Fullscreen"><Maximize2 className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}
