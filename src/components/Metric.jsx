export function Metric({ label, value, alert = false }) {
  return (
    <div className={alert ? "metric alert" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
