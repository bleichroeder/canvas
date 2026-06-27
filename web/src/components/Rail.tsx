import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Item } from '../types';
import { PosterCard } from './PosterCard';

export interface RailProps {
  title: string;
  items: (Item & { source: string })[];
  cardWidth?: number;
}

export function Rail({ title, items, cardWidth = 180 }: RailProps) {
  if (items.length === 0) return null;
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>{title}</Typography>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          overflowX: 'auto',
          px: 2.5,
          scrollSnapType: 'x mandatory',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {items.map((it) => (
          <Box key={`${it.source}:${it.id}`} sx={{ scrollSnapAlign: 'start' }}>
            <PosterCard item={it} source={it.source} width={cardWidth} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
