import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ThemeToggle } from '../../../components/organization-navigation';
export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  await auth.protect();
  const theme = (await cookies()).get('workspace-theme')?.value === 'dark' ? 'dark' : 'light';
  return (
    <div className="application-root" data-theme={theme}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="application-header">
        <Link href="/app" className="font-semibold">
          Business workspace
        </Link>
        <div className="header-actions">
          <ThemeToggle initial={theme} />
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
