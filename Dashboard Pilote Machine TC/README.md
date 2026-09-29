# Dashboard Pilote Machine PA

Application interne de pilotage des aléas machine, des non-conformités (NC) et des extractions MES pour le périmètre **Tronçon Central (TC)**. Le référentiel MFT reste conservé côté administration, sans page dédiée dans l’interface.

Le projet est une application web Google Apps Script reliée à Google Sheets et Google Drive. Il n’y a pas de serveur local à maintenir : le code est déployé dans un projet Apps Script lié à un classeur central.

## Ce que fait l’application

L’interface comporte quatre vues :

1. **Synthèse activités** : schéma « Du terrain à la décision », seul contenu de la première page.
2. **Pilotage** : revue interactive centrée sur la disponibilité UPA/MEDU, la qualité de la donnée MES d’origine, les coûts NC/MES par famille ou IMMO, la ventilation par MSN et le Pareto des défauts. Les graphiques MES et fusionnés se basculent avec le sélecteur **Famille / IMMO**.
3. **Analyses Aléas PA** : lecture directe de `Remontées aléas production`, pour les lignes PA des postes 280/290 ; KPI, tendance interactive, Pareto IMMO/familles, type de machine, catégorie, taux pour 1 000 perçages et historique filtré.
4. **Analyses NC PA** : KPI propres aux NC du périmètre PA, y compris celles sans IMMO identifiées par un nom de machine, un poste ou une indication famille, tendance interactive basée sur le nombre de NC, Pareto IMMO/familles, poste ou machine source, typologie, MSN et historique filtré.

Les périodes courantes du pilotage et des NC lisent `FAITS_IMMO`, limité à une fenêtre glissante de 24 mois. Le filtre **Tout** et les périodes commençant avant cette fenêtre ajoutent `FAITS_IMMO_ARCHIVES`, sans doublonner les événements présents dans les deux tables. L’analyse Aléas PA lit directement sa source afin de ne pas dépendre d’une actualisation globale.

## Architecture des données

```text
BDD_Master_amélio ───────┐
Remontées aléas ─────────┼──> Apps Script ──> FAITS_IMMO ──> Web app
Données NC PA (historique) ─┤     │             │
Base MES/NC XLSX manuelle ┘       ├──> CONTROLES
                                  ├──> FAITS_IMMO_ARCHIVES
                                  └──> Tables MFT officielles
```

Le classeur central recommandé est distinct des classeurs sources. Le script lit les sources, normalise les colonnes et n’écrit pas dans les feuilles métier sources.

## Structure du dépôt

```text
apps-script/
  Config.gs          Paramètres, alias et schéma des faits
  Code.gs            Consolidation, KPI, analyses PA et fonctions MFT
  MesImport.gs       Import CSV/XLSX/Google Sheets depuis Drive
  MftRepository.gs   Migration et stockage normalisé du plan MFT
  Index.html         Interface web et graphiques
  appsscript.json    Manifeste Apps Script

assets/
  branding/          Logo et éléments d’identité visuelle

data/
  samples/           Échantillons locaux, référentiels et exports MES

docs/
  INSTALLATION.md    Procédure de déploiement et d’exploitation
  audits/             Audits techniques et fonctionnels datés
  captures/           Captures de l’interface
  notes/               Notes de cadrage et de mise à jour
  references/          PDF, schémas et documents métier sources

tests/
  run-tests.js        Tests locaux sans accès Google

.gitignore            Fichiers exclus du contrôle de version
package.json          Commande npm test
```

