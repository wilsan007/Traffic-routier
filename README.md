# TrafficGuard

Plateforme de gestion du trafic routier pour les forces de l'ordre : reconnaissance automatique de plaques d'immatriculation (ALPR/ANPR), gestion des véhicules et propriétaires, infractions, liste de surveillance (véhicules volés / personnes recherchées), alertes temps réel, dossiers d'incident, journal d'audit et statistiques.

## ⚠️ Statut du projet et cadre légal

Ce projet est une **plateforme complète et fonctionnelle**, mais construite avec sa **propre base de données autonome** (véhicules, propriétaires, infractions simulés). Elle ne se connecte à **aucune base de données gouvernementale réelle** (registre national d'immatriculation, INTERPOL, SIS, NCIC…) : ces intégrations nécessitent des accréditations légales que seule une administration compétente peut obtenir. L'architecture est conçue pour qu'un vrai registre soit branché plus tard via une API, sans changer le reste du système (voir `apps/api/src/regions` et `apps/api/src/vehicles`).

Avant tout déploiement réel, un cadre juridique doit être validé (protection des données, durée de rétention, droits des personnes filmées, autorisation préfectorale/judiciaire selon le pays).

## Fonctionnalités

| Domaine | Fonctionnalités |
|---|---|
| Capture ALPR | Upload image (caméra fixe/mobile), détection + OCR de plaque, géolocalisation, horodatage, score de confiance, file de vérification manuelle |
| Véhicules & propriétaires | Fiches véhicule/propriétaire, historique des propriétaires successifs, statut permis/assurance/contrôle technique |
| Infractions | Historique par véhicule/conducteur, gravité, amende, points, statut |
| Liste de surveillance & alertes | Véhicules volés, personnes recherchées, BOLO, correspondance temps réel via WebSocket |
| Dossiers | Rapports d'incident, notes, pièces jointes, assignation |
| Sécurité | Authentification JWT + refresh token (cookies httpOnly), rôles (agent/superviseur/admin), RBAC sur tous les endpoints, rate limiting, helmet, CORS restrictif, journal d'audit complet, traçabilité des recherches |
| Statistiques | Infractions par type/gravité, volume de captures, répartition des alertes par priorité |
| Interfaces | Dashboard web (Next.js) + application mobile terrain (Expo/React Native) |

## Architecture

```
apps/
  api/      NestJS + Prisma + PostgreSQL — cœur métier, auth, RBAC, WebSocket
  ml/       FastAPI + OpenCV + Tesseract — détection et lecture de plaques
  web/      Next.js — dashboard de supervision
  mobile/   Expo (React Native) — application terrain pour les agents
packages/
  shared/   Types TypeScript partagés entre web et mobile
```

Flux d'une capture : caméra/mobile → `POST /captures` (NestJS) → upload image (S3/MinIO) → appel au service ML (`/detect`) → normalisation de la plaque → recherche du véhicule en base → correspondance avec la liste de surveillance → création d'alerte + diffusion WebSocket → journal d'audit.

## Stack technique

- **Backend** : NestJS, TypeScript, Prisma, PostgreSQL, Redis (cache + rate limiting distribué), Socket.IO, JWT + refresh tokens, argon2, Helmet, rate limiting (Throttler + Redis storage), logging structuré (Pino), healthchecks (Terminus)
- **ML/OCR** : Python, FastAPI, OpenCV (détection de région), Tesseract (OCR) — pipeline pragmatique avec post-traitement regex configurable, conçu pour être remplacé par un modèle deep learning (YOLO + CRNN) entraîné en production
- **Web** : Next.js 14 (App Router), Tailwind CSS, Recharts, middleware de protection de routes, refresh token automatique
- **Mobile** : Expo, React Native, Expo Router, Expo Camera/Location, refresh token automatique
- **Infra** : Docker Compose (PostgreSQL, Redis, MinIO en S3-compatible, API, ML, Web) avec healthchecks, CI/CD GitHub Actions
- **Tests** : Jest (24 tests unitaires sur auth, captures, alerts, vehicles)

## Démarrage rapide

```bash
cp .env.example .env
docker compose up --build
```

Puis, dans un autre terminal, exécuter les migrations et le jeu de données de démonstration :

```bash
cd apps/api
npx prisma migrate deploy
npm run prisma:seed
```

- Web : http://localhost:3000
- API + documentation Swagger : http://localhost:3001/docs
- Service ML : http://localhost:8000/health
- Console MinIO : http://localhost:9001 (identifiants dans `.env`)

### Comptes de démonstration

| Rôle | Email | Mot de passe |
|---|---|---|
| Admin | admin@trafficguard.local | Admin123! |
| Superviseur | superviseur@trafficguard.local | Supervisor123! |
| Agent | agent@trafficguard.local | Officer123! |

### Application mobile

```bash
cd apps/mobile
npm install
npx expo start
```

Modifier `apps/mobile/app.json` (`expo.extra.apiUrl` / `wsUrl`) pour pointer vers l'IP de votre machine si vous testez sur un appareil physique (pas `localhost`).

## Développement local sans Docker

```bash
npm install
npm run prisma:generate
npm run dev:api     # apps/api sur :3001
npm run dev:web     # apps/web sur :3000
```

Le service ML nécessite Python 3.11 + Tesseract installés localement (`apps/ml/requirements.txt`), ou peut être lancé via `docker compose up ml`.

## Améliorations apportées (sécurité, robustesse, tests)

- **Sécurité** : CORS restrictif (configurable via `CORS_ORIGINS`), Helmet (headers HTTP), rate limiting distribué Redis (Throttler + `@nest-lab/throttler-storage-redis`), refresh token avec cookies `httpOnly`, `RolesGuard` sur tous les contrôleurs, filtre d'exceptions global
- **API** : logging structuré avec Pino, endpoint `/health` (Terminus + Redis ping), DTO validés, pagination générique, cookie-parser, cache Redis sur analytics et hotlist (avec invalidation)
- **ML** : post-traitement OCR avec nettoyage, validation regex configurable par région, scoring des candidats avec bonus de format
- **Frontend Web** : middleware Next.js pour protection de routes, composants `LoadingSpinner`/`ErrorBanner`/`EmptyState`, refresh token automatique sur 401, gestion d'erreur sur le dashboard
- **Mobile** : refresh token automatique, loading/error states sur tous les écrans (accueil, alertes, recherche), appel logout API
- **Infra** : healthchecks Docker Compose sur ML/API/Web, CI/CD GitHub Actions (lint + build + test)
- **Tests** : 24 tests unitaires couvrant AuthService (login, refresh, hash), VehiclesService (CRUD, transfert), AlertsService (création, acknowledge, resolve), CapturesService (ingestion, hotlist, verify)

## Limites connues / pistes de production

- **OCR** : pipeline OpenCV + Tesseract fonctionnel mais moins précis qu'un modèle entraîné dédié (type ALPR commercial). Le contrat de `POST /detect` reste stable si vous branchez un modèle plus performant.
- **Stockage** : MinIO en local ; remplacer par un vrai bucket S3 en production avec chiffrement et politique de rétention.
- **Intégrations gouvernementales** : à construire une fois les accréditations obtenues, en implémentant un nouvel adaptateur derrière `RegionsService`/`VehiclesService` sans changer le reste de l'API.
- **Tests E2E** : seuls les tests unitaires sont en place ; ajouter des tests d'intégration et E2E (Supertest, Playwright) pour une couverture complète.
