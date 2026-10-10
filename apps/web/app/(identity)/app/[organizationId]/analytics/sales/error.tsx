'use client';
export default function ErrorState({ reset }: { reset: () => void }) {
  return (
    <div className="analytics-error" role="alert">
      <h2>Analytics could not be loaded</h2>
      <p>Please try again. Your filters remain in the address bar.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
