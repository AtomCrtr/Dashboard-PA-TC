# Audit design et données PA / TC

**Date :** 30/09/2026

**Méthode**
- **Design :** rendu de l’interface dans Chromium, en bureau (1440 px) et en mobile (390 px), avec des données fictives. Google Charts n’est pas joignable depuis l’environnement d’audit : les graphiques sont simulés.
- **Données :** les exports MES réels fournis (`data/samples`) ont été passés dans le **code d’import du dashboard** (`tableToMesRecords_`) :
  - PA : 11 970 lignes ;
  - TC : 15 545 lignes.

  Le planning MSN et les TCD de perçage ont aussi été contrôlés.
- **Non audité :** les feuilles `Données NC` et `BDD_Master_amélio`, absentes des échantillons. Les taux qui en dépendent restent à relever dans les classeurs de production.

Statuts : ✅ corrigé dans cette livraison · ⬜ recommandation.

## 1. Décalage entre le graphique et le tableau de détail

### 1.1 Mise en page du panneau de détail ✅

**Cause.** Le panneau est une grille à 3 lignes : en-tête, recherche, tableau. La section « Actions MFT liées » ajoutée le 29/09 a créé un 4ᵉ bloc. Le tableau est alors tombé dans une ligne implicite en bas du panneau, et la zone extensible est revenue à la barre de recherche, d’où le grand vide entre les deux.

**Correction.**
- Chaque bloc a désormais une ligne fixe (en-tête / actions MFT / recherche / tableau).
- Si la section Actions MFT est absente, sa ligne se réduit à zéro.
- La section Actions MFT est limitée à 32 % de la hauteur, avec défilement.

### 1.2 Écart de valeurs entre la barre et le tableau ✅

**Cause.** Les barres « Coût des NC » de l’item 2 ne venaient pas des mêmes données que le tableau de détail :

| | Barre (avant) | Tableau de détail |
| --- | --- | --- |
| Source | lecture **directe** de la feuille NC (cache 30 min) | `FAITS_IMMO` (actualisation toutes les 6 h) |
| Dédoublonnage des NC | non | oui |
| Coût d’une NC | **300 € codés en dur** | coût Business Case (250 € ou scénario) |
| Coût MES | **100 €/h codés en dur** | paramètre `COUT_HEURE_PERDUE_EUR` (110 €/h PA, 116 €/h TC) |

La règle affichée à l’écran (« NC à 250 €… MES à 110 €/h ») ne correspondait donc ni aux barres ni au KPI « Coûts non traités ».

**Correction.**
- Une seule fonction de coût, `reviewFactCost_`, est utilisée par les barres, le graphique MSN, le KPI « Coûts non traités » et le tableau de détail :
  - aléa MES : heures × `COUT_HEURE_PERDUE_EUR` ;
  - NC : coût calculé à la consolidation s’il est non nul, sinon `COUT_MOYEN_NC_EUR`, sinon 300 € (règle affichée en TC).
- La lecture NC directe est supprimée : barres et détail lisent tous deux `FAITS_IMMO`, dédoublonné et à la même date.
- Le panneau affiche « N événement(s) · coût estimé X € ». Ce total est calculé sur toutes les lignes correspondantes, pas seulement les 500 affichées, et doit correspondre à la barre cliquée.
- Une colonne **Coût estimé** est ajoutée au tableau, triable.
- Pendant une recherche, le résumé indique en plus le nombre de lignes et le coût filtrés.
- Les sous-titres « × 110 € » / « × 116 € » lisent maintenant le taux réel renvoyé par le serveur.
- ⚠️ **Conséquence :** les montants de l’item 2 changent en PA :
  - NC : 250 € ou coût du scénario au lieu de 300 € ;
  - MES : 110 €/h au lieu de 100 €/h.

  En TC, les NC gardent 300 € (aucun coût NC n’est configuré) et le MES passe à 116 €/h.
- Une NC ajoutée dans la feuille source n’apparaît dans l’item 2 qu’après l’actualisation suivante (6 h au plus, ou lancement manuel).

## 2. Audit design

