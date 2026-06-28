import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

export interface LibraryCardProps {
  library: Item;
  source: string;
}

export function LibraryCard({ library, source }: LibraryCardProps) {
  return (
    <Card sx={{ width: 200 }}>
      <CardActionArea
        onClick={() => navigate(`/lib/${source}/${library.id}`)}
        sx={{ p: 2.5 }}
      >
        <Box sx={{ minHeight: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography variant="body1" sx={{ fontWeight: 500, mb: 0.5 }}>
            {library.title}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}
