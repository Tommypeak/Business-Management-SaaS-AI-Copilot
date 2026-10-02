import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-20">
      <h1 className="text-3xl font-semibold">Business Management SaaS + AI Copilot</h1>
      <p className="mt-4 text-slate-600">System status: Running</p>
      <nav className="mt-6 flex gap-5">
        <Link className="underline" href="/app">
          Open application
        </Link>
        <Link className="underline" href="/sign-in">
          Sign in
        </Link>
        <Link className="underline" href="/sign-up">
          Sign up
        </Link>
      </nav>
    </main>
  );
}
