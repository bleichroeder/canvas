import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { findCue, type Cue } from '../lib/vtt-parser';

interface Props {
  cues: Cue[];
  posSec: number;
  offsetMs: number;
  /** Lift captions higher when the controls strip is visible so they don't sit under it. */
  controlsVisible: boolean;
}

export function CaptionsLayer({ cues, posSec, offsetMs, controlsVisible }: Props) {
  const cue = useMemo(
    () => (cues.length === 0 ? null : findCue(cues, posSec - offsetMs / 1000)),
    [cues, posSec, offsetMs],
  );
  if (!cue) return null;
  return (
    <Box
      sx={{
        position: 'absolute',
        left: '50%',
        bottom: controlsVisible ? 150 : 48,
        transform: 'translateX(-50%)',
        maxWidth: '85%',
        zIndex: 8,
        pointerEvents: 'none',
        textAlign: 'center',
        transition: 'bottom 200ms ease',
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 30,
          fontWeight: 500,
          lineHeight: 1.25,
          color: '#fff',
          backgroundColor: 'rgba(0, 0, 0, 0.72)',
          padding: '6px 18px',
          borderRadius: 4,
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.9)',
          whiteSpace: 'pre-wrap',
          letterSpacing: 0.2,
        }}
      >
        {cue.text}
      </Box>
    </Box>
  );
}
