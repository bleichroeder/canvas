import IconButton from '@mui/material/IconButton';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

interface RailNavButtonProps {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
}

export function RailNavButton({ direction, onClick, disabled }: RailNavButtonProps) {
  const Icon = direction === 'left' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <IconButton
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      sx={{
        position: 'absolute',
        top: '50%',
        [direction === 'left' ? 'left' : 'right']: 4,
        transform: 'translateY(-50%)',
        width: 40,
        height: 40,
        backgroundColor: 'rgba(14,15,18,0.85)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'text.primary',
        opacity: disabled ? 0 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        transition: 'opacity 220ms cubic-bezier(0.2,0,0,1), transform 220ms cubic-bezier(0.2,0,0,1), background-color 220ms cubic-bezier(0.2,0,0,1)',
        '&:hover': {
          backgroundColor: 'rgba(14,15,18,0.95)',
          transform: 'translateY(-50%) scale(1.05)',
        },
        zIndex: 2,
      }}
    >
      <Icon />
    </IconButton>
  );
}
