export function ProviderIcon({
  iconUrl, name, fallback,
}: {
  iconUrl: string | null;
  name: string;
  fallback?: string;
}) {
  const label = (fallback?.match(/[A-Za-z0-9]/)?.[0]
    || name.match(/[A-Za-z0-9]/)?.[0]
    || "•").toUpperCase();
  return (
    <span className="provider-icon" aria-hidden="true">
      <span className="provider-icon-letter">{label}</span>
      {iconUrl ? (
        <span
          className="provider-icon-art"
          style={{ backgroundImage: `url("${iconUrl.replace(/"/g, "%22")}")` }}
        />
      ) : null}
    </span>
  );
}
