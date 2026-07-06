import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

// Authentifie les services machine-à-machine (worker de flux vidéo du service
// ML) via l'en-tête x-api-key, sans compte utilisateur.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-api-key'];
    const expected = process.env.SERVICE_API_KEY ?? 'dev-service-key';
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Clé de service invalide');
    }
    return true;
  }
}
