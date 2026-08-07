import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { SectionHeading } from './SectionHeading';
import { PosterCard } from './PosterCard';
import { RailNavButton } from './RailNavButton';
import type { Item } from '../types';

export interface RailProps {
  title: string;
  items: (Item & { source: string })[];
  cardWidth?: number;
  showSourceBadge?: boolean;
  /** Optional element before the title (e.g. a channel avatar). */
  titlePrefix?: ReactNode;
  /** Optional control rendered at the end of the rail heading (e.g. unfollow). */
  action?: ReactNode;
  /** Override the card renderer (e.g. YouTube's 16:9 card). Defaults to PosterCard. */
  renderItem?: (item: Item & { source: string }) => ReactNode;
}

const GAP_PX = 20; // matches sx gap: 2.5 (8 * 2.5)

export function Rail({ title, items, cardWidth = 220, showSourceBadge = false, titlePrefix, action, renderItem }: RailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const hasFineHover = useMediaQuery('(hover: hover) and (pointer: fine)');

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items.length]);

  if (items.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (cardWidth + GAP_PX) * 3, behavior: 'smooth' });
  };

  return (
    <Box component="section" sx={{ mb: 4 }}>
      <SectionHeading title={title} sx={{ mt: 4, mb: 1.5 }} {...(titlePrefix ? { titlePrefix } : {})} {...(action ? { action } : {})} />
      <Box sx={{ position: 'relative' }}>
        <Box
          ref={scrollerRef}
          sx={{
            display: 'flex',
            gap: 2.5,
            overflowX: 'auto',
            px: 2.5,
            py: 1,
            scrollPaddingLeft: 20,
            scrollSnapType: 'x mandatory',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {items.map((it) => (
            <Box key={`${it.source}:${it.id}`} sx={{ scrollSnapAlign: 'start', contain: 'layout style' }}>
              {renderItem ? renderItem(it) : <PosterCard item={it} source={it.source} width={cardWidth} showSourceBadge={showSourceBadge} />}
            </Box>
          ))}
        </Box>
        {hasFineHover && (
          <>
            <RailNavButton direction="left" onClick={() => scrollBy(-1)} disabled={!canScrollLeft} />
            <RailNavButton direction="right" onClick={() => scrollBy(1)} disabled={!canScrollRight} />
          </>
        )}
      </Box>
    </Box>
  );
}
