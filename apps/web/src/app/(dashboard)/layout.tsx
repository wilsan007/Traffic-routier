import { ProtectedShell } from '@/components/ProtectedShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedShell>{children}</ProtectedShell>;
}
