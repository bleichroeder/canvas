/**
 * Master playback clock.
 * Audio-master when an AudioSink is connected; falls back to performance.now() before that.
 */
export interface Clock {
  currentTime(): number;
}

export function makePerformanceClock(): Clock {
  const start = performance.now();
  return { currentTime: () => (performance.now() - start) / 1000 };
}

export function makeAudioMasterClock(audio: { currentTime(): number }): Clock {
  return { currentTime: () => audio.currentTime() };
}
