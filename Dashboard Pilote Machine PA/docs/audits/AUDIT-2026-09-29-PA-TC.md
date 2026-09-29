# Audit complet PA / TC — code, sécurité, cache, données, interface

**Date :** 29/09/2026
**Périmètre :** `Dashboard Pilote Machine PA` et `Dashboard Pilote Machine TC` (Apps Script, interface `Index.html`, tests), plans d’actions MFT fournis en échantillon.
**Méthode :** lecture du code et exécution des tests locaux (`npm test`, Node 22). Rendu de l’interface dans Chromium avec des données fictives : Google Charts n’est pas joignable depuis l’environnement d’audit, les graphiques ont donc été simulés. Aucun accès aux classeurs Google de production : les volumes, temps de réponse et quotas réels restent à mesurer sur place.

Légende des statuts : ✅ corrigé dans cette livraison · 🟡 corrigé en partie · ⬜ recommandation à planifier.

## 1. Synthèse

| Priorité | Domaine | Constat | Statut |
| --- | --- | --- | --- |
| P0 | Sécurité | Toute fonction serveur publique (sans `_` final) est appelable depuis le navigateur par n’importe quel utilisateur du domaine, et s’exécute avec le compte de déploiement : suppression d’action MFT, actualisation, archivage, nettoyage d’onglets, import MES… | ✅ Contrôle serveur `requireSpreadsheetEditor_` sur les 16 fonctions d’écriture |
| P0 | Performance | Une instruction orpheline dans `MesImport.gs` lançait une recherche Drive (et pouvait créer un dossier) à **chaque** appel serveur | ✅ Supprimée ; dossier « MES A DEPOSER » retrouvé une seule fois puis mémorisé par ID |
| P1 | Cache | Le suivi des plans MFT et les coûts NC directs étaient mis en cache **60 secondes** (et non 60 minutes) : plans MFT, master, Doc&Martin et source NC relus presque à chaque ouverture | ✅ 30 min + copie de secours 6 h |
| P1 | Cache | Réponses analytiques gardées 1 h, et jamais mises en cache au-delà de 95 Ko | ✅ 6 h (période d’actualisation), réponses volumineuses découpées en morceaux |
| P1 | Fiabilité | Premier utilisateur après chaque actualisation : calcul complet côté serveur | ✅ Préchauffage des vues Pilotage et NC à la fin de `actualiserTout` |
| P1 | Fiabilité | Aucune reprise en cas d’erreur réseau ; une réponse lente pouvait écraser un filtrage plus récent | ✅ Nouvel essai automatique, jetons de requête, copie locale affichée immédiatement |
| P1 | Tests | Les deux suites échouaient dès la première assertion (tests TC recopiés du PA) | ✅ Suites réalignées et étendues (couleurs, filtres, cache, sécurité) |
| P1 | Réseau | Script d’icônes chargé depuis `unpkg.com` (hors Google, CDN public) | ✅ Icônes intégrées ; seules restent Google Charts et Google Fonts (domaines Google) |
| P2 | Code | ~550 lignes d’écart entre `Code.gs` PA et TC pour une logique à 90 % commune ; libellés « PA » restés dans le code TC | 🟡 Libellés corrigés ; mutualisation à planifier |
| P2 | Code | Vues et fonctions mortes : vues `viewQuality` et `viewCombinedAlea` sans bouton d’accès, `loadDataQuality`, `loadCombinedAlea`, `drawLegacyCharts_`, `getMftAgenda` jamais appelés, grille masquée `#dashboard` | ⬜ À supprimer après validation métier |
| P2 | Données | 35 à 67 % des actions MFT sans IMMO ni famille lisible : ces machines apparaissent « aucune action » à tort | ⬜ Colonnes IMMO/Famille dans les plans (voir analyse des plans) |
| P2 | Performance | Chaque calcul non mis en cache relit toute la feuille `FAITS_IMMO` (et l’archive pour « Tout ») | ⬜ Voir § 4 |
| P3 | Interface | Page « Analyses Aléas » redondante avec le Pilotage | ✅ Supprimée en PA et en TC (interface et serveur) |

## 2. Sécurité et droits

**Contexte.** Le manifeste publie la web app avec `access: DOMAIN` et `executeAs: USER_DEPLOYING`. Toute personne du domaine Airbus peut donc ouvrir le dashboard, et chaque appel serveur s’exécute avec les droits du compte de déploiement. Dans Apps Script, `google.script.run` peut appeler **n’importe quelle fonction globale dont le nom ne se termine pas par `_`**, pas seulement celles utilisées par l’interface.