| # | Constat | Statut |
| --- | --- | --- |
| D1 | Panneau de détail décalé (voir 1.1) | ✅ |
| D2 | Mobile : la page débordait de 120 px en largeur. Les grilles (`.shell`, `.workspace`, grilles de panneaux) n’avaient pas de `min-width: 0` ; un contenu large, comme le graphique TC à défilement horizontal, élargissait toute la page | ✅ garde-fous CSS ; le contenu large défile dans son panneau |
| D3 | Mobile : les 3 KPI de l’item 2 restaient sur 3 colonnes (la règle mobile était écrite avant la règle bureau, qui l’écrasait) | ✅ 2 colonnes sous 860 px, 1 colonne sous 480 px |
| D4 | Mobile : le panneau Filtres, ouvert par défaut, occupait tout le premier écran | ✅ replié par défaut sous 860 px, sauf préférence mémorisée |
| D5 | Contraste : barres orange pastel et grises ≈ 1,9:1 sur fond blanc (minimum recommandé 3:1 pour un élément graphique) | ✅ contour plus foncé ; la couleur de remplissage reste pastel |
| D6 | Tableau de détail : en-têtes des colonnes numériques alignés à gauche, valeurs à droite | ✅ en-têtes alignés à droite |
| D7 | Note du KPI « Coûts non traités » longue (4 montants) : elle passe sur 3 lignes dans une carte étroite | ⬜ déplacer le détail dans une info-bulle, ou l’afficher sous la légende de l’item 2 |
| D8 | Sélecteur « Origine des données » (liste native) visuellement différent des nouvelles listes à cases | ⬜ l’aligner sur le composant commun |
| D9 | Barres des graphiques non atteignables au clavier (limite de Google Charts) | ⬜ ajouter sous chaque graphique un tableau de données accessible |
| D10 | Colonne « Rapprochement » du détail : libellés longs sur 3 lignes | ⬜ libellé court et texte complet en info-bulle |

## 3. Audit données

### 3.1 Exports MES (UPA / MEDU et NC)

| Indicateur | PA | TC |
| --- | ---: | ---: |
| Lignes de l’export | 11 970 | 15 545 |
| Période couverte | janv. 2025 → août 2026 (20 mois) | **janv. 2026 → sept. 2026 (9 mois)** |
| Unité | 100 % « Structure PA A350 » | 100 % « Structure TC A350 » |
| Exclues (statut Supprimé / Rejeté) | 1 238 (10,3 %) | 1 003 (6,5 %) |
| **Aléas MES retenus (UPA / MEDU)** | **211** | **888** |
| NC MES (préparation Qualité, pas encore dans les KPI) | 7 348 | 10 168 |
| MSN renseigné | 100 % | 100 % |
| Temps aléas renseigné (> 0) | 99,5 % | 98,6 % |
| Heures d’indisponibilité cumulées | 245 h | 1 883 h |
| Durée médiane / 95ᵉ centile / max | 1 h / 3 h / 8 h | 1 h / 8 h / 60 h |
| **IMMO cité dans le champ source** (aléas MES) | **0,9 %** | **31 %** |
| Famille citée dans le champ source (aléas MES) | 0 % | 0 % |
| N° NC renseigné (NC MES) | 67,4 % | 70,9 % |
| N° de ticket en double | 0 | **37** (contenus différents) |

**Constats**
1. **PA : les aléas MES ne désignent presque jamais la machine.** Seuls 0,9 % citent un IMMO dans le champ prévu. L’item 1 et les graphiques par IMMO reposent donc sur la reconnaissance dans le commentaire, à vérifier avec le master réel. ⬜ Rendre le champ IMMO obligatoire dans MES pour l’objet « 0328 UPA MEDU ».
2. **Famille jamais renseignée à la source (0 %).** Elle est toujours déduite du master : un IMMO absent ou mal saisi fait disparaître l’aléa des graphiques par famille.
3. **TC : 37 tickets apparaissent plusieurs fois avec des contenus différents** (mise à jour du ticket dans Qlik). La déduplication par identifiant n’en garde qu’une version. ⬜ Vérifier dans Qlik si l’export doit contenir une ligne par ticket, et quelle version garder (la plus récente).
4. **TC : historique MES de 9 mois seulement.** Sur « 1 an » ou « Tout », les comparaisons MES TC couvrent moins que la période affichée. ⬜ Charger les exports 2025 si disponibles.
5. **TC : 5M non standard.** 407 lignes « DEFAUT TECHNIQUE », 379 « SYNCHRONISATION_ORGANISATION » et 49 « FOURNISSEUR » ne suivent pas la nomenclature `0x-…`. Elles ne sont donc jamais classées en aléa machine, même si certaines concernent un moyen. ⬜ Arbitrage métier : faut-il en retenir une partie ?
6. **Autres moyens non valorisés.** Seul l’objet « 0328 UPA MEDU » est compté comme indisponibilité machine. Des objets proches ne le sont pas : « 0344 Système d’aspiration » (172 PA / 150 TC), « 0337 IHM » (222 PA), « 0332 Outillage » (362 TC). ⬜ Décision métier : les inclure ou les afficher à part.
7. **Durées de plus de 24 h (3 aléas TC, jusqu’à 60 h).** Contrôlé : l’export utilise le format `[h]:mm:ss`, relu en texte (« 60:00:00 ») puis converti correctement en heures. Aucune perte de jours.
8. **Postes hors liste de filtre en TC.** « P365 » (86), « P360_PAT » (21) et « P370 PAT FREIGHTER » (1) sont consolidés mais absents de la liste du filtre Poste TC, figée sur 370/360/355 et leurs variantes. Ces lignes ne peuvent donc pas être isolées par le filtre. ⬜ Ajouter ces postes ou les rattacher à un poste parent.
9. PA : « P280 LIGHT » (7 lignes) est un libellé isolé, à rattacher à P280 si c’est le même poste.

