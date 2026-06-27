import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useRoute, navigate } from '../router';
import { getSourceLabel, getLibraryName } from '../storage';

interface Crumb {
  label: string;
  href?: string;
}

function deriveCrumbs(path: string): Crumb[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];

  // /lib/:src
  // /lib/:src/:libId
  if (parts[0] === 'lib') {
    const src = parts[1];
    if (src) {
      crumbs.push({
        label: getSourceLabel(src) ?? src,
        href: parts.length > 2 ? `/lib/${src}` : undefined,
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
    crumbs.push({ label: getSourceLabel(parts[1]) ?? parts[1], href: `/lib/${parts[1]}` });
    // item title isn't known at this layer — view sets document.title or could push state.
    crumbs.push({ label: 'Item' });
    return crumbs;
  }
  // /search
  if (parts[0] === 'search') {
    crumbs.push({ label: 'Search' });
    return crumbs;
  }
  // /settings, /settings/pair
  if (parts[0] === 'settings') {
    crumbs.push({ label: 'Settings', href: parts[1] ? '/settings' : undefined });
    if (parts[1] === 'pair') crumbs.push({ label: 'Pair new source' });
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
  const crumbs = deriveCrumbs(route.path);
  if (crumbs.length <= 1) return null;
  return (
    <Breadcrumbs
      separator={<ChevronRightIcon fontSize="small" />}
      sx={{ px: 2.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
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
