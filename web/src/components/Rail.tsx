import type { Item } from '../types';
import { PosterCard } from './PosterCard';

export interface RailProps {
  title: string;
  items: (Item & { source: string })[];
  cardWidth?: number;
}

export function Rail({ title, items, cardWidth = 180 }: RailProps) {
  if (items.length === 0) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ padding: '0 20px', fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>{title}</h2>
      <div style={{
        display: 'flex', gap: 12, overflowX: 'auto', padding: '0 20px',
        scrollSnapType: 'x mandatory',
      }}>
        {items.map((it) => (
          <div key={`${it.source}:${it.id}`} style={{ scrollSnapAlign: 'start' }}>
            <PosterCard item={it} source={it.source} width={cardWidth} />
          </div>
        ))}
      </div>
    </section>
  );
}
