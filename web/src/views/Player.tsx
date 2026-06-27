import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { navigate } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { RangeFetcher } from '../player/range-fetcher';
import { Demuxer } from '../player/demux';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import type { PlayResolution } from '../types';

interface Props { source: string; id: string }

const PROGRESS_INTERVAL_MS = 15_000;

export function Player({ source, id }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Loading…');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Long-lived refs for engine pieces.
  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const demuxerRef = useRef<Demuxer | null>(null);
  const fetcherRef = useRef<RangeFetcher | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const startedRef = useRef(false);
  const reportRef = useRef(0);
  const resolutionRef = useRef<PlayResolution | null>(null);

  // Auto-hide controls after 3s of inactivity.
  useEffect(() => {
    let t: number | undefined;
    const reset = () => {
      setControlsVisible(true);
      if (t) clearTimeout(t);
      t = window.setTimeout(() => setControlsVisible(false), 3000);
    };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    reset();
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  // Pos/duration polling tick (every 250ms).
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audioRef.current;
      if (a) setPos(a.currentTime());
      if (resolutionRef.current) setDuration(resolutionRef.current.durationSec);

      // Progress save every 15s.
      const now = Date.now();
      if (startedRef.current && now - reportRef.current > PROGRESS_INTERVAL_MS) {
        reportRef.current = now;
        const cur = a ? a.currentTime() : 0;
        void api.progress(source, id, cur, false).catch(() => {});
      }
    }, 250);
    return () => clearInterval(t);
  }, [source, id]);

  // Boot the engine.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setStatus('Resolving stream…');
        const resolution = await api.play(source, id);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');

        const canvas = canvasRef.current!;

        const demuxer = new Demuxer({
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig) { setErrMsg('No video track'); return; }
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
            });
            videoRef.current = video;
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audioRef.current = audio;
            }
            setStatus('Ready — tap to play');
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onError: (e) => setErrMsg(`demux: ${e.message}`),
        });
        demuxerRef.current = demuxer;

        const fetcher = new RangeFetcher({
          url: resolution.url,
          chunkSize: 4 * 1024 * 1024,
          onChunk: (offset, bytes) => demuxer.appendChunk(offset, bytes),
          onError: (e) => setErrMsg(`fetch: ${e.message}`),
          onDone: () => { demuxer.flush(); videoRef.current?.flush().catch(() => {}); },
        });
        fetcherRef.current = fetcher;
        fetcher.start();
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      fetcherRef.current?.abort();
      videoRef.current?.close();
      audioRef.current?.stop();
    };
  }, [source, id]);

  // Save progress on close.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a && startedRef.current) {
        const cur = a.currentTime();
        const url = `${import.meta.env.VITE_PASSENGER_API_V2}/api/progress/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
        const blob = new Blob(
          [JSON.stringify({ posSec: cur, completed: false })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.(url, blob);
      }
    };
  }, [source, id]);

  async function onPlayPause() {
    if (errMsg) return;
    if (!startedRef.current) {
      if (audioRef.current) await audioRef.current.start();
      videoRef.current?.start();
      for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
      for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
      pendingVideoRef.current = [];
      pendingAudioRef.current = [];
      startedRef.current = true;
      setPaused(false);
      setStatus('');
      return;
    }
    // Toggle pause via AudioContext suspend/resume; video clock follows audio.
    const a = audioRef.current;
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
    } else {
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
    }
  }

  function onSeek(sec: number) {
    const dem = demuxerRef.current;
    const fet = fetcherRef.current;
    const v = videoRef.current;
    if (!dem || !fet) return;
    const { videoByteOffset } = dem.seek(sec);
    v?.reset();
    fet.seek(videoByteOffset);
  }

  function onSeekRelative(delta: number) {
    onSeek(Math.max(0, pos + delta));
  }

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, a.currentTime(), false).catch(() => {});
    }
    navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100vw', maxHeight: '100vh', display: 'block', margin: '0 auto' }}
      />
      {(status || errMsg) && (
        <div style={{
          position: 'fixed', top: 12, left: 12,
          color: errMsg ? '#f88' : '#ccc',
          background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 4, fontSize: 13,
        }}>
          {errMsg ?? status}
        </div>
      )}
      <PlayerControls
        paused={paused}
        posSec={pos}
        durationSec={duration}
        visible={controlsVisible}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
      />
    </div>
  );
}