**Risque constaté.** Depuis la console du navigateur, un utilisateur quelconque pouvait appeler `deleteMftAction`, `saveMftAction`, `actualiserTout`, `archiverFactsHistoriques`, `nettoyerOngletsTemporaires`, `synchroniserSourcesConnues`, `reconstruireHistoriqueMes`, `installerDeclencheur`, etc.

**Correction.** `requireSpreadsheetEditor_(nom)` est appelé en première ligne des 16 fonctions d’écriture. La règle :
- utilisateur identifié et propriétaire ou éditeur du classeur central : autorisé (résultat mis en cache 10 min) ;
- utilisateur identifié mais non éditeur : refus avec un message explicite ;
- utilisateur non identifié (déclencheur horaire) : autorisé, car un déclencheur est installé par un éditeur.

Les menus du classeur (Enora, Qualité, administration) continuent de fonctionner pour les éditeurs.

**Reste à faire.**
- ⬜ Rôles plus fins (lecture / pilote MFT / administrateur) si des éditeurs du classeur ne doivent pas tout pouvoir lancer.
- ⬜ Renommer avec un `_` final les fonctions de diagnostic qui n’ont pas besoin d’être appelées depuis un menu.
- ⬜ Vérifier que le compte de déploiement est un compte de service ou d’équipe, et non un compte personnel.

**Points conformes.**
- Les textes affichés sont échappés (`escapeHtml`) avant insertion HTML.
- Les cellules écrites sont protégées contre l’injection de formules.
- Le verrou `LockService` protège 7 opérations concurrentes.
- `doGet` n’accepte aucun paramètre.

## 3. Cache et fiabilité (actualisation toutes les 6 h)

| Élément | Avant | Après |
| --- | --- | --- |
| Réponses Pilotage / NC / détails | 1 h ; non mises en cache si > 95 Ko | **6 h**, découpées en morceaux jusqu’à ~900 Ko ; clé liée à `ANALYTICS_CACHE_VERSION`, renouvelée à chaque publication de `FAITS_IMMO` : jamais de données périmées |
| Suivi des plans MFT | **60 s** | 30 min + copie « dernière lecture réussie » 6 h utilisée si un classeur est inaccessible |
| Coûts NC lus en direct | **60 s** | 30 min |
| Après `actualiserTout` | cache vide | vues Pilotage et NC (1 an, sans filtre) recalculées immédiatement |
| Navigateur | aucune copie | dernière réponse par filtre (6 h, 6 entrées) affichée instantanément puis remplacée |
| Erreur réseau | message d’erreur | nouvel essai après 1,5 s, puis copie locale avec la mention « Serveur indisponible » |
| Réponses concurrentes | la plus lente gagnait | seule la réponse au dernier filtrage est affichée |

Le déclencheur de préchauffage toutes les 30 min devient optionnel : le préchauffage suit désormais chaque actualisation. Vérifier dans **Déclencheurs** qu’il n’existe qu’un seul déclencheur `actualiserTout` toutes les 6 h.

## 4. Performance

- ✅ Suppression de la recherche Drive exécutée à chaque appel (probablement le gain le plus visible).
- ✅ Durées de cache corrigées (§ 3) : les plans MFT (jusqu’à 12 onglets) ne sont plus relus à chaque ouverture.
- ✅ Interface :
  - un seul tracé par changement de largeur, sans boucle `ResizeObserver` ;
  - recherche du détail différée de 120 ms ;
  - filtre « Suivi plan d’actions » appliqué dans le navigateur, sans appel serveur.
- ⬜ `readFactsForAnalysis_` relit toute `FAITS_IMMO` à chaque calcul non mis en cache. Piste : garder une version compacte des faits de la publication courante (colonnes utiles seulement) dans le cache découpé, ou pré-agréger par semaine / famille / IMMO à l’actualisation.
- ⬜ `getDashboardDetails` filtre tous les faits à chaque clic nouveau. Piste : index par famille / IMMO construit à l’actualisation.
- ⬜ Mesurer sur place (Exécutions Apps Script) la durée de `getDashboardData` sans cache et de `actualiserTout` + préchauffage, qui doit rester sous 6 min.

## 5. Qualité du code

- **Duplication PA / TC.** Même architecture, mais 549 lignes d’écart dans `Code.gs`. Les tests TC étaient une copie du PA et échouaient. Les libellés « hors périmètre PA » étaient restés dans le code TC (corrigés). ⬜ Recommandation : une bibliothèque Apps Script commune et un `Config.gs` par périmètre (sections, postes, sources, coûts, plans MFT).
- **Code mort.** ⬜ À supprimer après validation :
  - vues `viewQuality` et `viewCombinedAlea`, avec leurs fonctions `loadDataQuality`, `loadCombinedAlea`, `renderCombinedAlea*` et `getCombinedAleaAnalysisData` ;
  - `drawLegacyCharts_` et la grille masquée `#dashboard`, qui héberge encore des éléments KPI lus par `renderDashboard` : à déplacer avant suppression ;
  - `getMftAgenda`.
