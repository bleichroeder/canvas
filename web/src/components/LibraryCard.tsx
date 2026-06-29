import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import FolderIcon from '@mui/icons-material/Folder';
import { navigate } from '../router';
import { ElevatedCard } from './ElevatedCard';
import type { Item } from '../types';

export interface LibraryCardProps {
  library: Item;
  source: string;
}

function iconForType(type?: string) {
  switch (type) {
    case 'movie':   return <MovieIcon sx={{ fontSize: 32 }} />;
    case 'show':    return <TvIcon sx={{ fontSize: 32 }} />;
    case 'artist':
    case 'album':
    case 'track':   return <LibraryMusicIcon sx={{ fontSize: 32 }} />;
    case 'photo':
    case 'photoalbum': return <PhotoLibraryIcon sx={{ fontSize: 32 }} />;
    default:        return <FolderIcon sx={{ fontSize: 32 }} />;
  }
}

export function LibraryCard({ library, source }: LibraryCardProps) {
  return (
    <ElevatedCard
      variant="interactive"
      onClick={() => navigate(`/lib/${source}/${library.id}`)}
      sx={{ width: 220, height: 130, position: 'relative', overflow: 'hidden' }}
    >
      {/* Backdrop mosaic from Plex's composite endpoint, falling back to a
          subtle gradient when no composite is available. */}
      <Box sx={{
        position: 'absolute', inset: 0,
        backgroundColor: 'background.paper',
        backgroundImage: library.poster
          ? `url(${library.poster})`
          : 'linear-gradient(135deg, #1a2030 0%, #181a1f 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }} />
      {/* Bottom-fade overlay so the title stays legible. */}
      <Box sx={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(14,15,18,0.05) 0%, rgba(14,15,18,0.45) 50%, rgba(14,15,18,0.92) 100%)',
      }} />
      {/* Type icon, top-left. */}
      <Box sx={{
        position: 'absolute', top: 10, left: 12,
        color: 'rgba(255,255,255,0.95)',
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))',
      }}>
        {iconForType(library.librarySectionType)}
      </Box>
      {/* Title at the bottom over the gradient. */}
      <Box sx={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        zIndex: 1, p: 1.75,
      }}>
        <Typography
          sx={{
            color: '#fff',
            fontWeight: 600,
            fontSize: 16,
            lineHeight: 1.2,
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {library.title}
        </Typography>
      </Box>
    </ElevatedCard>
  );
}
