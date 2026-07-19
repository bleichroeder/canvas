import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { emit, reportFatal, getSessionId } from '../player/diagnostics';
import { createStallWatchdog } from '../player/watchdog';
import { api } from '../api';
import { navigate, useRoute } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { CaptionsLayer } from '../components/CaptionsLayer';
import { DiagnosticsOverlay } from '../components/DiagnosticsOverlay';
import { PlayerErrorDialog } from '../components/PlayerErrorDialog';
import { UpNextOverlay } from '../components/UpNextOverlay';
import { bootEngine, type EngineHandle } from '../player/engine';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import { parseVtt, type Cue } from '../lib/vtt-parser';
import {
  updateNowPlayingProgress,
  getCaptionsOffsetMs,
  setCaptionsOffsetMs,
} from '../storage';
import { getQueue, setQueue, type PlaybackQueue } from '../lib/playback-queue';
import { type PlayerMode, closePlayer, openPlayer, setPlayerMode, useEmbedRect } from '../lib/player-session';
import {
  startSession,
  updateSession,
  endSession,
  currentHeapMB,
} from '../lib/crash-telemetry';
import type { PlayResolution, ItemDetail } from '../types';
import Backdrop from '@mui/material/Backdrop';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Fade from '@mui/material/Fade';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';

interface Props { source: string; id: string; fromSec: number; mode: PlayerMode }

function classifyError(e: Error): string {
  const m = (e.message ?? '').toLowerCase();
  if (m.includes('decoder') || m.includes('video')) return 'video';
  if (m.includes('audio')) return 'audio';
  if (m.includes('fetch') || m.includes('network')) return 'fetch';
  if (m.includes('demux') || m.includes('container') || m.includes('mkv') || m.includes('mp4')) return 'demux';
  return 'unknown';
}

const PROGRESS_INTERVAL_MS = 15_000;

// Pre-gesture pending-sample caps. Since v0.7.0 the ChunkBuffer in engine.ts
// throttles feed rate based on pts lead (~1.5s ahead of clock), so in normal
// operation these arrays hold at most a few hundred KB. These caps remain as
// a defensive backstop: if a user tabs away for 10+ seconds before hitting
// Play and the fetcher fills the ChunkBuffer to its own pause-lead threshold,
// chunks still eventually reach these arrays. Hitting the cap pauses the
// fetcher. Once the user starts playback the arrays drain into the decoders.
// 240 video chunks ≈ 10 sec @ 24fps; 480 audio chunks ≈ 10 sec @ 47 packets/sec.
const MAX_PENDING_VIDEO_CHUNKS = 240;
const MAX_PENDING_AUDIO_CHUNKS = 480;

