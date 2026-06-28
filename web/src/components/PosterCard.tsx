import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import { getSources } from '../storage';
import { SOURCE_TYPE_COLOR, sourceGlyph } from '../lib/source-style';
import type { Item } from '../types';

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
  const src = showSourceBadge ? getSources()[source] : undefined;
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
          {src && (
            <Box
              sx={{
                position: 'absolute',
                top: 6, right: 6,
                minWidth: 28, height: 24, px: 0.75,
                borderRadius: 0.5,
                backgroundColor: SOURCE_TYPE_COLOR[src.type],
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: 0.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              {sourceGlyph(src.label)}
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
