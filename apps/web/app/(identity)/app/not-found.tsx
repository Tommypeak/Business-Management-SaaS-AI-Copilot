import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Organization unavailable</h1>
      <p>It may not exist, or you may not have access.</p>
      <Link href="/app" className="underline">
        Back to your organizations
      </Link>
    </section>
  );
}
