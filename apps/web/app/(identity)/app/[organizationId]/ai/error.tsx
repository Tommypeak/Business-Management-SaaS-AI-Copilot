'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <h1>AI Copilot is unavailable</h1>
      <p>Please retry loading this page.</p>
      <button className="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
