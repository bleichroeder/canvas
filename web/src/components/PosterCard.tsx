import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

export interface PosterCardProps {
  item: Item;
  source: string;
  width?: number;
}

export function PosterCard({ item, source, width = 180 }: PosterCardProps) {
  const isFolder = item.type === 'folder';
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${item.id}`;
  const aspectRatio = item.type === 'episode' ? 16 / 9 : 2 / 3;
  return (
    <Card sx={{ flexShrink: 0, width, backgroundColor: 'transparent', border: 'none' }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
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
