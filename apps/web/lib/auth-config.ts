import 'server-only';

// Read at request time: the same image can receive its public Clerk key at runtime.
export function clerkPublishableKey(): string | undefined {
  const keyName = 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY';
  return process.env[keyName];
}
export function authConfigured(): boolean {
  return Boolean(clerkPublishableKey() && process.env.CLERK_SECRET_KEY);
}
