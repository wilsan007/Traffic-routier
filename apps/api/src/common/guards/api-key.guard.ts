import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

// Authentifie les services machine-à-machine (worker de flux vidéo du service
// ML) via l'en-tête x-api-key, sans compte utilisateur.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-api-key'];
    const expected = process.env.SERVICE_API_KEY ?? 'dev-service-key';

    if (typeof provided !== 'string' || !ApiKeyGuard.safeCompare(provided, expected)) {
      throw new UnauthorizedException('Clé de service invalide');
    }
    return true;
  }

  // Comparaison en temps constant pour éviter une fuite d'information sur la
  // clé attendue via une attaque temporelle (timing attack) sur la réponse.
  private static safeCompare(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) {
      // Effectue quand même une comparaison de durée comparable pour ne pas
      // révéler la longueur attendue via le temps de réponse.
      timingSafeEqual(expectedBuf, expectedBuf);
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
