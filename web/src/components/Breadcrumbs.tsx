import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useRoute, navigate } from '../router';
import { getLibraryName, getItemTitle } from '../storage';
import { useSources } from '../lib/SourcesContext';
import type { SourceKey } from '../lib/SourcesContext';

interface Crumb {
  label: string;
  href?: string;
}

function deriveCrumbs(path: string, getLabel: (key: SourceKey) => string | undefined): Crumb[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];

  // /source/:src
  if (parts[0] === 'source' && parts[1]) {
    crumbs.push({ label: getLabel(parts[1]) ?? parts[1] });
    return crumbs;
  }
  // /lib/:src/:libId — bare /lib/:src is deprecated (T7 redirects it)
  if (parts[0] === 'lib') {
    const src = parts[1];
    if (src) {
      crumbs.push({
        label: getLabel(src) ?? src,
        href: parts.length > 2 ? `/source/${src}` : undefined,
      });
    }
    if (parts[2]) {
      const name = getLibraryName(src!, parts[2]) ?? 'Library';
      crumbs.push({ label: name });
    }
    return crumbs;
  }
  // /item/:src/:id
  if (parts[0] === 'item' && parts[1] && parts[2]) {
    crumbs.push({ label: getLabel(parts[1]) ?? parts[1], href: `/source/${parts[1]}` });
    crumbs.push({ label: getItemTitle(parts[1], parts[2]) ?? 'Item' });
    return crumbs;
  }
  // /search
  if (parts[0] === 'search') {
    crumbs.push({ label: 'Search' });
    return crumbs;
  }
  // /settings, /settings/pair, /settings/users, /settings/devices
  if (parts[0] === 'settings') {
    crumbs.push({ label: 'Settings', href: parts[1] ? '/settings' : undefined });
    if (parts[1] === 'pair') crumbs.push({ label: 'Pair new source' });
    else if (parts[1] === 'users') crumbs.push({ label: 'Users' });
    else if (parts[1] === 'devices') crumbs.push({ label: 'Devices' });
    return crumbs;
  }
  // /pair (phone)
  if (parts[0] === 'pair') {
    crumbs.push({ label: 'Phone pair' });
    return crumbs;
  }
  return crumbs;
}

export function RouteBreadcrumbs() {
  const route = useRoute();
  const { sources } = useSources();
  const getLabel = (key: SourceKey) => sources[key]?.label;
  const crumbs = deriveCrumbs(route.path, getLabel);
  if (crumbs.length <= 1) return null;
  return (
    <Breadcrumbs
      separator={<ChevronRightIcon fontSize="small" />}
      sx={{ py: 0.5 }}
      aria-label="breadcrumb"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        if (last || !c.href) {
          return <Typography key={i} color="text.primary" variant="body2">{c.label}</Typography>;
        }
        return (
          <Link
            key={i}
            underline="hover"
            color="text.secondary"
            variant="body2"
            href={`#${c.href}`}
            onClick={(e) => { e.preventDefault(); navigate(c.href!); }}
          >
            {c.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
