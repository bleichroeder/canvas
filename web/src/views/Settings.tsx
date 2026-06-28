import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import AddIcon from '@mui/icons-material/Add';
import { AppShell } from '../components/AppShell';
import { SourceCard } from '../components/SourceCard';
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
        <Typography variant="h1" sx={{ mb: 3 }}>Settings</Typography>

        <Typography variant="h3" sx={{ mb: 2 }}>Sources</Typography>
        {entries.length === 0 && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>No sources paired yet.</Typography>
        )}
        {entries.map(([key, src]) => (
          <SourceCard
            key={key}
            srcKey={key}
            label={src.label}
            type={src.type}
            baseUrl={src.baseUrl}
            onUnpair={() => unpair(key)}
          />
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
        <Box sx={{ p: 2, backgroundColor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={prefs.autoplayNext}
                onChange={(e) => update('autoplayNext', e.target.checked)}
              />
            }
            label="Autoplay next episode"
            sx={{ display: 'flex', mb: 1.5 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs.skipIntro}
                onChange={(e) => update('skipIntro', e.target.checked)}
              />
            }
            label="Skip intro automatically"
            sx={{ display: 'flex', mb: 1.5 }}
          />
          <FormControl size="small" sx={{ minWidth: 200, mb: 1.5, display: 'block' }}>
            <InputLabel id="default-sub-lang-label">Default subtitle language</InputLabel>
            <Select
              labelId="default-sub-lang-label"
              id="default-sub-lang"
              value={prefs.defaultSubLang}
              label="Default subtitle language"
              onChange={(e) => update('defaultSubLang', e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              <MenuItem value="eng">English</MenuItem>
              <MenuItem value="spa">Spanish</MenuItem>
              <MenuItem value="fre">French</MenuItem>
              <MenuItem value="deu">German</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200, display: 'block' }}>
            <InputLabel id="default-audio-lang-label">Default audio language</InputLabel>
            <Select
              labelId="default-audio-lang-label"
              id="default-audio-lang"
              value={prefs.defaultAudioLang}
              label="Default audio language"
              onChange={(e) => update('defaultAudioLang', e.target.value)}
            >
              <MenuItem value="">Original</MenuItem>
              <MenuItem value="eng">English</MenuItem>
              <MenuItem value="spa">Spanish</MenuItem>
              <MenuItem value="fre">French</MenuItem>
              <MenuItem value="deu">German</MenuItem>
            </Select>
          </FormControl>
        </Box>

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
