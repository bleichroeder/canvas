import { useEffect, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { SOURCE_ADDED_EVENT } from '../storage';
import { navigate } from '../router';

/**
 * Brief toast confirming a new source was paired, with a reminder that
 * sources can be removed later. Listens for SOURCE_ADDED_EVENT (dispatched
 * by addSource) — fires for both in-car pair and phone-pair completions.
 */
export function SourceAddedSnackbar() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const onAdded = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: { label?: string } }>).detail;
      setLabel(detail?.source?.label ?? null);
    };
    window.addEventListener(SOURCE_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(SOURCE_ADDED_EVENT, onAdded);
  }, []);

  const open = label !== null;
  const message = label
    ? `${label} paired. You can remove sources any time in Settings.`
    : 'Source paired. You can remove sources any time in Settings.';

  return (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={() => setLabel(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity="success"
        variant="filled"
        onClose={() => setLabel(null)}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => { setLabel(null); navigate('/settings'); }}
          >
            Settings
          </Button>
        }
        sx={{ alignItems: 'center' }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
