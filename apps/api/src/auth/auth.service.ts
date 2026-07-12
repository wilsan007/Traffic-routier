import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

// Hash factice (calculé une seule fois) utilisé pour égaliser le temps de
// réponse lorsqu'aucun compte ne correspond, afin de ne pas révéler par
// mesure de temps (timing attack) si un e-mail existe en base.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(randomBytes(16).toString('hex'));
  }
  return dummyHashPromise;
}

// Objet utilisateur renvoyé par l'API GoTrue de Supabase (champs utiles).
interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  // URL + clé publiable Supabase. On accepte les variables serveur
  // (SUPABASE_URL / SUPABASE_ANON_KEY) comme celles exposées au web
  // (NEXT_PUBLIC_*) déjà présentes dans .env, pour n'avoir qu'une source.
  private get supabaseUrl(): string | undefined {
    return (
      this.config.get<string>('SUPABASE_URL') ??
      this.config.get<string>('NEXT_PUBLIC_SUPABASE_URL')
    );
  }

  private get supabaseKey(): string | undefined {
    return (
      this.config.get<string>('SUPABASE_ANON_KEY') ??
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY') ??
      this.config.get<string>('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ??
      this.config.get<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    );
  }

  async login(email: string, password: string, ipAddress?: string) {
    // 1) Authentification prioritaire via Supabase Auth (comptes créés dans
    //    Supabase). En cas de succès on synchronise un profil local afin de
    //    conserver rôles, audit et clés étrangères de l'application.
    let user: User | null = null;

    const supabaseUser = await this.verifyWithSupabase(email, password);
    if (supabaseUser) {
      user = await this.syncSupabaseUser(supabaseUser, email);
    } else {
      // 2) Repli : table User locale + argon2 (comptes de démonstration issus
      //    du seed, ou comptes créés directement dans la base).
      user = await this.verifyLocalPassword(email, password);
    }

    if (!user || !user.active) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'change-me-refresh-secret',
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      },
    );

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        badgeNumber: user.badgeNumber,
      },
    };
  }

  /**
   * Vérifie les identifiants directement auprès de Supabase Auth (endpoint
   * GoTrue « password grant »). Renvoie l'utilisateur Supabase si valides,
   * `null` si identifiants invalides ou si Supabase n'est pas configuré /
   * joignable (on laisse alors le repli local décider).
   */
  private async verifyWithSupabase(
    email: string,
    password: string,
  ): Promise<SupabaseAuthUser | null> {
    const url = this.supabaseUrl;
    const key = this.supabaseKey;
    if (!url || !key) return null;

    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        const data = (await res.json()) as { user?: SupabaseAuthUser };
        return data.user ?? null;
      }

      // Réponse d'erreur : compte non confirmé -> message explicite ;
      // identifiants invalides -> on tente le repli local silencieusement.
      const err = (await res.json().catch(() => ({}))) as {
        error_code?: string;
        msg?: string;
      };
      if (err.error_code === 'email_not_confirmed') {
        throw new UnauthorizedException(
          "Ce compte Supabase n'est pas encore confirmé. Confirmez l'e-mail (ou activez « Auto Confirm » dans Supabase).",
        );
      }
      return null;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Supabase injoignable : on ne bloque pas les comptes locaux.
      this.logger.warn(`Supabase Auth injoignable, repli local : ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Crée ou met à jour le profil local correspondant à un utilisateur
   * Supabase. Le rôle est lu depuis les métadonnées Supabase
   * (`app_metadata.role` puis `user_metadata.role`), OFFICER par défaut.
   */
  private async syncSupabaseUser(
    supabaseUser: SupabaseAuthUser,
    email: string,
  ): Promise<User> {
    const meta = {
      ...(supabaseUser.user_metadata ?? {}),
      ...(supabaseUser.app_metadata ?? {}),
    };

    const role = this.mapRole(meta['role']);
    const { firstName, lastName } = this.deriveName(meta, email);
    const badgeNumber =
      typeof meta['badge_number'] === 'string' ? (meta['badge_number'] as string) : undefined;

    return this.prisma.user.upsert({
      where: { email },
      // À la connexion suivante on rafraîchit le rôle depuis Supabase (source
      // de vérité) mais on ne touche pas au passwordHash local.
      update: { role, active: true },
      create: {
        email,
        // Le mot de passe est géré par Supabase : on stocke un hash aléatoire
        // inutilisable localement (la colonne est obligatoire).
        passwordHash: await argon2.hash(randomBytes(24).toString('hex')),
        firstName,
        lastName,
        role,
        ...(badgeNumber ? { badgeNumber } : {}),
      },
    });
  }

  /** Repli : vérification contre la table User locale (argon2). */
  private async verifyLocalPassword(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      // Vérifie quand même contre un hash factice : évite qu'un attaquant
      // puisse énumérer les comptes existants en mesurant le temps de réponse.
      const dummyHash = await getDummyHash();
      await argon2.verify(dummyHash, password).catch(() => undefined);
      return null;
    }
    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);
    return passwordValid ? user : null;
  }

  private mapRole(raw: unknown): Role {
    if (typeof raw === 'string') {
      const upper = raw.toUpperCase();
      if ((Object.values(Role) as string[]).includes(upper)) {
        return upper as Role;
      }
    }
    return Role.OFFICER;
  }

  private deriveName(
    meta: Record<string, unknown>,
    email: string,
  ): { firstName: string; lastName: string } {
    const first = meta['first_name'] ?? meta['firstName'] ?? meta['given_name'];
    const last = meta['last_name'] ?? meta['lastName'] ?? meta['family_name'];
    if (typeof first === 'string' && first) {
      return { firstName: first, lastName: typeof last === 'string' ? last : '' };
    }
    const full = meta['full_name'] ?? meta['name'];
    if (typeof full === 'string' && full.trim()) {
      const parts = full.trim().split(/\s+/);
      return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
    }
    // Dernier recours : partie locale de l'e-mail.
    return { firstName: email.split('@')[0], lastName: '' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'change-me-refresh-secret',
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Token invalide');
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.active) {
        throw new UnauthorizedException('Utilisateur invalide');
      }

      const accessToken = await this.jwt.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return { accessToken };
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }
  }

  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }
}
