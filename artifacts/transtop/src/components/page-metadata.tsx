import { useLocation } from 'wouter';
import { detailPath } from '@/lib/page-metadata';
import { usePageMetadata } from '@/lib/use-page-metadata';

export function StaticPageMetadata() {
  const [path] = useLocation();
  // Detail screens supply their fetched identities, without a duplicate API call.
  return detailPath(path) ? null : <StaticMetadata path={path} />;
}

function StaticMetadata({ path }: { path: string }) {
  usePageMetadata(path);
  return null;
}
