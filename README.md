# VoxPOC — Agent vocal IA sortant

Projet de fin d'études (DN MADE Numérique, Africa Design School, Cotonou — Bénin) :
prototype académique d'agent vocal IA capable de mener une conversation téléphonique
sortante de façon autonome, à partir d'un objectif défini par l'utilisateur, puis de
livrer un résumé structuré de l'échange.

Deux façons de tester l'agent :

- **Appel téléphonique réel** (Twilio Programmable Voice + Gemini Live API)
- **Démo navigateur** — micro/haut-parleurs du navigateur, sans aucune dépendance
  téléphonique ni compte Twilio, pour tester la conversation IA directement

## Architecture

```
voxpoc/
├── backend/    # Express + WebSocket, exposé en local via ngrok
└── frontend/   # React (Vite) multi-pages, déployé sur Vercel (gratuit)
```

- **Backend** : tourne en local sur votre machine, exposé via un tunnel **ngrok** (domaine
  statique gratuit) pour le pont Twilio. Aucun hébergement payant n'est requis.
- **Frontend** : site React multi-pages (Accueil + À propos, switch FR/EN) déployé sur
  **Vercel** (plan gratuit).
- **Téléphonie** : Twilio Programmable Voice + Media Streams (`backend/mediaStream.js`).
- **Démo navigateur** : même logique de conversation, sans Twilio — WebSocket direct
  navigateur ⇄ backend (`backend/browserStream.js`, `frontend/src/audioClient.js`).
- **IA vocale temps réel** : connexion WebSocket directe à la Gemini Live API
  (`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`).
- **Raccrochage fiable** : l'agent dispose d'une fonction `end_call` (function calling
  Gemini Live) pour raccrocher réellement en fin de conversation — avec un mécanisme
  `mark` Twilio pour attendre la fin de la lecture audio avant de couper (pas de phrase
  coupée), et un filet de sécurité par détection de silence prolongé si le modèle
  n'appelle jamais la fonction.
- **Transcodage audio** (appel téléphonique uniquement) : Twilio envoie/attend du G.711
  mu-law 8kHz, alors que Gemini Live parle en PCM16 linéaire (16kHz en entrée, 24kHz en
  sortie). `backend/audioUtils.js` convertit l'audio dans les deux sens — la démo
  navigateur n'en a pas besoin, le PCM16 natif du navigateur correspond déjà.

## Prérequis

- Node.js 18+
- Un compte Twilio (le plan **trial** fonctionne, voir contrainte ci-dessous)
- Une clé API Gemini (obtenue gratuitement sur Google AI Studio, **aucune carte bancaire
  requise**)
