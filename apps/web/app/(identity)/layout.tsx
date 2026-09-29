import { ClerkProvider } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { authConfigured, clerkPublishableKey } from '../../lib/auth-config';

export const dynamic = 'force-dynamic';

export default function IdentityLayout({ children }: { children: ReactNode }) {
  if (!authConfigured())
    return (
      <main className="mx-auto max-w-3xl p-8">
        Sign-in is not configured. Contact the application administrator.
      </main>
    );
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey()}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