Les documents importants sont accessibles directement : [guide d’installation](docs/INSTALLATION.md), [audit complet du 28 août 2026](docs/audits/AUDIT-2026-08-28.md), [audit du 27 août 2026](docs/audits/AUDIT-2026-08-27.md), [diagramme externe des flux](docs/architecture/ARCHITECTURE-DATA-FLOW.html), [source éditable de l’architecture](docs/architecture/ARCHITECTURE-DATA-FLOW.md), [audit du 20 août 2026](docs/audits/AUDIT-2026-08-20.md), [note de mise à jour MES](docs/notes/MISE-A-JOUR-MES-2026-08-24.txt), [référence métier NC](docs/references/remontees-aleas-machine-analyse-nc.pdf), [vue des données brutes](docs/references/donnees-brutes.png) et [tableau QlikSense](docs/references/tableau-qliksense.png).

Les filtres **Poste**, **Famille**, **IMMO** et **MSN** sont des listes déroulantes à cases : recherche, « Tout cocher / Tout décocher », sélection multiple et bouton **Appliquer**. Les variantes d’un même poste (ex. `P280`, `P280 A`, `P280 - Vert`) sont regroupées sous « Poste 280 » et se cochent en une fois.

Le panneau **Filtres** peut être replié pour libérer l’espace d’analyse. Sur desktop, le rail replié se rouvre temporairement au survol ou lorsque le clavier entre dans ses contrôles ; sur mobile, il fonctionne comme un accordéon. Son état est mémorisé et son bouton indique le nombre de filtres actifs. Chaque graphique dispose également d’un mode focus agrandi, refermable par son bouton, le fond ou la touche `Échap`.

Les fichiers de [data/samples](data/samples) servent uniquement à l’analyse locale et aux recettes. Les données de production sont lues depuis Google Drive par Apps Script.

Pour MES, « IMMO cité » et « Famille citée » signifient qu’une valeur est présente dans le champ source `ID équipement` ou reconnue explicitement dans le commentaire MES. L’ID équipement est rapproché de la colonne `Equipement` du master pour retrouver le `N° IMMO` et la famille. Une famille ou un IMMO déduit du référentiel sans correspondance source ne gonfle jamais ces taux.

## Déploiement rapide

1. Créer ou ouvrir le classeur central `BDD Pilotage Machine`.
2. Ouvrir **Extensions > Apps Script**.
3. Copier les fichiers du dossier `apps-script/` dans le projet Apps Script.
4. Vérifier le manifeste `appsscript.json` et enregistrer le projet.
5. Exécuter `initialiserApplication` une première fois et accepter les autorisations Google.
6. Vérifier les identifiants dans l’onglet `PARAMETRES`.
7. Exécuter **Dashboard Machine > Actualiser toutes les données**.
8. Publier une **Application web** depuis Apps Script et déployer une nouvelle version après chaque modification.