### 3.2 Référentiels

| Référentiel | Constat | Impact | Statut |
| --- | --- | --- | --- |
| Planning MSN (BDD ZZKXM) | Rempli jusqu’en **juin 2026** (PA et TC) ; juillet à décembre vides | Sur une période qui inclut juillet–septembre, l’activité MSN est incomplète et le ratio « impacts / MSN » est **surestimé** | ⬜ Mettre à jour le planning, ou limiter le ratio aux mois renseignés et l’indiquer |
| TCD perçages PA | 92 familles, postes 280 / 290, total 16 953 perçages | Base du taux « / 1 000 perçages » | OK. Les espaces en début de nom de famille sont neutralisés par la normalisation |
| TCD perçages TC | 440 familles ; colonnes « WP ULR 1 », « P370 », « P360 ou P355 », « P360 », « P355 » | La colonne combinée « P360 ou P355 » ne peut pas être répartie par poste | ⬜ Clarifier la colonne combinée |

### 3.3 Plans d’actions MFT

Voir [ANALYSE-PLANS-ACTIONS-2026-09-29.md](ANALYSE-PLANS-ACTIONS-2026-09-29.md). Point bloquant inchangé : 35 à 67 % des actions n’ont ni IMMO ni famille lisible. Les machines concernées apparaissent « aucune action » à tort.

### 3.4 Cohérence interne après correction

- ✅ Barres de l’item 2, graphique MSN, KPI « Coûts non traités » et panneau de détail utilisent la même source (`FAITS_IMMO`) et la même règle de coût.
- ✅ Les aléas production Waterspiders encore présents dans d’anciens faits ou dans l’archive sont ignorés partout (graphiques, détail, NC).
- ⬜ Les **NC MES** (7 348 PA, 10 168 TC) restent hors des KPI tant que la validation Qualité n’est pas activée. Les KPI NC reposent uniquement sur la feuille `Données NC`, ce qui est conforme à la règle actuelle.

## 4. Priorités proposées

1. **Rendre l’IMMO obligatoire dans MES pour « 0328 UPA MEDU »**, surtout en PA (0,9 %). Sans IMMO, le rapprochement avec les plans d’actions et les coûts par machine reste faible.
2. **Mettre à jour le planning MSN** (juillet → décembre 2026).
3. **Traiter les 37 tickets TC en double** et les postes P365 / PAT.
4. Décider du périmètre « indisponibilité machine » : UPA / MEDU seul, ou aussi aspiration, IHM, outillage.
5. Recette de production : relever dans chaque classeur les taux IMMO / famille des `Données NC` et la couverture master, que les échantillons ne permettent pas de mesurer.

## 5. Parité PA / TC

Toutes les évolutions des 29 et 30/09 sont présentes dans les deux dashboards :
- couleurs et filtre du suivi plan d’actions, actions MFT au clic ;
- cache 6 h et préchauffage, contrôle d’accès, filtres en listes ;
- retrait de Waterspiders, coûts unifiés, panneau de détail, correctifs design.

Contrôle fait élément par élément sur le code.

- ✅ **Bug TC d’origine corrigé.** La lecture des plans MFT TC appelait `openSourceSpreadsheetWithRetry_`, qui n’existait que dans le code PA. L’erreur était interceptée silencieusement : en TC, le suivi des plans était toujours « indisponible » et toutes les barres restaient grises. Un test vérifie désormais qu’aucun appel ne vise une fonction absente.

Écarts volontaires, liés au périmètre :

| Sujet | PA | TC |
| --- | --- | --- |
| Postes | P280 / P290 | 370 / 360 / 355 et variantes (liste fixe) |
| Plans MFT | 1 classeur | 2 classeurs (370 ; 355/360/OSW) |
| Coût d’une NC | 250 € ou scénario Business Case | pas de coût configuré : 300 € par NC |
| Taux MES | 110 €/h | 116 €/h |
| Graphique de disponibilité | largeur fixe | défilement horizontal, libellés complets |

Écarts d’origine non modifiés :

| Sujet | PA | TC | Recommandation |
| --- | --- | --- | --- |
| Écriture de `FAITS_IMMO` | réécriture sur place par lots, avec nouvel essai | feuille de publication temporaire puis bascule | ⬜ Aligner TC sur PA après une recette sur copie du classeur |
| Coût d’une NC | scénarios Business Case | aucun | ⬜ Renseigner `COUT_MOYEN_NC_EUR` TC si un coût de référence existe |
