import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import type { ReactNode } from 'react';

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  await auth.protect();
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-5">
        <Link href="/app" className="font-semibold">
          Business Management
        </Link>
        <UserButton />
      </header>
      {children}
    </main>
  );
}
