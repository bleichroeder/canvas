import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SectionHeading } from '../../components/SectionHeading';
import { SourceCard } from '../../components/SourceCard';
import { EmptyState } from '../../components/EmptyState';
import { navigate } from '../../router';
import { getSources, removeSource, renameSource, SOURCES_EVENT } from '../../storage';
import type { StoredSource } from '../../storage';

export function SourcesTab() {
  const [sources, setLocalSources] = useState<Record<string, StoredSource>>(getSources());

  useEffect(() => {
    const onChange = () => setLocalSources(getSources());
    window.addEventListener(SOURCES_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(SOURCES_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  function unpair(key: string) {
    removeSource(key);
    setLocalSources({ ...getSources() });
  }

  function rename(key: string, newLabel: string) {
    renameSource(key, newLabel);
    setLocalSources({ ...getSources() });
  }

  const entries = Object.entries(sources);

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
      {entries.length === 0 ? (
        <EmptyState
          icon={<LibraryAddOutlinedIcon />}
          title="No sources paired yet"
          body="Pair a Plex or Flixify source to start streaming."
          actionLabel="Pair your first source"
          onAction={() => navigate('/settings/pair')}
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {entries.map(([key, src]) => (
            <ElevatedCard key={key}>
              <SourceCard
                srcKey={key}
                label={src.label}
                type={src.type}
                baseUrl={src.baseUrl}
                onUnpair={() => unpair(key)}
                onRename={(newLabel) => rename(key, newLabel)}
              />
            </ElevatedCard>
          ))}
        </Box>
      )}
    </Box>
  );
}
