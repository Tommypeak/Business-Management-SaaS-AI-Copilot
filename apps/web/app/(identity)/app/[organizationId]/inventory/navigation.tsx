import Link from 'next/link';
export function Pagination({
  base,
  query,
  nextCursor,
}: {
  base: string;
  query: URLSearchParams;
  nextCursor: string | null;
}) {
  const next = new URLSearchParams(query);
  if (nextCursor) next.set('cursor', nextCursor);
  const first = new URLSearchParams(query);
  first.delete('cursor');
  return (
    <nav aria-label="Pagination" className="flex gap-5">
      {query.has('cursor') && (
        <Link href={`${base}?${first}`} className="underline">
          First page
        </Link>
      )}
      {nextCursor && (
        <Link href={`${base}?${next}`} className="button">
          Next page
        </Link>
      )}
    </nav>
  );
}
export function selectedQuery(
  search: Record<string, string | string[] | undefined>,
  keys: string[],
) {
  const query = new URLSearchParams({ limit: '25' });
  for (const key of keys) {
    const value = search[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  return query;
}
