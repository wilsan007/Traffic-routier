# Déploiement de l'API sur Railway (base de données Supabase)

L'API est déployée sur Railway ; la base de données et l'authentification
restent sur **Supabase**. Railway construit l'image via le `Dockerfile` racine
(détecté par `railway.json`).

## 1. Projet Railway
- https://railway.app → **New Project → Deploy from GitHub repo**
- Sélectionner le dépôt `Traffic-routier`.
- Railway détecte `railway.json` + `Dockerfile` automatiquement.

## 2. Variables d'environnement (service API → Variables)

> ⚠️ Ne PAS réutiliser d'anciens secrets présents dans l'historique Git.
> Générer des valeurs fraîches :
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```
NODE_ENV=production

# Base de données Supabase — utiliser le "Session pooler" (IPv4), port 5432.
# (Supabase → Project Settings → Database → Connection string → Session pooler)
DATABASE_URL=postgresql://postgres.<ref>:<mot-de-passe-encodé>@aws-0-<region>.pooler.supabase.com:5432/postgres

# Auth Supabase (le login vérifie les identifiants contre Supabase Auth)
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<clé publiable/anon Supabase>

# Secrets (OBLIGATOIRES en production — l'API refuse de démarrer sinon)
JWT_SECRET=<64 hex générés>
JWT_REFRESH_SECRET=<64 hex générés>
SERVICE_API_KEY=<48 hex générés>
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d

# Redis (optionnel — throttling. Ajouter un plugin Redis Railway si voulu)
# REDIS_URL=<auto-rempli par le plugin Redis Railway>

# CORS — autoriser le front web déployé (et * en démo)
CORS_ORIGINS=*

# Service ML (non déployé en démo — le healthcheck le traite comme optionnel)
ML_SERVICE_URL=http://localhost:8000

# Stockage images (laisser vide en démo = pas de S3)
S3_ENDPOINT=
S3_BUCKET=trafficguard-captures
S3_REGION=us-east-1
```

## 3. Déploiement
- Railway build + démarre automatiquement.
- Démarrage : `prisma migrate deploy` puis (seed non bloquant) puis l'API.
- Healthcheck : `GET /health` → 200 tant que la **base** répond (Redis/ML sont
  optionnels et ne bloquent pas le démarrage).
- URL type : `https://<service>.up.railway.app`
  - Vérifier `…/health` (doit renvoyer `"status":"ok"`)
  - Swagger : `…/docs`

## 4. Comptes de connexion
- **Comptes Supabase Auth** : créés dans Supabase → Authentication (doivent être
  *confirmés* ; le rôle se règle dans *User Metadata*, ex. `"role":"ADMIN"`).
- **Comptes de démonstration** (repli, créés par le seed) :
  - `admin@trafficguard.local` / `Admin123!`
  - `superviseur@trafficguard.local` / `Supervisor123!`
  - `agent@trafficguard.local` / `Officer123!`

## 5. Brancher les clients sur l'API déployée
- **Web** : variable de build `NEXT_PUBLIC_API_URL=https://<service>.up.railway.app`
  (service web séparé, `apps/web/Dockerfile`).
- **Mobile** : `apps/mobile/app.json` → `extra.apiUrl` = URL Railway, puis
  `eas build` (ou `EXPO_PUBLIC_API_URL` en dev).

## 6. Déploiement via CLI (alternative au GitHub)
```
npm i -g @railway/cli
railway login
railway link          # sélectionner le projet
railway up            # build + deploy depuis le code local
railway variables     # vérifier/ajuster les variables ci-dessus
```
