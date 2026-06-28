import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import { getSources } from '../storage';
import type { Item } from '../types';
import type { StoredSource } from '../storage';

const TYPE_COLOR: Record<StoredSource['type'], string> = {
  plex: '#e5a00d',
  jellyfin: '#aa5cc3',
  flixify: '#cc3333',
  generic: '#6b7280',
};

const TYPE_GLYPH: Record<StoredSource['type'], string> = {
  plex: 'P',
  jellyfin: 'J',
  flixify: 'F',
  generic: '·',
};

export interface PosterCardProps {
  item: Item;
  source: string;
  width?: number;
  showSourceBadge?: boolean;
}

export function PosterCard({ item, source, width = 180, showSourceBadge = false }: PosterCardProps) {
  const isFolder = item.type === 'folder';
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${item.id}`;
  const aspectRatio = item.type === 'episode' ? 16 / 9 : 2 / 3;
  const sourceType = showSourceBadge ? getSources()[source]?.type : undefined;
  return (
    <Card sx={{ flexShrink: 0, width, backgroundColor: 'transparent', border: 'none' }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
        <Box sx={{ position: 'relative', width }}>
          <Box
            sx={{
              width,
              aspectRatio: String(aspectRatio),
              backgroundColor: 'background.paper',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              backgroundImage: item.poster ? `url(${item.poster})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          {sourceType && (
            <Box
              sx={{
                position: 'absolute',
                top: 6, right: 6,
                width: 24, height: 24,
                borderRadius: 0.5,
                backgroundColor: TYPE_COLOR[sourceType],
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              {TYPE_GLYPH[sourceType]}
            </Box>
          )}
        </Box>
        <Typography
          variant="body2"
          sx={{
            mt: 1,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'text.primary',
          }}
        >
          {item.title}
        </Typography>
        {item.year ? (
          <Typography variant="caption" color="text.secondary">{item.year}</Typography>
        ) : null}
      </CardActionArea>
    </Card>
  );
}
