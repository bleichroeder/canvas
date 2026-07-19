import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import { SOURCE_TYPE_COLOR, sourceGlyph } from '../lib/source-style';
import { ElevatedCard } from './ElevatedCard';
import type { StoredSource } from '../storage';

export interface SourcePickerCardProps {
  srcKey: string;
  label: string;
  type: StoredSource['type'];
  libraryCount?: number;
  backdropUrl?: string;
}

export function SourcePickerCard({ srcKey, label, type, libraryCount, backdropUrl }: SourcePickerCardProps) {
  const color = SOURCE_TYPE_COLOR[type];
  return (
    <ElevatedCard
      variant="interactive"
      onClick={() => navigate(`/source/${srcKey}`)}
      sx={{ width: 220, height: 130, position: 'relative', overflow: 'hidden' }}
    >
      {/* Backdrop: a recently-added item's poster from this source, blurred
          and darkened. Falls back to a source-type-color tinted gradient
          when no recent content is known. */}
      <Box sx={{
        position: 'absolute', inset: 0,
        backgroundColor: 'background.paper',
        backgroundImage: backdropUrl
          ? `url(${backdropUrl})`
          : `linear-gradient(135deg, ${color}33 0%, #181a1f 75%)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: backdropUrl ? 'blur(2px) brightness(0.6)' : 'none',
        transform: backdropUrl ? 'scale(1.04)' : 'none',
      }} />
      <Box sx={{
        position: 'absolute', inset: 0,
        background: backdropUrl
          ? 'linear-gradient(135deg, rgba(14,15,18,0.55) 0%, rgba(14,15,18,0.8) 100%)'
          : 'none',
      }} />
      {/* Foreground: glyph + label + count. */}
      <Box sx={{
        position: 'relative', zIndex: 1,
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', gap: 2,
        p: 2,
      }}>
        <Box
          sx={{
            width: 56, height: 56, borderRadius: 1.5,
            backgroundColor: color,
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22,
            letterSpacing: 1,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            flexShrink: 0,
          }}
        >
          {type === 'youtube' ? (
            // YouTube: white play triangle on the red badge (its brand mark),
            // instead of a two-letter monogram.
            <Box component="svg" viewBox="0 0 24 24" aria-hidden sx={{ width: 30, height: 30 }}>
              <path d="M8 5.5v13l11-6.5z" fill="#fff" />
            </Box>
          ) : (
            sourceGlyph(label)
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: '#fff',
              fontWeight: 600,
              fontSize: 16,
              lineHeight: 1.2,
              textShadow: backdropUrl ? '0 1px 3px rgba(0,0,0,0.8)' : 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: 'rgba(255,255,255,0.75)',
              textShadow: backdropUrl ? '0 1px 2px rgba(0,0,0,0.7)' : 'none',
              mt: 0.25,
            }}
          >
            {/* YouTube has no library concept — show a tagline instead of a
                misleading "0 libraries" count. */}
            {type === 'youtube'
              ? 'Search & subscriptions'
              : libraryCount === undefined
              ? ' '
              : `${libraryCount} ${libraryCount === 1 ? 'library' : 'libraries'}`}
          </Typography>
        </Box>
      </Box>
    </ElevatedCard>
  );
}
