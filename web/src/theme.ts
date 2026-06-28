import { createTheme } from '@mui/material/styles';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    background: {
      default: '#0e0f12',
      paper: '#181a1f',
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
    h2: { fontSize: 32, fontWeight: 600, letterSpacing: '0.5px' },
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
        root: { textTransform: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          transition: 'transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease',
          '&:has(.MuiCardActionArea-root:hover)': {
            borderColor: 'rgba(79, 142, 247, 0.35)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          },
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          transition: 'transform 200ms ease, box-shadow 200ms ease',
          '&:hover': {
            transform: 'translateY(-2px)',
          },
          '&:active': {
            transform: 'translateY(0)',
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
