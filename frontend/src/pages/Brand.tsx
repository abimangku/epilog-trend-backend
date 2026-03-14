import { useParams } from 'react-router-dom';

export function Brand() {
  const { name } = useParams<{ name: string }>();
  return (
    <div className="p-7">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Brand: {name}</h1>
      <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
    </div>
  );
}
