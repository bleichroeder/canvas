import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import { SOURCE_TYPE_COLOR, sourceGlyph } from '../lib/source-style';
import type { StoredSource } from '../storage';

export interface SourcePickerCardProps {
  srcKey: string;
  label: string;
  type: StoredSource['type'];
  libraryCount?: number;
}

export function SourcePickerCard({ srcKey, label, type, libraryCount }: SourcePickerCardProps) {
  return (
    <Card sx={{ width: 200 }}>
      <CardActionArea
        onClick={() => navigate(`/source/${srcKey}`)}
        sx={{ p: 2.5, minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
      >
        <Box
          sx={{
            width: 44, height: 44, borderRadius: 1,
            backgroundColor: SOURCE_TYPE_COLOR[type],
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 18,
            letterSpacing: 1,
          }}
        >
          {sourceGlyph(label)}
        </Box>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {libraryCount === undefined ? ' ' : `${libraryCount} ${libraryCount === 1 ? 'library' : 'libraries'}`}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}