- [ngrok](https://ngrok.com/) installé et authentifié (`ngrok config add-authtoken ...`),
  idéalement avec un domaine statique gratuit réservé sur votre compte ngrok

## ⚠️ Contraintes côté compte Twilio

Si votre compte Twilio est en mode **essai (trial)** :

- Vous ne pouvez appeler que des numéros **vérifiés manuellement** dans la console Twilio
  (Console → Phone Numbers → Verified Caller IDs).
- Twilio insère automatiquement un message d'avertissement ("You have a trial account...")
  en tout début d'appel, avant que le flux ne soit connecté à l'agent IA. C'est un
  comportement Twilio non contournable en trial — le code fonctionne tel quel avec cette
  limitation.

Sur un compte payant ("Full"), ces deux limites disparaissent, mais deux autres points à
prévoir :

- **Permissions géographiques d'appel** : Twilio désactive par défaut les appels sortants
  vers de nombreux pays (anti-fraude). Si un appel échoue avec *"Account not authorized to
  call..."*, il faut activer le pays visé — Console → Voice → Geo Permissions, ou via
  l'API `POST /v1/DialingPermissions/BulkCountryUpdates` (voir
  [doc Twilio](https://www.twilio.com/docs/voice/api/dialingpermissions-bulkcountryupdate-resource)).
- **Revue anti-fraude sur les comptes récents** : l'achat d'un numéro ou même l'usage du
  compte peuvent être bloqués temporairement le temps qu'une équipe compliance Twilio
  valide l'usage prévu (Trust Hub, puis email de suivi si besoin). C'est indépendant du
  code de ce projet — seul un échange avec le support Twilio débloque la situation.

## Obtenir la clé API Gemini

1. Créer un compte sur [Google AI Studio](https://aistudio.google.com/) (aucune carte
   bancaire requise).
2. **Get API key** → **Create API key** → copier la clé générée (`GEMINI_API_KEY`).
3. Le modèle vocal utilisé par défaut (`gemini-3.1-flash-live-preview`) est un modèle
   **preview** : son nom peut changer. En cas d'erreur du type "model not found",
   vérifiez le nom du modèle Live actuel dans la
   [documentation Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) et
   mettez à jour `GEMINI_LIVE_MODEL` dans `backend/.env` (même chose pour
   `GEMINI_TEXT_MODEL` si `gemini-3.6-flash` venait aussi à être déprécié).
4. Le tier gratuit a des limites de requêtes par minute assez basses — suffisant pour un
   POC avec quelques appels de test, mais pensez-y si vous enchaînez les essais rapidement.

## 1. Installation

```bash
cd backend
npm install

cd ../frontend
npm install
```

## 2. Configuration du backend

```bash
cd backend
copy .env.example .env
```

Remplissez `.env` :

```
TWILIO_ACCOUNT_SID=...       # depuis la console Twilio
TWILIO_AUTH_TOKEN=...        # depuis la console Twilio
TWILIO_PHONE_NUMBER=+1...    # votre numéro Twilio
GEMINI_API_KEY=...           # depuis Google AI Studio
PUBLIC_BACKEND_URL=          # à remplir après avoir lancé ngrok (étape 4)
FRONTEND_URL=                # à remplir après déploiement Vercel (étape 6), ou http://localhost:5173 pour tester en local
PORT=3000
```

## 3. Lancer le backend en local

```bash
cd backend
npm run dev
```

Le serveur démarre sur `http://localhost:3000`.

## 4. Exposer le backend avec ngrok

Dans un autre terminal :

```bash
ngrok http --domain=mon-nom.ngrok-free.app 3000
```

(Remplacez `mon-nom.ngrok-free.app` par votre domaine statique gratuit ngrok, ou omettez
`--domain` pour une URL aléatoire temporaire — dans ce cas il faudra la remettre à jour à
chaque redémarrage de ngrok.)

Copiez l'URL HTTPS générée (ex: `https://mon-nom.ngrok-free.app`) dans `backend/.env` :

```
PUBLIC_BACKEND_URL=https://mon-nom.ngrok-free.app
```

**Redémarrez le backend** (`npm run dev`) après avoir mis à jour `.env` pour que la
variable soit prise en compte.

## 5. Tester le frontend en local

```bash
cd frontend
copy .env.example .env
```

Dans `frontend/.env` :

```
VITE_BACKEND_URL=https://mon-nom.ngrok-free.app
```

Puis :

```bash
npm run dev
```

Ouvrez `http://localhost:5173` :

- Onglet **Appel téléphonique** : remplissez le formulaire avec un **numéro vérifié dans
  Twilio** (si compte trial) au format E.164 (ex: `+33612345678`), et lancez l'appel.
- Onglet **Démo navigateur** : saisissez l'objet de l'appel, cliquez sur "Démarrer" et
  autorisez le micro — aucun numéro ni compte Twilio nécessaire, votre micro/haut-parleurs
  jouent le rôle de l'interlocuteur.

Le switch **FR/EN** en haut de page traduit toute l'interface (persisté en local via
`localStorage`), et la page **À propos** explique le projet, son fonctionnement, et la
politique de consentement/données.

## 6. Déployer le frontend sur Vercel

```bash
cd frontend
```

- Poussez le dossier `frontend/` sur un dépôt Git, puis importez-le dans
  [Vercel](https://vercel.com/new), **ou** utilisez la CLI :

```bash
npm install -g vercel
vercel
```

- Dans les paramètres du projet Vercel, ajoutez la variable d'environnement :
  - `VITE_BACKEND_URL` = votre URL ngrok (`https://mon-nom.ngrok-free.app`) — **pas**
    `http://localhost:3000` : le site déployé sur Vercel tourne dans le navigateur du
    visiteur, il ne peut donc pas atteindre `localhost`. Le tunnel ngrok doit rester actif
    pour que le site déployé fonctionne (les deux modes, appel téléphonique et démo
    navigateur, passent par le backend).
- Redéployez si besoin après l'ajout de la variable.

- Une fois l'URL Vercel obtenue (ex: `https://voxpoc.vercel.app`), reportez-la dans
  `backend/.env` — `FRONTEND_URL` accepte plusieurs origines séparées par des virgules,
  pratique pour garder le site en prod et `localhost:5173` en dev fonctionnels en même
  temps :

```
FRONTEND_URL=https://voxpoc.vercel.app,http://localhost:5173
```

Redémarrez le backend pour que le CORS autorise ces origines.

## Fonctionnement

### Appel téléphonique (Twilio)

1. L'utilisateur remplit le formulaire (numéro + objet) sur le frontend.
2. `POST /api/call` sur le backend crée un enregistrement d'appel et déclenche un appel
   Twilio sortant, en pointant Twilio vers `POST /twiml/:callId`.
3. Twilio appelle `/twiml/:callId`, qui renvoie un TwiML `<Connect><Stream>` établissant
   un flux audio WebSocket vers `/media-stream`, avec l'objet de l'appel en paramètre
   personnalisé.
4. Le backend ouvre en parallèle une connexion WebSocket vers la Gemini Live API, configure
   la session avec des instructions générées dynamiquement à partir de l'objet, et fait
   transiter l'audio dans les deux sens (Twilio ⇄ Gemini), avec conversion de format audio
   au passage (`audioUtils.js`).
5. La transcription de la conversation (fournie par Gemini) est accumulée en mémoire.
6. Quand l'agent estime la conversation terminée, il appelle la fonction `end_call`
   (function calling Gemini Live) ; le backend attend (via un `mark` Twilio) que l'audio
   déjà envoyé ait fini de jouer, puis raccroche réellement l'appel via l'API Twilio. Si
   l'agent n'appelle jamais cette fonction, un filet de sécurité raccroche après 15
   secondes de silence détecté.
7. À la fin de l'appel (event `stop` de Twilio, ou fermeture de la connexion), le backend
   génère un résumé structuré via l'API Gemini (`generateContent` classique) et le stocke.
8. Le frontend, qui fait un polling toutes les 3 secondes sur
   `GET /api/call/:callId/status`, affiche le résumé dès qu'il est disponible.

### Démo navigateur

Même logique (instructions dynamiques, résumé, `end_call`) via `POST /api/browser-session`
puis un WebSocket direct navigateur ⇄ backend ⇄ Gemini (`/browser-stream`) — le micro et
les haut-parleurs du navigateur remplacent Twilio comme source/destination audio, avec la
transcription affichée en direct pendant l'échange.

## Limitations du POC

- Stockage en mémoire uniquement (`Map`) — perdu au redémarrage du backend, pas de
  persistance multi-instance.
- Pas d'authentification sur les endpoints.
- Le backend doit rester allumé (et le tunnel ngrok actif, pour l'appel téléphonique)
  pendant toute la durée d'un appel.
- Le rééchantillonnage audio (8kHz ↔ 16/24kHz) dans `audioUtils.js` est volontairement
  simple (interpolation/moyenne linéaire) pour rester en pur JS sans dépendance native —
  qualité correcte pour un appel téléphonique, mais pas optimale. La démo navigateur n'a
  pas cette limitation (PCM16 natif de bout en bout).
- `GEMINI_LIVE_MODEL` pointe vers un modèle **preview** dont le nom peut changer côté
  Google ; voir la section "Obtenir la clé API Gemini" en cas d'erreur.
- Le raccrochage fiable (`end_call` + filet de sécurité) réduit le risque mais ne garantit
  pas à 100% qu'un appel se termine exactement au bon moment — le function calling d'un
  LLM n'est jamais parfaitement déterministe.

## Consentement et données

Ce projet est un prototype académique : aucune donnée personnelle réelle n'est collectée,
les scénarios utilisés sont fictifs. Les appels téléphoniques ne doivent être passés que
vers des numéros contrôlés par l'utilisateur du projet, ou avec le consentement explicite
de la personne appelée. La conception s'inspire des principes de protection des données de
l'Autorité de Protection des Données à caractère Personnel du Bénin (APDP).
