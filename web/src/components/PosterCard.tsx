import { Link } from '../router';
import type { Item } from '../types';

export interface PosterCardProps {
  item: Item;
  source: string;
  width?: number;
}

export function PosterCard({ item, source, width = 180 }: PosterCardProps) {
  const isFolder = item.type === 'folder';
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${item.id}`;
  const aspectRatio = item.type === 'episode' ? 16 / 9 : 2 / 3;
  return (
    <Link to={href} style={{ display: 'block', flexShrink: 0, width }}>
      <div style={{
        width,
        aspectRatio: String(aspectRatio),
        background: 'var(--row)',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundImage: item.poster ? `url(${item.poster})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }} />
      <div style={{ marginTop: 8, color: 'var(--fg)', fontSize: 14, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.title}
      </div>
      {item.year ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.year}</div> : null}
    </Link>
  );
}
