'use client';

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="space-y-4">
      <h1 className="text-xl font-semibold">Unable to load this page</h1>
      <p>Please try again. Your access may have changed.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
