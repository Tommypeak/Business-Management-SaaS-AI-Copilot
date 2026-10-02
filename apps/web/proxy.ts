import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { authConfigured, clerkPublishableKey } from './lib/auth-config';

const protectedRoute = createRouteMatcher(['/app(.*)']);
const middleware = clerkMiddleware(
  async (auth, request) => {
    if (protectedRoute(request)) await auth.protect();
  },
  () => ({ publishableKey: clerkPublishableKey(), signInUrl: '/sign-in', signUpUrl: '/sign-up' }),
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!authConfigured())
    return new NextResponse('Sign-in is not configured. Contact the application administrator.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  return middleware(request, event);
}

export const config = { matcher: ['/app/:path*', '/sign-in/:path*', '/sign-up/:path*'] };
