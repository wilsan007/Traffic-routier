export type Role =
  | 'ADMIN'
  | 'SUPERVISOR'
  | 'OFFICER'
  | 'OPERATOR'
  | 'CASHIER'
  | 'TECHNICIAN'
  | 'AUDITOR';
export type LicenseStatus = 'VALID' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED' | 'UNKNOWN';
export type InsuranceStatus = 'VALID' | 'EXPIRED' | 'UNKNOWN';
export type CameraType = 'FIXED' | 'MOBILE';
export type InfractionSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';
export type InfractionStatus = 'PENDING' | 'PAID' | 'CONTESTED' | 'CANCELLED';
export type HotlistReason =
  | 'STOLEN_VEHICLE'
  | 'WANTED_PERSON'
  | 'BOLO'
  | 'SUSPENDED_REGISTRATION'
  | 'AMBER_ALERT'
  | 'OTHER';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
export type SearchType = 'PLATE' | 'OWNER' | 'VIN';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  badgeNumber?: string | null;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  year?: number | null;
  vin?: string | null;
  insuranceStatus: InsuranceStatus;
  technicalControlExpiresAt?: string | null;
  stolen: boolean;
}

export interface Owner {
  id: string;
  firstName: string;
  lastName: string;
  licenseStatus: LicenseStatus;
  licenseNumber?: string | null;
  nationalId?: string | null;
}

export interface HotlistEntry {
  id: string;
  plateNumber: string;
  reason: HotlistReason;
  priority: Priority;
  notes?: string | null;
  active: boolean;
  createdAt: string;
}

export interface Alert {
  id: string;
  status: AlertStatus;
  createdAt: string;
  hotlistEntry: HotlistEntry;
  capture: {
    id: string;
    imageUrl: string;
    plateNumberNormalized: string;
    capturedAt: string;
  };
}

export interface Infraction {
  id: string;
  type: string;
  description?: string | null;
  severity: InfractionSeverity;
  status: InfractionStatus;
  fineAmount?: number | null;
  points?: number | null;
  occurredAt: string;
}

export interface CaseItem {
  id: string;
  title: string;
  description?: string | null;
  status: CaseStatus;
  createdAt: string;
}
