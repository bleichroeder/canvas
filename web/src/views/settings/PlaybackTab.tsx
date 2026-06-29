import { useState } from 'react';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { getPrefs, setPrefs } from '../../storage';
import type { Prefs } from '../../storage';

export function PlaybackTab() {
  const [prefs, setLocalPrefs] = useState<Prefs>(getPrefs());

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next: Prefs = { ...prefs, [key]: value };
    setLocalPrefs(next);
    setPrefs(next);
  }

  return (
    <ElevatedCard>
      <SettingRow
        label="Autoplay next episode"
        control={
          <Switch
            checked={prefs.autoplayNext}
            onChange={(e) => update('autoplayNext', e.target.checked)}
          />
        }
      />
      <SettingRow
        label="Skip intro automatically"
        control={
          <Switch
            checked={prefs.skipIntro}
            onChange={(e) => update('skipIntro', e.target.checked)}
          />
        }
      />
      <SettingRow
        label="Default subtitle language"
        control={
          <TextField
            select
            size="small"
            value={prefs.defaultSubLang}
            onChange={(e) => update('defaultSubLang', e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="eng">English</MenuItem>
            <MenuItem value="spa">Spanish</MenuItem>
            <MenuItem value="fre">French</MenuItem>
            <MenuItem value="deu">German</MenuItem>
          </TextField>
        }
      />
      <SettingRow
        label="Default audio language"
        divider={false}
        control={
          <TextField
            select
            size="small"
            value={prefs.defaultAudioLang}
            onChange={(e) => update('defaultAudioLang', e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">Original</MenuItem>
            <MenuItem value="eng">English</MenuItem>
            <MenuItem value="spa">Spanish</MenuItem>
            <MenuItem value="fre">French</MenuItem>
            <MenuItem value="deu">German</MenuItem>
          </TextField>
        }
      />
    </ElevatedCard>
  );
}
