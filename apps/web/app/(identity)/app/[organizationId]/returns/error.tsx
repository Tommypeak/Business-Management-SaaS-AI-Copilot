'use client';
export default function ReturnError({ reset }: { reset: () => void }) {
  return (
    <section className="panel space-y-3" role="alert">
      <h2 className="font-semibold">Customer operations are unavailable</h2>
      <p>Review the filters or refresh to try again. Your recorded documents remain saved.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
