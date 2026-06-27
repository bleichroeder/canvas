import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import AddIcon from '@mui/icons-material/Add';
import { AppShell } from '../components/AppShell';
import { navigate } from '../router';
import { getSources, removeSource, getPrefs, setPrefs } from '../storage';
import type { StoredSource, Prefs } from '../storage';

export function Settings() {
  const [sources, setLocalSources] = useState<Record<string, StoredSource>>({});
  const [prefs, setLocalPrefs] = useState<Prefs>(getPrefs());

  useEffect(() => {
    setLocalSources(getSources());
  }, []);

  function unpair(key: string) {
    removeSource(key);
    setLocalSources({ ...getSources() });
  }

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next: Prefs = { ...prefs, [key]: value };
    setLocalPrefs(next);
    setPrefs(next);
  }

  const entries = Object.entries(sources);
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';

  return (
    <AppShell>
      <Box sx={{ p: 2.5, maxWidth: 700 }}>
        <Typography variant="h3" sx={{ mb: 2 }}>Sources</Typography>
        {entries.length === 0 && (
          <Typography color="text.secondary">No sources paired yet.</Typography>
        )}
        {entries.map(([key, src]) => (
          <Box
            key={key}
            sx={{
              display: 'flex', alignItems: 'center', p: 1.5,
              backgroundColor: 'background.paper',
              border: '1px solid', borderColor: 'divider',
              borderRadius: 1, mb: 1,
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{src.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {src.type} · {src.baseUrl}
              </Typography>
            </Box>
            <Button variant="text" color="error" onClick={() => unpair(key)}>
              Unpair
            </Button>
          </Box>
        ))}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/settings/pair')}
          sx={{ mt: 1.5 }}
        >
          Pair new source
        </Button>

        <Typography variant="h3" sx={{ mt: 4, mb: 2 }}>Preferences</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={prefs.autoplayNext}
              onChange={(e) => update('autoplayNext', e.target.checked)}
            />
          }
          label="Autoplay next episode"
          sx={{ display: 'block', mb: 1.5 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={prefs.skipIntro}
              onChange={(e) => update('skipIntro', e.target.checked)}
            />
          }
          label="Skip intro automatically"
          sx={{ display: 'block', mb: 1.5 }}
        />

        <Typography variant="h3" sx={{ mt: 4, mb: 1 }}>About</Typography>
        <Typography variant="body2" color="text.secondary">
          canvas · v1.0 · build {buildSha}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Player engine · canvas/WebCodecs
        </Typography>
      </Box>
    </AppShell>
  );
}
