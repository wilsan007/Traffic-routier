export const INFRACTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  PENDING: 'À valider',
  PENDING_REVIEW: 'À valider',
  VALIDATED: 'Validé',
  REJECTED: 'Rejeté',
  NOTIFIED: 'Notifié',
  PAID: 'Payé',
  CONTESTED: 'Contesté',
  CANCELLED: 'Annulé',
  CLOSED: 'Clôturé',
};

export const INFRACTION_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-50 text-amber-700',
  PENDING_REVIEW: 'bg-amber-50 text-amber-700',
  VALIDATED: 'bg-blue-50 text-blue-700',
  REJECTED: 'bg-red-50 text-red-700',
  NOTIFIED: 'bg-indigo-50 text-indigo-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  CONTESTED: 'bg-orange-50 text-orange-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
  CLOSED: 'bg-slate-200 text-slate-600',
};
