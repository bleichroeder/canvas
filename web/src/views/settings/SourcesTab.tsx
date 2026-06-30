import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SectionHeading } from '../../components/SectionHeading';
import { SourceCard } from '../../components/SourceCard';
import { EmptyState } from '../../components/EmptyState';
import { navigate } from '../../router';
import { api } from '../../api';
import { useSources } from '../../lib/SourcesContext';

export function SourcesTab() {
  const { sourceList, loading, refresh } = useSources();

  async function unpair(id: number) {
    try {
      await api.deleteSource(id);
      await refresh();
    } catch (e) {
      console.error('Failed to delete source:', e);
    }
  }

  if (loading && sourceList.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <SectionHeading
        title="Sources"
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/settings/pair')}
          >
            Pair new source
          </Button>
        }
        sx={{ mt: 0, mb: 2, px: 0 }}
      />
      {sourceList.length === 0 ? (
        <EmptyState
          icon={<LibraryAddOutlinedIcon />}
          title="No sources paired yet"
          body="Pair a Plex or Flixify source to start streaming."
          actionLabel="Pair your first source"
          onAction={() => navigate('/settings/pair')}
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {sourceList.map((src) => (
            <ElevatedCard key={src.id}>
              <SourceCard
                srcKey={String(src.id)}
                label={src.label}
                type={src.type}
                baseUrl={src.baseUrl}
                onUnpair={() => void unpair(src.id)}
                onRename={undefined}
              />
            </ElevatedCard>
          ))}
        </Box>
      )}
    </Box>
  );
}
