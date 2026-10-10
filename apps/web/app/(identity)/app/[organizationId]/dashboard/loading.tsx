export default function Loading() {
  return (
    <div role="status" aria-label="Loading analytics" className="analytics-loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="analytics-skeleton" />
      ))}
    </div>
  );
}