La procédure complète, les colonnes reconnues et les opérations de maintenance sont décrites dans [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Onglets créés dans le classeur central

| Onglet | Usage |
| --- | --- |
| `PARAMETRES` | IDs des classeurs/dossiers, coûts moyens et poids d’impact |
| `FAITS_IMMO` | Faits actifs consommés par le dashboard |
| `FAITS_IMMO_ARCHIVES` | Faits de plus de 24 mois, avec clé et date d’archivage |
| `CONTROLES` | IMMO inconnus, dates/familles manquantes et anomalies master |
| `STG_MES` | Données MES normalisées avant consolidation |
| `NC_MES_PREVISIONNELLES` | Tickets MES classés NC, complétés lors de la préparation puis validés par la Qualité |
| `JOURNAL_IMPORT` | Résultat de chaque import MES |
| `MFT_ACTIONS_OFFICIEL` | Une ligne par action MFT |
| `MFT_SUIVI_OFFICIEL` | Historique des mises à jour MFT |
| `MFT_REUNIONS_OFFICIEL` | Registre des réunions MFT |

Une éventuelle feuille `ACTIONS_MFT` est uniquement une source de migration historique.

## Actualisation et rétention

Le menu **Actualiser toutes les données** :

- importe les nouveaux fichiers MES ;
- lit les sources configurées et `STG_MES` ; conserve les NC historiques absentes du dernier export MES et fusionne les doublons métier ;
- normalise les faits et déduplique les événements ;
- interrompt l’actualisation avant toute réécriture si la source production est vide ou si aucun aléa PA des postes 280/290 n’est consolidé ;
- archive les faits datés de plus de 24 mois ;
- réécrit `FAITS_IMMO` et `CONTROLES` ;
- affiche le nombre de faits actifs, nouvellement archivés et mis à jour dans l’archive.

La commande **Archiver les faits de plus de 24 mois** applique la même règle sans relire les sources. Les faits sans date restent actifs pour éviter une suppression silencieuse. Une correction ultérieure d’un fait déjà archivé met à jour sa version archivée au lieu de créer un doublon.

Le verrou Apps Script empêche les actualisations, imports MES et reconstructions historiques simultanés.

Les commandes principales restent directement accessibles dans **Dashboard Machine** ; les opérations rares sont regroupées dans les sous-menus **Configuration et maintenance** et **Automatisation**.

## Règles métier principales

- Le périmètre est PA/PA STR ; les lignes MES hors périmètre sont exclues selon leurs critères de section et d’objet.
- Pour les aléas production, les seuls critères d’inclusion sont ceux de la ligne source : colonne `Section` au périmètre PA et colonne `Poste` à 280/290, variantes A/B/C comprises. L’événement reste visible si l’IMMO manque, est inconnu ou appartient à un autre périmètre dans le master ; le master sert uniquement à enrichir et à calculer la couverture. Une NC sans IMMO mais avec un nom de machine, un poste ou une indication famille est conservée dans les volumes, familles, postes et détails ; elle reste exclue du Pareto IMMO et de la couverture master. Une ligne NC sans aucune identité exploitable reste visible dans l’audit des sources, mais n’alimente pas les analyses.
- Les faits non rapprochés restent visibles dans les KPI, défauts et contrôles qualité. Le pilotage affiche la couverture famille, IMMO, MSN et durée des aléas MES afin que les données incomplètes ne disparaissent pas de la lecture métier.
- Un IMMO absent de la source et un IMMO fourni mais non résolu sont comptés séparément. Une famille héritée du master est résolue pour l’analyse, mais ne masque pas l’absence de famille dans la source.
- La revue valorise une NC selon les données disponibles et une heure d’indisponibilité UPA/MEDU issue de MES à `116 €` (`COUT_HEURE_PERDUE_EUR`). Ces hypothèses sont affichées dans l’interface et ne remplacent pas un coût comptable.
- Tous les graphiques restent filtrables par période, famille, source, IMMO, poste et MSN. Le MSN représente l’avion concerné.
- Pour les NC, le KPI et les graphiques utilisent `NB_NC` lorsqu’il est renseigné, sinon `QUANTITE`.
- Toutes les NC MES de la catégorie concernée sont conservées dans `NC_MES_PREVISIONNELLES`, avec le numéro provenant de la colonne `N° NC` lorsqu’il existe. Elles restent en préparation et n’alimentent pas encore les faits NC ni les KPI. Pour l’instant, les NC du dashboard proviennent exclusivement de la feuille historique `Données NC PA`.
- Les statuts MES `Supprimé` et `Rejeté` sont exclus. Les libellés `Retouches à poste (sans NC)` et `Aller/Retour CDU` ne sont pas présentés comme des pré-NC.
- Le `Temps aléas`/`Temps perdu` des aléas, NC et MES est conservé en heures décimales et additionné dans les heures perdues machine PA, avec un classement par défaut, par famille et par IMMO : `0,50 h` correspond à `00:30:00`.
- Chaque ligne MES classée comme aléa compte pour un impact analytique afin qu’une quantité d’extraction aberrante ne masque pas les aléas production. La quantité brute reste conservée dans `STG_MES` et `FAITS_IMMO`, et la vue Qualité signale les pics par semaine, fichier et événement ; aucune ligne source n’est supprimée.
- Les poids par défaut sont `ALEA = 1`, `NC = 5`, `ALEA_MES = 1`.
- Un taux « impacts / 1 000 perçages » n’est pas un pourcentage.
- Une déclaration liée à plusieurs IMMO est éclatée en une ligne par IMMO ; les coûts et les volumes NC sont répartis entre ces lignes afin de ne pas compter plusieurs fois la même NC.

## Suivi des plans d’actions (Pilotage, item 2)

Les barres des graphiques « Coût par famille » et « Coût par IMMO » sont colorées selon les classeurs `ID_FICHIER_PLAN_ACTIONS_TC_370` et `ID_FICHIER_PLAN_ACTIONS_TC_355_360_OSW` :

| Couleur | Signification |
| --- | --- |
| Vert | Action clôturée et prise en compte depuis moins de 6 mois |
| Bleu | Au moins une action ouverte ou en cours (`Open`, `Due`, `En cours`, statut vide d’une action récente) |
| Orange pastel | Dernière action clôturée depuis plus de 6 mois alors que la machine génère de nouveau des coûts : le problème revient |
| Rouge | Aucune action (non prise en compte), ou action seulement reportée / abandonnée |
| Gris | Plan illisible ou incomplet : statut inconnu |

Si plusieurs actions portent sur la même machine : bleu > vert > orange > rouge.

La date de clôture n’existe pas dans les onglets datés du plan : elle est reconstituée à partir de l’historique. Le script lit les onglets des 6 derniers mois et l’onglet précédent ; une action est datée à la première réunion où elle passe à `Done`. Une action déjà terminée dans le premier onglet lu est datée par la dernière date de son commentaire, puis par son échéance. Une action ouverte qui disparaît du plan est considérée close à la réunion suivante. Si le classeur ne contient plus d’onglets datés, la table `MFT_ACTIONS_OFFICIEL` et sa colonne `DATE_CLOTURE` sont utilisées.

Le KPI « Coûts non traités » donne la part des coûts NC + MES par famille en rouge ou en orange ; sa note détaille les montants sans action, récurrents, en cours et clôturés. L’analyse détaillée des plans et les recommandations d’organisation sont dans [l’analyse du 29 septembre 2026](../Dashboard%20Pilote%20Machine%20PA/docs/audits/ANALYSE-PLANS-ACTIONS-2026-09-29.md).

## Import MES

Les extractions MES (aléas UPA / MEDU et NC) se déposent dans le dossier Drive **MES A DEPOSER**. Le script utilise l’ID `ID_DOSSIER_MES_A_DEPOSER` s’il est renseigné ; sinon il retrouve le dossier `MES A DEPOSER TC`, puis `MES A DEPOSER`, et mémorise son ID. Le menu **Créer le dossier de dépôt MES** réutilise ce dossier s’il existe, ou le crée, avec son sous-dossier `Archives`. Les formats CSV, XLSX et Google Sheets sont reconnus. Après un import réussi, le fichier est déplacé dans `Archives` et enregistré dans `JOURNAL_IMPORT`.

La nouvelle base XLSX doit être importée manuellement dans ce dossier. Le script conserve uniquement `Unité = Structure TC A350`, transforme `03-Moyens / 0328 UPA MEDU` en `ALEA_MES` et `01-Matière / 0111 Articles Composants Pieces` en `NC`. `Poste / MFT`, `MSN_MES`, `N° NC`, `NB_NC` et `Temps aléas` sont conservés lorsqu’ils sont disponibles. Toutes les NC MES sont écrites dans `NC_MES_PREVISIONNELLES` afin que la préparation qualité puisse utiliser `N° NC` dans SAP et compléter l’IMMO ou la famille avant validation.

Utiliser **Reconstruire l’historique MES** après une évolution des alias ou des règles de rapprochement. Cette opération relit les archives, reconstruit `STG_MES`, puis reconsolide les faits.

### Workflow de validation des NC

`NC_MES_PREVISIONNELLES` est une feuille de travail partagée :

- les colonnes MES et les propositions automatiques sont régénérées par le script ;
- `NC_NUMERO` est affiché pour être copié-collé dans SAP ; la préparation qualité reporte ensuite l’IMMO ou la famille retrouvée dans `IMMO_SAISI` ou `FAMILLE_SAISIE` ;
- la feuille est automatiquement triée par `NC_NUMERO` décroissant après chaque import, y compris lorsque plusieurs fichiers MES sont regroupés ;
- la préparation qualité peut ajouter une précision dans `COMMENTAIRE_PREPARATION` ;
- la Qualité contrôle ensuite les informations et renseigne `DECISION_QUALITE` (`VALIDEE`, `A_CORRIGER` ou `REJETEE`), avec `COMMENTAIRE_QUALITE` si nécessaire ;
- les lignes peuvent être complétées et validées pour fiabiliser le futur flux MES, mais elles ne sont pas encore intégrées à `FAITS_IMMO` ni à **Analyses NC PA** ; ces analyses utilisent exclusivement `Données NC PA`.

#### Étapes de préparation

1. Ouvrir **NC Qualité - Préparation > 1. Ouvrir les NC à compléter**. La feuille affiche les lignes `A_COMPLETER` et `A_CORRIGER`.
2. Copier `NC_NUMERO` et le coller dans SAP pour retrouver l’IMMO ou la famille.
3. Reporter le résultat dans `IMMO_SAISI` ou `FAMILLE_SAISIE`. Ajouter une précision dans `COMMENTAIRE_PREPARATION` si besoin.
4. Sélectionner les lignes complétées, sans sélectionner l’en-tête.
5. Ouvrir **NC Qualité - Préparation > 2. Soumettre les lignes sélectionnées**. Les lignes passent au statut `SOUMIS`.

#### Étapes de contrôle Qualité

1. Ouvrir **NC Qualité > 1. Ouvrir les NC soumises**. La feuille affiche les lignes au statut `SOUMIS`.
2. Contrôler l’IMMO, la famille, le poste, la typologie et les commentaires de chaque ligne.
3. Renseigner `DECISION_QUALITE` avec `VALIDEE`, `A_CORRIGER` ou `REJETEE`. Ajouter `COMMENTAIRE_QUALITE` pour expliquer une correction ou un rejet.
4. Sélectionner les lignes contrôlées, sans sélectionner l’en-tête.
5. Ouvrir **NC Qualité > 2. Enregistrer les décisions**. Le script enregistre la décision, la date et l’utilisateur.
6. Ouvrir **NC Qualité > 3. Actualiser après validation** pour enregistrer et contrôler le workflow. Tant que le flux MES NC n’est pas fiabilisé, les lignes `VALIDEE` ne sont pas intégrées dans `FAITS_IMMO` ; les analyses NC restent alimentées par `Données NC TC`. Les lignes `A_CORRIGER` reviennent dans la file de préparation.

Les saisies manuelles sont conservées par `ID_EVENEMENT` lors des imports suivants. Ne modifiez pas les colonnes MES importées. Une NC validée sans numéro officiel est comptée comme NC avec son identifiant MES stable ; elle pourra ensuite être rapprochée d’un numéro NC officiel.

Deux menus dédiés apparaissent dans la barre du classeur :

- **NC Qualité - Préparation** : ouvre uniquement les NC `A_COMPLETER` ou `A_CORRIGER`, puis soumet les lignes sélectionnées ;
- **NC Qualité** : ouvre uniquement les NC `SOUMIS`, enregistre les décisions et lance l’actualisation après validation.

Le menu **Dashboard Machine** reste réservé à l’administration, aux imports et aux opérations techniques.

## Paramètres à vérifier

Les clés sont dans `PARAMETRES` et les valeurs par défaut sont centralisées dans `apps-script/Config.gs`.

| Clé | Rôle |
| --- | --- |
| `ID_FICHIER_MASTER` | Classeur contenant `BDD_Master_amélio` |
| `ID_FICHIER_ALEAS` | Classeur contenant `Remontées aléas production` |
| `ID_FICHIER_NC` | Classeur contenant `Données NC PA` et ses IMMO/postes d’enrichissement |
| `ID_FICHIER_PLANNING_MSN` | Référentiel d’activité MSN |
| `ID_FICHIER_TAUX_PERCAGE` | TCD des perçages par famille |
| `ID_FICHIER_PLAN_ACTIONS_MFT` | Classeur MFT officiel |
| `ID_DOSSIER_MES_A_DEPOSER` | Dossier Drive des nouveaux exports |
| `ID_DOSSIER_MES_ARCHIVES` | Dossier Drive des exports traités |
| `COUT_MOYEN_*_EUR` | Coûts moyens facultatifs |
| `COUT_HEURE_PERDUE_EUR` | Coût horaire du temps perdu, facultatif |
| `POIDS_ALEA`, `POIDS_NC`, `POIDS_ALEA_MES` | Pondération des impacts |

## Sécurité et droits

Le manifeste actuel configure la web app avec `access: DOMAIN` et `executeAs: USER_DEPLOYING`. Cela signifie que les appels exécutés par la web app peuvent utiliser les droits du compte de déploiement. Les fonctions d’écriture (actualisation, import, archivage, configuration Drive et actions MFT) doivent donc être exposées uniquement à un groupe de confiance du domaine.

Avant une mise en production, il faut ajouter une autorisation serveur par rôle (lecture, opérateur, pilote MFT, administrateur). Masquer un bouton dans l’interface ne constitue pas un contrôle de sécurité. Ne jamais publier l’application en accès public pour des données de production.

## Performance et limites

Les données opérationnelles sont limitées à 24 mois pour accélérer les périodes courantes. L’archive est lue uniquement pour **Tout** ou une période antérieure à cette rétention. Les détails des pages Aléas/NC affichent 20 lignes initialement ; la recherche interroge tout l’historique filtré côté serveur et retourne jusqu’à 500 résultats triés par date.

Cette architecture convient à un volume modéré. Au-delà d’environ 100 000 à 200 000 faits, ou si l’actualisation approche les limites Apps Script, prévoir une lecture par lots ou un stockage analytique dédié.

## Tests locaux

Les tests vérifient la syntaxe Apps Script/HTML et les règles critiques sans appeler Google : rapprochement master, rapprochement combiné Production/MES, périmètre, KPI source, rétention, archive, protection contre les formules et migration MFT.

Node.js 18 ou une version plus récente est nécessaire pour exécuter les tests. Les données de test et les référentiels locaux sont regroupés dans [data/samples](data/samples).

```powershell
npm test
```

La suite ne remplace pas une recette sur un classeur Google de préproduction. Il faut notamment tester les autorisations, la concurrence, les volumes réels et la qualité des colonnes sources.

## Audit de l’état actuel

Points solides : consolidation centralisée, rétention idempotente, archive sans doublons, verrouillage des opérations principales, contrôles qualité, tests locaux et séparation des tables MFT.

Priorités restantes avant une diffusion large :

1. mettre en place l’autorisation serveur par rôle ;
2. exiger et contrôler une colonne `Section`/`EAP` fiable dans la source NC ;
3. remplacer la dépendance CDN Lucide par une ressource versionnée et approuvée ;
4. ajouter des tests d’intégration Apps Script/Sheets/Drive et une recette de concurrence ;
5. ajouter une pagination ou un export pour les historiques volumineux.

## Historique Git

La branche de référence publiée est `main`. Le commit de fusion actuel est `d888e49`.
