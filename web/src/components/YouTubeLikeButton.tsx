import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import { ensureLikesLoaded, toggleLike, useIsLiked, type LikeableVideo } from '../lib/youtube-likes';
import { useEffect } from 'react';

export interface YouTubeLikeButtonProps {
  video: LikeableVideo;
  size?: 'small' | 'medium';
  /** Semi-opaque circular chip — for overlaying on a thumbnail. */
  overlay?: boolean;
}

export function YouTubeLikeButton({ video, size = 'small', overlay = false }: YouTubeLikeButtonProps) {
  useEffect(() => { void ensureLikesLoaded(); }, []);
  const liked = useIsLiked(video.ytId);

  return (
    <Tooltip title={liked ? 'Remove from Liked' : 'Add to Liked'}>
      <IconButton
        size={size}
        aria-label={liked ? 'Remove from Liked' : 'Add to Liked'}
        aria-pressed={liked}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); void toggleLike(video); }}
        sx={{
          color: liked ? '#ff3b3b' : overlay ? '#fff' : 'text.secondary',
          ...(overlay && {
            backgroundColor: 'rgba(0,0,0,0.55)',
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.75)' },
          }),
          '&:hover': { color: liked ? '#ff5c5c' : overlay ? '#fff' : 'text.primary' },
        }}
      >
        {liked ? <FavoriteIcon fontSize={size} /> : <FavoriteBorderIcon fontSize={size} />}
      </IconButton>
    </Tooltip>
  );
}
