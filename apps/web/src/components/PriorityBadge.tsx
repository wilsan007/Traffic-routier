const STYLES: Record<string, { badge: string; dot: string; label: string }> = {
  LOW: { badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', label: 'Faible' },
  MEDIUM: { badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', label: 'Moyenne' },
  HIGH: { badge: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', label: 'Élevée' },
  CRITICAL: { badge: 'bg-red-50 text-red-700', dot: 'bg-red-500', label: 'Critique' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const style = STYLES[priority] ?? STYLES.LOW;
  return (
    <span className={`badge ${style.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${priority === 'CRITICAL' ? 'alert-pulse' : ''}`} />
      {style.label}
    </span>
  );
}