export function PlayerInstance({ source, id, fromSec, mode }: Props) {
  const route = useRoute();
  const isMini = mode === 'mini';
  const embedRect = useEmbedRect();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Loading…');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [queue, setQueueState] = useState<PlaybackQueue | null>(null);
  const [upNextOpen, setUpNextOpen] = useState(false);
  const endReachedRef = useRef(false);
  const [reseeking, setReseeking] = useState(false);

  const VOL_KEY = 'canvas.volume';
  const [volume, setVolume] = useState<number>(() => {
    const raw = localStorage.getItem(VOL_KEY);
    const n = raw === null ? 1 : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
  });
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const [subtitleTracks, setSubtitleTracks] = useState<PlayResolution['subtitleTracks']>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [captionCues, setCaptionCues] = useState<Cue[]>([]);
  const [captionsOffsetMs, setCaptionsOffsetMsState] = useState<number>(getCaptionsOffsetMs);

  // Item metadata for the splash overlay (backdrop + title shown before first play).
  const [itemMeta, setItemMeta] = useState<ItemDetail | null>(null);
  const [hasEverStarted, setHasEverStarted] = useState(false);
  // Audio-only sources (Plex music, etc) have no video track. We keep the
  // splash overlay visible the entire session and let it act as the
  // now-playing view (album art + title + center play/pause).
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const watchdogRef = useRef<ReturnType<typeof createStallWatchdog> | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const snapshotIntervalRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  // While true, audio chunks are buffered (not fed to the decoder) so the
  // audio-mastered clock stays at 0 until the first video frame is decoded —
  // otherwise audio plays ahead during the video decoder's post-seek spin-up.
  const audioHeldRef = useRef(false);
  const reportRef = useRef(0);
  const resolutionRef = useRef<PlayResolution | null>(null);
  // Start as true so the first onReady auto-plays. The user already gestured
  // (clicked Play/Resume on Home or ItemDetail) which navigated them here —
  // AudioContext.resume() inherits that user-activation. If it rejects anyway
  // (e.g. cold deep-link), autoStartPlayback throws and the splash overlay's
  // Play button stays the manual fallback.
  const wasPlayingRef = useRef(true);
  const seekTokenRef = useRef(0);
  const sessionBaseRef = useRef(0);
  const tapStateRef = useRef<{ times: number[] }>({ times: [] });

  useEffect(() => {
    let t: number | undefined;
    const reset = () => {
      setControlsVisible(true);
      if (t) clearTimeout(t);
      t = window.setTimeout(() => setControlsVisible(false), 4500);
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

  // Auto-open diagnostics overlay when ?diag=1 is present in the hash query.
  useEffect(() => {
    try {
      if (route.query['diag'] === '1') setDiagOpen(true);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audioRef.current;
      if (a) setPos(sessionBaseRef.current + a.currentTime());
      if (resolutionRef.current) setDuration(resolutionRef.current.durationSec);
      const now = Date.now();
      if (startedRef.current && now - reportRef.current > PROGRESS_INTERVAL_MS) {
        reportRef.current = now;
        const cur = a ? sessionBaseRef.current + a.currentTime() : 0;
        void api.progress(source, id, cur, false).catch(() => {});
        updateNowPlayingProgress(source, id, cur);
      }
      // Refresh the crash-telemetry session marker. A renderer kill leaves
      // this stale; checkForPreviousCrash() on next cold load surfaces it.
      if (startedRef.current) {
        const cur = a ? sessionBaseRef.current + a.currentTime() : 0;
        updateSession({
          posSec: Math.round(cur),
          heapMB: currentHeapMB(),
          droppedFrames: videoRef.current?.droppedFrameCount,
        });
      }
      // End-of-stream detection: show UpNextOverlay or navigate away.
      const p = a ? sessionBaseRef.current + a.currentTime() : 0;
      const dur = resolutionRef.current?.durationSec ?? 0;
      if (
        !endReachedRef.current &&
        startedRef.current &&
        !paused &&
        !errMsg &&
        dur > 0 &&
        p >= dur - 0.5
      ) {
        endReachedRef.current = true;
        const q = queue;
        if (q && q.currentIndex + 1 < q.episodes.length) {
          setUpNextOpen(true);
        } else {
          // No queue OR at last episode — close the player and unwind.
          closePlayer();
          if (mode !== 'mini') {
            if (window.history.length > 1) window.history.back();
            else navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
          }
        }
      }
    }, 250);
    return () => clearInterval(t);
  }, [source, id, queue, paused, errMsg]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
    localStorage.setItem(VOL_KEY, String(volume));
  }, [volume]);
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  // Fetch item metadata (backdrop + title) for the splash overlay. Independent
  // of the stream-resolve path so the splash can paint as soon as possible.
  useEffect(() => {
    let cancelled = false;
    api.item(source, id).then(
      (item) => { if (!cancelled) setItemMeta(item); },
      () => { /* splash falls back to no-backdrop */ },
    );
    return () => { cancelled = true; };
  }, [source, id]);

  useEffect(() => {
    endReachedRef.current = false;
    setUpNextOpen(false);
    const q = getQueue();
    if (q && q.sourceId === source && q.episodes[q.currentIndex]?.id === id) {
      setQueueState(q);
    } else {
      setQueueState(null);
    }
  }, [source, id]);

  // Fetch and parse VTT for the currently-selected subtitle track. Depends on
  // the resolved track URL (a primitive string), so reseek-induced re-fetches
  // of the same track don't trigger redundant subtitle requests.
  const selectedTrackUrl =
    selectedSubtitleId && subtitleTracks
      ? subtitleTracks.find((t) => t.id === selectedSubtitleId)?.url
      : undefined;
  useEffect(() => {
    if (!selectedTrackUrl) { setCaptionCues([]); return; }
    let cancelled = false;
    api.fetchSubtitlesText(selectedTrackUrl).then(
      (text) => { if (!cancelled) setCaptionCues(parseVtt(text)); },
      (e: Error) => {
        if (!cancelled) {
          console.warn('subtitles fetch failed:', e.message);
          setCaptionCues([]);
        }
      },
    );
    return () => { cancelled = true; };
  }, [selectedTrackUrl]);

  function onSubtitleChange(id: string | null): void {
    setSelectedSubtitleId(id);
  }
  function onCaptionsOffsetChange(ms: number): void {
    setCaptionsOffsetMsState(ms);
    setCaptionsOffsetMs(ms);
  }

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function autoStartPlayback(): Promise<void> {
    const video = videoRef.current;
    const audio = audioRef.current;
    // Start the audio context now (needs the user gesture), but HOLD audio: with
    // an empty worklet queue the audio-mastered clock stays at 0. Route video
    // chunks straight to the decoder and wait for its first decoded frame, then
    // release audio. This keeps audio from racing ahead while the (slower) 1080p
    // video decoder spins up after a seek — the post-seek "audio ahead / audio
    // before video" drift. At from=0 the first keyframe is already there so the
    // wait is negligible.
    if (audio) await audio.start(); // ctx.resume; no samples fed yet → clock 0
    video?.start();
    startedRef.current = true;
    audioHeldRef.current = !!video && !!audio; // only hold when we have both tracks
    for (const c of pendingVideoRef.current) video?.feed(c);
    pendingVideoRef.current = [];
    if (!audioHeldRef.current) {
      for (const c of pendingAudioRef.current) audio?.feed(c);
      pendingAudioRef.current = [];
    }
    // Wait for the first decoded video frame (VideoSink.frames populated by the
    // decoder, independent of the clock), with a fallback so we never hang.
    if (audioHeldRef.current && video) {
      const deadline = performance.now() + 3000;
      while (video.queuedFrames === 0 && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 16));
      }
      // Release audio: feed what buffered during the wait; future chunks flow
      // directly again once the hold is cleared.
      audioHeldRef.current = false;
      for (const c of pendingAudioRef.current) audio?.feed(c);
      pendingAudioRef.current = [];
    }
    setPaused(false);
    setHasEverStarted(true);
    // Drained the pending buffers — let the fetcher run free again.
    engineRef.current?.resume();
  }

  const bootSession = (fromSec: number): { cancel: () => void } => {
    let cancelled = false;
    let cancelTimer: number | undefined;
    void (async () => {
      // Resolve source name (id -> type) for readable diagnostics.
      // On failure, fall back to the raw source ID.
      let sourceType: string = source;
      try {
        const list = await api.listSources();
        const match = list.find((s) => String(s.id) === source);
        if (match) sourceType = match.type;
      } catch {
        // listSources failed — keep the raw ID. Never let this crash bootSession.
      }

      emit('session_start', {
        sourceType,
        canvasVersion:
          (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CANVAS_VERSION ?? 'dev',
      });
      try {
        setStatus(fromSec > 0 ? 'Seeking…' : 'Resolving stream…');
        const resolution = await api.play(source, id, fromSec);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setSubtitleTracks(resolution.subtitleTracks ?? []);
        setStatus('Loading…');
        const canvas = canvasRef.current!;
        engineRef.current = bootEngine({
          url: resolution.url,
          getClock: () => audioRef.current?.currentTime() ?? 0,
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig && !info.audioConfig) {
              setErrMsg('No playable tracks');
              setReseeking(false);
              return;
            }
            const audioOnly = !info.videoConfig;
            setIsAudioOnly(audioOnly);
            if (info.videoConfig) {
              const video = new VideoSink({
                canvas,
                config: info.videoConfig,
                clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
                onError: (e) => setErrMsg(`video: ${e.message}`),
                onFirstFrame: () => setReseeking(false),
                // Stop pulling network bytes when the video queue is full so
                // hardware decoders that run faster than realtime don't race
                // ahead and pile future-stamped frames into the queue (which
                // drawDue would then reject and the video would freeze).
                onBackpressure: (state) => {
                  if (state === 'pause') engineRef.current?.pause();
                  else engineRef.current?.resume();
                },
              });
              videoRef.current = video;
            }
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audio.setVolume(volume);
              audio.setMuted(muted);
              audioRef.current = audio;
              // Start the stall watchdog once the audio sink is ready.
              watchdogRef.current?.stop();
              const watchdog = createStallWatchdog({
                getAudioClockSec: () => audioRef.current?.currentTime() ?? 0,
              });
              watchdog.start();
              watchdogRef.current = watchdog;
            }
            sessionBaseRef.current = fromSec;
            setStatus('');
            // VideoSink's onFirstFrame is what normally clears the reseek
            // loading state — for audio-only sessions there's no first-frame
            // callback, so clear it as soon as the audio sink is constructed
            // (independent of whether auto-play succeeds; a stalled autoplay
            // shouldn't trap the splash in a "loading" state on a reseek).
            if (audioOnly) setReseeking(false);
            if (wasPlayingRef.current) {
              autoStartPlayback().catch((e) => {
                console.warn('auto-play failed (likely no user gesture):', e);
              });
            }
            // No status hint here — the splash overlay (with its big play
            // button) IS the affordance for first play.
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else {
              pendingVideoRef.current.push(chunk);
              if (pendingVideoRef.current.length >= MAX_PENDING_VIDEO_CHUNKS) {
                engineRef.current?.pause();
              }
            }
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && !audioHeldRef.current && audioRef.current) audioRef.current.feed(chunk);
            else {
              pendingAudioRef.current.push(chunk);
              if (pendingAudioRef.current.length >= MAX_PENDING_AUDIO_CHUNKS) {
                engineRef.current?.pause();
              }
            }
          },
          // Note: we do NOT re-emit the fatal here. Every path into onFatal is
          // preceded by a specific *_error emit at the point of failure
          // (fetch_error / demux_error / video_error / audio_error), so the ring
          // snapshot inside reportFatal already contains the error event.
          onFatal: (e) => {
            const kind = classifyError(e);
            reportFatal({ message: e.message, kind, stack: e.stack }, source).catch(() => {});
            setErrMsg(e.message);
            setReseeking(false);
          },
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
        // Emit a queue_snapshot every 2 seconds for diagnostics ring.
        if (snapshotIntervalRef.current !== null) clearInterval(snapshotIntervalRef.current);
        snapshotIntervalRef.current = window.setInterval(() => {
          const videoSink = videoRef.current;
          const audioSink = audioRef.current;
          emit('queue_snapshot', {
            videoQueue: videoSink?.queueLength ?? 0,
            audioQueue: audioSink?.queueLength ?? 0,
            pendingV: pendingVideoRef.current.length,
            pendingA: pendingAudioRef.current.length,
            clockSec: audioSink?.currentTime() ?? 0,
            videoHeadPtsSec: videoSink?.headPtsSec ?? null,
            droppedTotal: videoSink?.droppedFrameCount ?? 0,
          });
        }, 2000);
      } catch (e) {
        if (!cancelled) {
          setErrMsg((e as Error).message);
          setReseeking(false);
        }
      }
    })();
    return {
      cancel: () => {
        cancelled = true;
        if (cancelTimer) clearTimeout(cancelTimer);
        if (snapshotIntervalRef.current !== null) {
          clearInterval(snapshotIntervalRef.current);
          snapshotIntervalRef.current = null;
        }
        watchdogRef.current?.stop();
        watchdogRef.current = null;
      },
    };
  };

  useEffect(() => {
    startSession({
      source,
      id,
      startedAt: Date.now(),
      posSec: fromSec,
      heapMB: currentHeapMB(),
    });
    const handle = bootSession(fromSec);
    return () => {
      handle.cancel();
      if (snapshotIntervalRef.current !== null) {
        clearInterval(snapshotIntervalRef.current);
        snapshotIntervalRef.current = null;
      }
      engineRef.current?.dispose();
      engineRef.current = null;
      videoRef.current?.close();
      videoRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
      watchdogRef.current?.stop();
      watchdogRef.current = null;
      // Clean unmount — clear the session marker. If we crashed before
      // reaching here, the marker survives and checkForPreviousCrash() on
      // the next cold load logs it.
      endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a && startedRef.current) {
        const cur = sessionBaseRef.current + a.currentTime();
        const url = `${import.meta.env.VITE_CANVAS_API}/api/progress/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
        const blob = new Blob(
          [JSON.stringify({ posSec: cur, completed: false })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.(url, blob);
        updateNowPlayingProgress(source, id, cur);
      }
    };
  }, [source, id]);

  async function onPlayPause() {
    if (errMsg) return;
    if (!startedRef.current) {
      emit('user_gesture', { kind: 'play' });
      wasPlayingRef.current = true;
      try {
        await autoStartPlayback();
      } catch (e) {
        // AudioContext.resume() rejected — likely no user gesture (cold
        // deep-link) or audio device unavailable. Log and bail; the splash
        // stays visible with its Play button so the user can retry.
        console.warn('start failed:', e);
        wasPlayingRef.current = false;
      }
      setStatus('');
      return;
    }
    const a = audioRef.current;
    if (!paused) {
      emit('user_gesture', { kind: 'pause' });
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
      wasPlayingRef.current = false;
    } else {
      emit('user_gesture', { kind: 'play' });
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
      wasPlayingRef.current = true;
    }
  }

  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
    emit('user_gesture', { kind: 'seek' });
    const target = Math.max(0, Math.min(targetSec, duration > 0 ? duration - 1 : targetSec));
    setReseeking(true);
    const myToken = ++seekTokenRef.current;
    setPos(target);
    wasPlayingRef.current = startedRef.current && !paused;
    engineRef.current?.dispose();
    engineRef.current = null;
    videoRef.current?.close();
    videoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = false;
    const handle = bootSession(target);
    const interval = window.setInterval(() => {
      if (myToken !== seekTokenRef.current) {
        handle.cancel();
        clearInterval(interval);
      } else if (engineRef.current) {
        clearInterval(interval);
      }
    }, 100);
  }

  function restartSession(fromSec: number): void {
    emit('user_gesture', { kind: 'retry' });
    setErrMsg(null);
    const myToken = ++seekTokenRef.current;
    wasPlayingRef.current = false;  // splash's Play button becomes the manual restart affordance
    engineRef.current?.dispose();
    engineRef.current = null;
    videoRef.current?.close();
    videoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = false;
    setHasEverStarted(false);
    setReseeking(false);
    setStatus('Loading…');
    const handle = bootSession(fromSec);
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

  async function onFullscreenToggle(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* ignore */ }
  }
  function onMuteToggle(): void { setMuted((m) => !m); }
  function onVolumeChange(v: number): void {
    setVolume(v);
    if (v > 0 && muted) setMuted(false);
  }

  function goToEpisode(nextIndex: number): void {
    if (!queue) return;
    const nextEp = queue.episodes[nextIndex];
    if (!nextEp) return;
    const updated: PlaybackQueue = { ...queue, currentIndex: nextIndex };
    setQueue(updated);
    const nextFrom = Math.floor(nextEp.viewOffsetSec ?? 0);
    // Switch the persistent session to the next item (re-boots via the host's
    // key); keep the URL in step when we're the full-screen route.
    openPlayer(source, nextEp.id, { fromSec: nextFrom, mode });
    if (mode === 'full') navigate(`/play/${source}/${nextEp.id}?from=${nextFrom}`, { replace: true });
  }

  function onPrev(): void {
    if (!queue) return;
    if (pos > 5) {
      void reseek(0);
      return;
    }
    goToEpisode(queue.currentIndex - 1);
  }

  function onNext(): void {
    if (!queue) return;
    goToEpisode(queue.currentIndex + 1);
  }

  function onCornerTap() {
    const now = performance.now();
    const times = tapStateRef.current.times.filter((t) => now - t <= 1500);
    times.push(now);
    tapStateRef.current.times = times;
    if (times.length >= 3) {
      tapStateRef.current.times = [];
      setDiagOpen(true);
    }
  }

  // Tear the persistent player down. When it's the full/embed surface we also
  // unwind the route we're on (rather than pushing a new entry, which would
  // trap /play in the back-stack); a mini player just closes in place.
  function exitPlayer() {
    closePlayer();
    if (mode !== 'mini') {
      if (window.history.length > 1) window.history.back();
      else navigate('/');
    }
  }

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, sessionBaseRef.current + a.currentTime(), false).catch(() => {});
    }
    exitPlayer();
  }

  // Dock to the corner mini-player and return to whatever's behind /play, so
  // playback continues while browsing. (Leaving /play also docks it, but the
  // explicit button doesn't depend on how the user got here.)
  function minimizePlayer() {
    setPlayerMode('mini');
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  }

  // Audio-only keeps the splash on screen the entire session as the
  // now-playing surface (album art + title); audio+video hides it once
  // playback starts.
  const splashVisible = !isMini && !errMsg && !reseeking && (isAudioOnly || !hasEverStarted);
  const engineReady = status === '';
  // Center button icon: spinner while engine is warming up, Pause if we're
  // playing (audio-only's persistent splash needs to flip), Play otherwise.
  const splashShowingPause = isAudioOnly && startedRef.current && !paused;

  const containerStyle: CSSProperties = isMini
    ? {
        position: 'fixed', bottom: 16, right: 16, width: 384, height: 216,
        background: '#000', borderRadius: 10, overflow: 'hidden',
        boxShadow: '0 10px 34px rgba(0,0,0,0.6)', zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }
    : mode === 'embed'
    ? {
        // Float over the slot the host view (YouTube watch) measured for us.
        position: 'fixed',
        top: embedRect?.top ?? 0, left: embedRect?.left ?? 0,
        width: embedRect?.width ?? '100%', height: embedRect?.height ?? 220,
        background: '#000', overflow: 'hidden', zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }
    : {
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      };

  return (
    <div
      onClick={() => {
        if (errMsg) return;
        // Mini: a tap expands back to the full route. Otherwise: before first
        // play any tap starts playback; once running, taps toggle pause only
        // when controls were already visible.
        if (isMini) { navigate(`/play/${source}/${id}`); return; }
        if (!hasEverStarted) { void onPlayPause(); return; }
        if (controlsVisible) void onPlayPause();
      }}
      style={containerStyle}
    >
      <canvas
        ref={canvasRef}
        // Fill the player area and scale the decoded frame to fit, preserving
        // aspect (letterbox). object-fit lets a low-res stream upscale instead
        // of rendering tiny at its native size, and adapts to the mini/embed
        // containers too. The backing-store size stays the decoded resolution.
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      {isMini && (
        <>
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: 'absolute', top: 0, left: 0, right: 0,
              display: 'flex', justifyContent: 'flex-end', gap: 0.25, p: 0.25,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)',
            }}
          >
            <IconButton size="small" aria-label="expand" sx={{ color: '#fff' }}
              onClick={() => navigate(`/play/${encodeURIComponent(source)}/${encodeURIComponent(id)}`)}>
              <OpenInFullIcon sx={{ fontSize: 17 }} />
            </IconButton>
            <IconButton size="small" aria-label="close" sx={{ color: '#fff' }}
              onClick={() => { void onClose(); }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
          <IconButton
            aria-label={paused ? 'play' : 'pause'}
            onClick={(e) => { e.stopPropagation(); void onPlayPause(); }}
            sx={{
              position: 'absolute', color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.65)' },
            }}
          >
            {paused ? <PlayArrowIcon /> : <PauseIcon />}
          </IconButton>
        </>
      )}
      <Fade in={splashVisible} timeout={300} unmountOnExit>
        <Box
          sx={{
            position: 'absolute', inset: 0,
            backgroundColor: '#0e0f12',
            backgroundImage: itemMeta?.backdrop ? `url(${itemMeta.backdrop})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Box sx={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(14,15,18,0.4) 0%, rgba(14,15,18,0.75) 70%, rgba(14,15,18,0.9) 100%)',
          }} />
          <Stack alignItems="center" spacing={4} sx={{ position: 'relative', textAlign: 'center', maxWidth: 800, px: 4 }}>
            {itemMeta?.title && (
              <Typography
                variant="h1"
                sx={{
                  color: 'common.white',
                  fontSize: { xs: 28, sm: 40 },
                  fontWeight: 600,
                  textShadow: '0 2px 12px rgba(0,0,0,0.7)',
                  letterSpacing: 0.5,
                }}
              >
                {itemMeta.title}
              </Typography>
            )}
            <IconButton
              onClick={(e) => { e.stopPropagation(); void onPlayPause(); }}
              disabled={!engineReady}
              aria-label="play"
              sx={{
                width: 104, height: 104,
                color: 'common.white',
                backgroundColor: 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.5)',
                backdropFilter: 'blur(8px)',
                transition: 'transform 150ms ease, background-color 150ms ease',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  transform: 'scale(1.04)',
                },
                '&.Mui-disabled': {
                  color: 'rgba(255,255,255,0.6)',
                  borderColor: 'rgba(255,255,255,0.2)',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                },
              }}
            >
              {!engineReady
                ? <CircularProgress size={42} sx={{ color: 'common.white' }} />
                : splashShowingPause
                ? <PauseIcon sx={{ fontSize: 60 }} />
                : <PlayArrowIcon sx={{ fontSize: 60, ml: 0.5 }} />}
            </IconButton>
            {isAudioOnly && (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ color: 'rgba(255,255,255,0.7)' }}>
                <MusicNoteIcon sx={{ fontSize: 18 }} />
                <Typography variant="caption" sx={{ letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                  Audio only
                </Typography>
              </Stack>
            )}
          </Stack>
        </Box>
      </Fade>
      {!isMini && <PlayerControls
        paused={paused}
        posSec={pos}
        durationSec={duration}
        visible={controlsVisible}
        thumbnailUrlTemplate={resolutionRef.current?.thumbnailUrlTemplate}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen}
        subtitleTracks={subtitleTracks ?? []}
        selectedSubtitleId={selectedSubtitleId}
        captionsOffsetMs={captionsOffsetMs}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
        onMinimize={minimizePlayer}
        onVolumeChange={onVolumeChange}
        onMuteToggle={onMuteToggle}
        onFullscreenToggle={onFullscreenToggle}
        onOpenDiagnostics={() => setDiagOpen(true)}
        queueContext={queue ? {
          canPrev: queue.currentIndex > 0 || pos > 5,
          canNext: queue.currentIndex < queue.episodes.length - 1,
          onPrev,
          onNext,
        } : null}
        onSubtitleChange={onSubtitleChange}
        onCaptionsOffsetChange={onCaptionsOffsetChange}
      />}
      {!isMini && <CaptionsLayer
        cues={captionCues}
        posSec={pos}
        offsetMs={captionsOffsetMs}
        controlsVisible={controlsVisible}
      />}
      <PlayerErrorDialog
        open={!!errMsg}
        message={errMsg ?? ''}
        sessionId={getSessionId()}
        onRetry={() => restartSession(pos)}
        onShowDiagnostics={() => setDiagOpen(true)}
        onBackToBrowse={() => {
          setErrMsg(null);
          exitPlayer();
        }}
      />
      {!isMini && queue && queue.currentIndex + 1 < queue.episodes.length && (
        <UpNextOverlay
          open={upNextOpen}
          showTitle={queue.showTitle}
          nextEpisode={queue.episodes[queue.currentIndex + 1]!}
          onPlayNow={() => {
            setUpNextOpen(false);
            goToEpisode(queue.currentIndex + 1);
          }}
          onCancel={() => {
            setUpNextOpen(false);
            exitPlayer();
          }}
        />
      )}
      {!isMini && (
        <Backdrop open={reseeking} sx={{ zIndex: 5, bgcolor: 'rgba(0,0,0,0.6)' }}>
          <Stack alignItems="center" spacing={2}>
            <CircularProgress />
            <Typography color="common.white">Seeking…</Typography>
          </Stack>
        </Backdrop>
      )}
      {mode === 'full' && (
        <div
          onClick={onCornerTap}
          style={{ position: 'fixed', top: 0, left: 0, width: 100, height: 100, zIndex: 9998, cursor: 'default' }}
          aria-hidden="true"
        />
      )}
      <DiagnosticsOverlay open={diagOpen} onClose={() => setDiagOpen(false)} sourceType={source ?? 'unknown'} />
    </div>
  );
}
