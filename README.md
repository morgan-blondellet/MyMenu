# MyMenu

Recettes filtrables par saison et par ingrédient, menus de la semaine et liste de courses (exportable vers Google Keep).

## Lancer

Node 18 ou plus, aucune dépendance à installer :

```sh
npm start            # ou : node server.js
# MyMenu : http://localhost:3000
```

Variables d'environnement :

| Variable        | Rôle                                                         |
|-----------------|--------------------------------------------------------------|
| `PORT`          | Port d'écoute (3000 par défaut)                              |
| `ALLOW_PRIVATE` | `1` autorise l'import depuis des adresses locales (tests seulement) |

## Fichiers

- `index.html` : toute l'application (HTML, CSS, JavaScript, sans framework).
- `server.js` : sert `index.html` et la route `GET /api/extract?url=…`, qui télécharge la page de recette côté serveur (le navigateur ne peut pas lire un autre site à cause de CORS) et renvoie ses blocs JSON-LD schema.org, ou la page entière si elle n'en a pas.

La route refuse les adresses non http(s), les adresses internes (localhost, réseaux privés), les pages de plus de 4 Mo et les réponses de plus de 12 s.

## Données

Hors de claude.ai, les recettes et les menus sont enregistrés dans le `localStorage` du navigateur : ils ne sont pas partagés entre appareils.
