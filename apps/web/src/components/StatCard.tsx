interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: 'blue' | 'red' | 'amber' | 'green' | 'slate';
}

const ACCENTS: Record<NonNullable<StatCardProps['accent']>, string> = {
  blue: 'bg-brand-50 text-brand-500',
  red: 'bg-red-50 text-red-500',
  amber: 'bg-amber-50 text-amber-500',
  green: 'bg-emerald-50 text-emerald-500',
  slate: 'bg-slate-100 text-slate-500',
};

export function StatCard({ label, value, icon, accent = 'blue' }: StatCardProps) {
  return (
    <div className="card animate-in flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-slate-500">{label}</p>
        <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-slate-900">{value}</p>
      </div>
      {icon && <div className={`rounded-xl p-2.5 ${ACCENTS[accent]}`}>{icon}</div>}
    </div>
  );
}
