import { createTheme } from '@mui/material/styles';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

declare module '@mui/material/styles' {
  interface Palette {
    surface: { elevated: string };
  }
  interface PaletteOptions {
    surface?: { elevated: string };
  }
  interface Theme {
    canvasMotion: { fast: string; med: string; slow: string; easing: string };
    canvasAmbient: string;
  }
  interface ThemeOptions {
    canvasMotion?: { fast: string; med: string; slow: string; easing: string };
    canvasAmbient?: string;
  }
}

export const theme = createTheme({
  cssVariables: true,
  canvasMotion: {
    fast: '150ms',
    med: '220ms',
    slow: '320ms',
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  canvasAmbient:
    'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.06), transparent 60%)',
  palette: {
    mode: 'dark',
    background: {
      default: '#0e0f12',
      paper: '#1c1f25',
    },
    surface: {
      elevated: '#22252d',
    },
    primary: {
      main: '#4f8ef7',
      dark: '#2d8cff',
      light: '#7eb1ff',
    },
    secondary: {
      main: '#f5a623',
    },
    text: {
      primary: '#f4f5f7',
      secondary: '#9aa0a8',
    },
    divider: '#2a2d36',
    error: {
      main: '#ef5350',
    },
    success: {
      main: '#67d391',
    },
  },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    h1: { fontSize: 40, fontWeight: 600, letterSpacing: '0.5px' },
    h2: { fontSize: 28, fontWeight: 600, letterSpacing: '0.5px' },
    h3: { fontSize: 20, fontWeight: 600, letterSpacing: '0.5px' },
    body1: { fontSize: 16, fontWeight: 400 },
    body2: { fontSize: 14, fontWeight: 400 },
    caption: { fontSize: 12, fontWeight: 500 },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          transition: 'transform 150ms cubic-bezier(0.2,0,0,1)',
          '&:active': {
            transform: 'scale(0.97)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          transition: 'border-color 220ms cubic-bezier(0.2,0,0,1), box-shadow 220ms cubic-bezier(0.2,0,0,1)',
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          transition: 'transform 220ms cubic-bezier(0.2,0,0,1), box-shadow 220ms cubic-bezier(0.2,0,0,1)',
          '&:hover': {
            transform: 'scale(1.03)',
          },
          '&:active': {
            transform: 'scale(0.97)',
            transition: 'transform 150ms cubic-bezier(0.2,0,0,1)',
          },
          '&.Mui-focusVisible': {
            outline: '2px solid #4f8ef7',
            outlineOffset: 4,
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: '2px solid #4f8ef7',
            outlineOffset: 2,
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.04), rgba(255,255,255,0))',
        },
      },
    },
  },
});
