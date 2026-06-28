import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { navigate, useRoute } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { CaptionsLayer } from '../components/CaptionsLayer';
import { bootEngine, type EngineHandle } from '../player/engine';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import { parseVtt, type Cue } from '../lib/vtt-parser';
import {
  updateNowPlayingProgress,
  getCaptionsOffsetMs,
  setCaptionsOffsetMs,
} from '../storage';
import type { PlayResolution, ItemDetail } from '../types';
import Backdrop from '@mui/material/Backdrop';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Fade from '@mui/material/Fade';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

interface Props { source: string; id: string }

const PROGRESS_INTERVAL_MS = 15_000;

export function Player({ source, id }: Props) {
  const route = useRoute();
  const fromQuery = (() => {
    const raw = route.query.from;
    if (raw === undefined) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  })();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Loading…');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [reseeking, setReseeking] = useState(false);

  const VOL_KEY = 'canvas.volume';
  const [volume, setVolume] = useState<number>(() => {
    const raw = localStorage.getItem(VOL_KEY);
    const n = raw === null ? 1 : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
  });
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [subtitleTracks, setSubtitleTracks] = useState<PlayResolution['subtitleTracks']>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [captionCues, setCaptionCues] = useState<Cue[]>([]);
  const [captionsOffsetMs, setCaptionsOffsetMsState] = useState<number>(getCaptionsOffsetMs);

  // Item metadata for the splash overlay (backdrop + title shown before first play).
  const [itemMeta, setItemMeta] = useState<ItemDetail | null>(null);
  const [hasEverStarted, setHasEverStarted] = useState(false);

  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const startedRef = useRef(false);
  const reportRef = useRef(0);
  const resolutionRef = useRef<PlayResolution | null>(null);
  const wasPlayingRef = useRef(false);
  const seekTokenRef = useRef(0);
  const sessionBaseRef = useRef(0);

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
    }, 250);
    return () => clearInterval(t);
  }, [source, id]);

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
    if (audioRef.current) await audioRef.current.start();
    videoRef.current?.start();
    for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
    for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = true;
    setPaused(false);
    setHasEverStarted(true);
  }

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
        setSubtitleTracks(resolution.subtitleTracks ?? []);
        setStatus('Loading…');
        const canvas = canvasRef.current!;
        engineRef.current = bootEngine({
          url: resolution.url,
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig) { setErrMsg('No video track'); setReseeking(false); return; }
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
              onFirstFrame: () => setReseeking(false),
            });
            videoRef.current = video;
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audio.setVolume(volume);
              audio.setMuted(muted);
              audioRef.current = audio;
            }
            sessionBaseRef.current = fromSec;
            setStatus('');
            if (wasPlayingRef.current) {
              void autoStartPlayback();
            }
            // No status hint here — the splash overlay (with its big play
            // button) IS the affordance for first play.
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onFatal: (e) => { setErrMsg(e.message); setReseeking(false); },
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
      } catch (e) {
        if (!cancelled) {
          setErrMsg((e as Error).message);
          setReseeking(false);
        }
      }
    })();
    return { cancel: () => { cancelled = true; if (cancelTimer) clearTimeout(cancelTimer); } };
  };

  useEffect(() => {
    const handle = bootSession(fromQuery);
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
      wasPlayingRef.current = true;
      await autoStartPlayback();
      setStatus('');
      return;
    }
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

  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
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

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, sessionBaseRef.current + a.currentTime(), false).catch(() => {});
    }
    // Unwind to wherever the user came from rather than pushing a new entry
    // (which would leave /play/ in the back-stack and trap the user there).
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
    }
  }

  const splashVisible = !hasEverStarted && !errMsg && !reseeking;
  const engineReady = status === '';

  return (
    <div
      onClick={() => {
        if (errMsg) return;
        // Before first play, any tap on the canvas starts playback (with or
        // without controls visible). Once running, the standard rule applies:
        // taps only toggle pause when controls were already visible.
        if (!hasEverStarted) { void onPlayPause(); return; }
        if (controlsVisible) void onPlayPause();
      }}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100vw', maxHeight: '100vh', display: 'block' }}
      />
      <Fade in={splashVisible} timeout={300} unmountOnExit>
        <Box
          sx={{
            position: 'fixed', inset: 0,
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
              {engineReady
                ? <PlayArrowIcon sx={{ fontSize: 60, ml: 0.5 }} />
                : <CircularProgress size={42} sx={{ color: 'common.white' }} />}
            </IconButton>
          </Stack>
        </Box>
      </Fade>
      {errMsg && (
        <div style={{
          position: 'fixed', top: 12, left: 12,
          color: '#f88',
          background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 4, fontSize: 13,
          zIndex: 12,
        }}>
          {errMsg}
        </div>
      )}
      <PlayerControls
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
        onVolumeChange={onVolumeChange}
        onMuteToggle={onMuteToggle}
        onFullscreenToggle={onFullscreenToggle}
        onSubtitleChange={onSubtitleChange}
        onCaptionsOffsetChange={onCaptionsOffsetChange}
      />
      <CaptionsLayer
        cues={captionCues}
        posSec={pos}
        offsetMs={captionsOffsetMs}
        controlsVisible={controlsVisible}
      />
      <Backdrop open={reseeking} sx={{ zIndex: 5, bgcolor: 'rgba(0,0,0,0.6)' }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography color="common.white">Seeking…</Typography>
        </Stack>
      </Backdrop>
    </div>
  );
}