- **Corrections fonctionnelles de cette série.**
  - Famille citée dans un commentaire : le jeton le plus précis l’emporte.
  - Durées Sheets arrondies à la seconde.
  - IMMO validé par la Qualité conservé hors master.
  - Famille de l’aléa production reprise du master.
  - Filtres Famille / IMMO / MSN acceptant des sélections multiples exactes.
- **Tests.** ✅ Les deux suites passent. Elles couvrent maintenant :
  - la règle de couleur et l’historique des plans ;
  - les actions liées à une barre ;
  - le cache découpé et le contrôle d’accès ;
  - les filtres en listes ;
  - l’absence de CDN externe.
  
  ⬜ Exécuter `npm test` automatiquement à chaque push (GitHub Actions) pour que les suites ne redeviennent pas obsolètes.

## 6. Données et plans d’actions

Détail dans [ANALYSE-PLANS-ACTIONS-2026-09-29.md](ANALYSE-PLANS-ACTIONS-2026-09-29.md). Points bloquants pour la fiabilité de l’item 2 :

1. **Actions sans IMMO / famille.** 35 % (PA), 46 % (TC 355) et 67 % (TC 370) des actions n’ont ni IMMO ni famille lisible. Ces machines s’affichent « aucune action » à tort.
2. **Pas de date de clôture.** Le dashboard la reconstitue depuis les onglets datés ; une colonne `Date de clôture` rendrait la règle des 6 mois exacte.
3. **Suppressions d’actions.** Supprimer des actions terminées (TC 370, février 2026) efface l’historique utile.
4. **Statut `Due`.** Il duplique l’échéance : le retard est calculable à partir de l’échéance.

## 7. Interface et accessibilité

- ✅ Couleurs sans rouge :

  | Couleur | Signification |
  | --- | --- |
  | Vert | Action clôturée depuis moins de 6 mois |
  | Bleu | Action en cours |
  | Orange pastel | Action clôturée depuis plus de 6 mois, et le problème revient |
  | Violet doux | Aucune action |
  | Gris | Suivi indisponible |

  La légende est cliquable et sert de filtre.
- ✅ Filtre « Suivi plan d’actions ». Le raccourci **À traiter en MFT** sélectionne le violet et l’orange.
- ✅ Clic sur une barre : les actions MFT liées s’affichent (réf., statut, échéance, clôture, responsable, plan), avec le bouton « Filtrer tout le tableau de bord sur … ».
- ✅ Animations d’apparition des graphiques et info-bulles indiquant le statut du plan.
- ✅ Schéma « Du terrain à la décision » refait :
  - 4 étapes avec des compteurs issus des données réelles ;
  - liens vers les vues ;
  - bouton **Préparer la réunion MFT** ;
  - mise en page adaptée au mobile.
- ✅ Filtres Poste / Famille / IMMO / MSN en listes déroulantes à cases, avec les variantes de poste regroupées.
- ⬜ Rendre les barres des graphiques atteignables au clavier (Google Charts ne le fait pas nativement). Piste : tableau de données accessible sous chaque graphique.
- ⬜ Harmoniser le style du sélecteur « Origine des données » avec les nouvelles listes.

## 8. Réseau Workspace

Ressources externes chargées par la page après correction :

| Ressource | Rôle | Hébergeur |
| --- | --- | --- |
| `www.gstatic.com/charts/loader.js` | Google Charts | Google |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Polices IBM Plex Sans et Manrope ; une police système prend le relais si elles sont bloquées | Google |

Plus aucun script tiers (`unpkg.com` retiré). Les données restent dans Google Sheets / Drive du domaine ; l’application n’appelle aucun service externe (`UrlFetchApp` absent).

## 9. Recette à faire sur les classeurs de production

1. Déployer une nouvelle version PA et TC et exécuter **Actualiser toutes les données**.
2. Vérifier dans **Exécutions** :
   - la durée de `actualiserTout` avec le préchauffage ;
   - l’absence d’erreur « réservée aux éditeurs » pour les déclencheurs.
3. Ouvrir le dashboard avec un compte **non éditeur** :
   - la consultation fonctionne ;
   - l’import MES depuis la page est refusé avec un message clair.
4. Cliquer une barre violette et une barre orange : vérifier les actions MFT affichées par rapport au plan.
5. Contrôler les compteurs du schéma de synthèse par rapport à l’onglet `FAITS_IMMO`.
