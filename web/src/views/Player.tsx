import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { navigate } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { bootEngine, type EngineHandle } from '../player/engine';
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
  const engineRef = useRef<EngineHandle | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const startedRef = useRef(false);
  const sessionBaseRef = useRef(0); // session offset (seconds) — set on each boot, current pos = sessionBase + audio.currentTime()
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
      if (a) setPos(sessionBaseRef.current + a.currentTime());
      if (resolutionRef.current) setDuration(resolutionRef.current.durationSec);

      // Progress save every 15s.
      const now = Date.now();
      if (startedRef.current && now - reportRef.current > PROGRESS_INTERVAL_MS) {
        reportRef.current = now;
        const cur = a ? sessionBaseRef.current + a.currentTime() : 0;
        void api.progress(source, id, cur, false).catch(() => {});
      }
    }, 250);
    return () => clearInterval(t);
  }, [source, id]);

  // Track whether the user has ever tapped play in this view's lifetime.
  // Survives reseeks so the new engine auto-resumes after a seek.
  const wasPlayingRef = useRef(false);
  const seekTokenRef = useRef(0);

  /** Construct (or reconstruct) the engine. Used at mount and on seek. */
  const bootSession = (fromSec: number): { cancel: () => void } => {
    let cancelled = false;
    let cancelTimer: number | undefined;

    void (async () => {
      try {
        setStatus(fromSec > 0 ? 'Seeking…' : 'Resolving stream…');
        const resolution = await api.play(source, id, fromSec);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');

        const canvas = canvasRef.current!;

        engineRef.current = bootEngine({
          url: resolution.url,
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
            // Pos baseline for the new session is fromSec (audio.currentTime() resets to 0 in new engine).
            sessionBaseRef.current = fromSec;
            setStatus('');
            if (wasPlayingRef.current) {
              // Auto-resume after seek — audio context is already user-gestured.
              void autoStartPlayback();
            } else {
              setStatus('Ready — tap to play');
            }
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onFatal: (e) => setErrMsg(e.message),
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    })();

    return {
      cancel: () => {
        cancelled = true;
        if (cancelTimer) clearTimeout(cancelTimer);
      },
    };
  };

  /** Common code for entering the playing state — used on first tap AND on auto-resume after seek. */
  async function autoStartPlayback(): Promise<void> {
    if (audioRef.current) await audioRef.current.start();
    videoRef.current?.start();
    for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
    for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = true;
    setPaused(false);
  }

  // Boot the engine on mount; tear down on unmount.
  useEffect(() => {
    const handle = bootSession(0);
    return () => {
      handle.cancel();
      engineRef.current?.dispose();
      engineRef.current = null;
      videoRef.current?.close();
      videoRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
    const target = Math.max(0, Math.min(targetSec, duration > 0 ? duration - 1 : targetSec));
    const myToken = ++seekTokenRef.current;
    setPos(target);
    wasPlayingRef.current = startedRef.current && !paused;
    // Tear down current engine and sinks.
    engineRef.current?.dispose();
    engineRef.current = null;
    videoRef.current?.close();
    videoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = false;
    // Boot at target.
    const handle = bootSession(target);
    // If another seek lands while we're booting, cancel this one.
    const interval = window.setInterval(() => {
      if (myToken !== seekTokenRef.current) {
        handle.cancel();
        clearInterval(interval);
      } else if (engineRef.current) {
        clearInterval(interval);
      }
    }, 100);
  }

  function onSeek(sec: number): void { void reseek(sec); }
  function onSeekRelative(delta: number): void { void reseek(pos + delta); }

  // Save progress on close.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a && startedRef.current) {
        const cur = sessionBaseRef.current + a.currentTime();
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
      wasPlayingRef.current = true;
      await autoStartPlayback();
      setStatus('');
      return;
    }
    // Toggle pause via AudioContext suspend/resume; video clock follows audio.
    const a = audioRef.current;
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
      wasPlayingRef.current = false;
    } else {
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
      wasPlayingRef.current = true;
    }
  }

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, sessionBaseRef.current + a.currentTime(), false).catch(() => {});
    }
    navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100vw', maxHeight: '100vh', display: 'block' }}
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
