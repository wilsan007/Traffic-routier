# Déploiement API sur Railway — Guide complet

## Étapes

### 1. Créer un compte Railway
- Allez sur https://railway.app
- Connectez-vous avec GitHub (ou créez un compte)

### 2. Nouveau projet → Deploy from GitHub repo
- Sélectionnez votre dépôt `gestion traffic routier`
- Railway détectera automatiquement le `railway.json` et le `Dockerfile`

### 3. Ajouter PostgreSQL
- Dans Railway → **New → Database → PostgreSQL**
- Railway crée automatiquement une variable `DATABASE_URL`
- Copiez cette URL

### 4. Ajouter Redis (optionnel pour le throttling)
- **New → Database → Redis**
- Copiez l'URL `REDIS_URL`

### 5. Configurer les variables d'environnement
Dans Railway → votre service API → **Variables**, ajoutez :

```
NODE_ENV=production
DATABASE_URL=<auto-rempli par Railway PostgreSQL>
REDIS_URL=<auto-rempli par Railway Redis>

# Secrets JWT (générés aléatoirement — ne PAS utiliser les valeurs par défaut)
JWT_SECRET=1035d56ba5886696d5e5033d10f8c63232133651990f0055a36cf09ad13b608a
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=0395081670668ed3c6012fdbe7f3f1728e4b50a63bb55cdcea46aba021488c7b
JWT_REFRESH_EXPIRES_IN=7d

# Clé de service (machine-à-machine)
SERVICE_API_KEY=b01463aea35c34917ae00bcd00b285dba1c183cccc25d708

# CORS — autoriser l'app mobile (capacitor/expo) + le web
CORS_ORIGINS=*

# Service ML (laissez localhost si pas déployé — le scan /captures/scan gérera l'absence)
ML_SERVICE_URL=http://localhost:8000

# Stockage images — utiliser le système de fichiers local (pas de S3 en démo)
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=trafficguard-captures
S3_REGION=us-east-1
```

### 6. Déployer
- Railway build et déploie automatiquement
- L'URL sera du type : `https://votre-api.up.railway.app`
- Vérifiez : `https://votre-api.up.railway.app/health` → doit retourner un statut OK
- Swagger : `https://votre-api.up.railway.app/docs`

### 7. Mettre à jour l'app mobile
Une fois l'URL Railway obtenue, mettez à jour `apps/mobile/app.json` :
```json
"apiUrl": "https://votre-api.up.railway.app"
```

### 8. Rebuilder l'APK
```bash
cd apps/mobile
eas build --platform android --profile preview --non-interactive
```

### 9. Compte de test
L'API seed crée un compte agent :
- Email : `agent@trafficguard.local`
- Mot de passe : `Officer123!`
