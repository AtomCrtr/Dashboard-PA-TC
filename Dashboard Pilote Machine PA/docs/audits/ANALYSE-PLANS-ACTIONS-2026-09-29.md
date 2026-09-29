# Analyse des plans d’actions aléas machines PA et TC

**Date :** 29/09/2026
**Sources analysées :** `data/samples/Plan actions aléas machines PA 2026.xlsx` (PA), `Plan actions aléas machines 355_360_OSW 2026.xlsx` et `Plan actions aléas machines 370 2026.xlsx` (TC). Ce sont les exports locaux des classeurs ; les chiffres sont à revérifier sur les classeurs Google en production.

## 1. Nouvelle règle de couleur (item 2 du Pilotage)

| Couleur | Règle appliquée par le dashboard |
| --- | --- |
| **Vert** | Action clôturée et prise en compte (`Done`) **dans les 6 derniers mois**, sans autre action ouverte |
| **Bleu** | Action ouverte / en cours : `Open`, `Due` (en retard) ou action récente sans statut |
| **Orange pastel** | Dernière action clôturée depuis **plus de 6 mois** et la machine génère de nouveau des coûts : le problème revient |
| **Rouge** | Action non prise en compte : aucune action, ou action seulement reportée (`Deferred`) / abandonnée |
| Gris | Plan illisible : couleur impossible à déterminer |

Une barre n’apparaît que si la machine a des coûts sur la période filtrée : une barre orange signifie donc que des coûts réapparaissent après une action ancienne. Priorité si plusieurs actions portent sur la même machine : bleu > vert > orange > rouge.

Les onglets du plan n’ont pas de colonne « date de clôture ». Le dashboard la reconstitue à partir des onglets datés : la date de clôture est celle de la première réunion où l’action passe à `Done`. À défaut, il prend la dernière date citée dans le commentaire, puis l’échéance. Sur les 3 classeurs, la méthode donne le résultat suivant :

| Méthode de datation | PA | TC 355/360/OSW | TC 370 |
| --- | ---: | ---: | ---: |
| Passage à `Done` entre deux réunions | 33 | 24 | 32 |
| Date trouvée dans le commentaire | 26 | 15 | 31 |
| Échéance | 8 | 1 | 3 |
| Non datable | 0 | 0 | 1 |

## 2. Photographie des plans au 29/09/2026

| | PA (réunion du 03/09) | TC 355/360/OSW (17/09) | TC 370 (24/09) |
| --- | ---: | ---: | ---: |
| Actions dans le dernier onglet | 79 | 63 | 43 |
| **Bleu** : ouvertes / en cours | 8 | **21** | 13 |
| **Vert** : clôturées depuis moins de 6 mois | 12 | 17 | 20 |
| **Orange pastel** : clôturées depuis plus de 6 mois | 55 | 23 | 6 |
| **Rouge** : reportées / abandonnées | 4 | 2 | 4 |
| Ouvertes **en retard** (échéance dépassée) | 3 | **19** | 10 |
| … dont plus de 90 jours de retard | 2 | **12** | 3 |
| Reportées (`Deferred`) | 4 | 2 | 4 |
| Âge médian d’une action ouverte | 131 j | 140 j | 123 j |
| Action ouverte la plus ancienne | 285 j | **544 j** | 327 j |
| Actions sans IMMO ni famille lisible dans « Issue » | 28 (35 %) | 29 (46 %) | 29 (67 %) |

### Constats

1. **Le TC 355/360/OSW accumule les retards** : 19 des 21 actions ouvertes ont une échéance dépassée, dont 12 de plus de 90 jours. Les plus anciennes sont les réf. 170 (parc M4 hors référentiel, échéance 02/09/2025), 180 (NZV0039, 17/07/2025), 186 (visseuse, 18/09/2025) et 187 (201-M2-023, 30/10/2025). Le statut `Due` est posé, mais les dates ne sont pas replanifiées.
2. **Le PA est surtout orange par ancienneté** : 55 actions sont clôturées depuis plus de 6 mois. Si la machine génère encore des coûts, sa barre passe en orange : le problème revient et l’action ancienne doit être rouverte ou complétée.
3. **Les actions reportées ne sont pas revues** : PA 267 (échéance 15/01/2026), 281 et 284 (19/03/2026), TC 355 réf. 168 (24/04/2025) et TC 370 réf. 328 (30/01/2026). Leurs échéances sont dépassées sans nouvelle date.
4. **Une grande partie des actions ne peut pas être reliée à une machine** (35 à 67 %). L’IMMO ou la famille n’est lisible que dans le texte libre « Issue », par exemple « Batteries et chargeurs », « GO NOGO », « Budget » ou « Moyens uniques ». Ces actions n’apparaissent sur aucune barre. La machine concernée reste donc rouge (aucune action trouvée) alors qu’une action existe.
5. **Les échéances ne sont pas toujours des dates** : on trouve « 2025 » (6 actions PA), « Fin 2025 » (TC 370 réf. 318 et 319), « Fin mars 2025 » ou des cellules vides (4 actions PA ouvertes). Le retard de ces actions ne peut pas être calculé.
6. **Les responsables sont souvent des services** (« Méthode », « Moyens », « Projet ») et non des personnes, surtout pour les actions ouvertes TC 355. Personne n’est alors clairement chargé de la relance.
7. **Les en-têtes des onglets ne sont pas mis à jour** : l’onglet PA `03092026` indique « Réunion du 11/06/2026 », et l’onglet TC 355 `03092026` indique « Réunion du 27 Août 2026 ».
8. **Les onglets sont nommés et structurés différemment** : `MFT ALEAS MACHINES PA 03092026` et `MFT ALEAS MACHINES 370 24092026` placent la date à la fin, `17092026 MFT ALEAS MACHINES 355` la place au début. Le fichier 355 n’a pas de colonne « Priorité ». Le dernier onglet 370 est passé de 32 à 13 colonnes.
9. **Des actions sont purgées** : 41 actions terminées ont disparu du plan 370 en février 2026. Si l’historique n’est pas conservé, le passage au bleu (terminée depuis moins de 6 mois) ne peut plus être établi.
10. **Le classeur PA a deux sources de vérité** : il contient à la fois les onglets datés et les tables normalisées `MFT_ACTIONS_OFFICIEL`, `MFT_SUIVI_OFFICIEL` et `MFT_REUNIONS_OFFICIEL`. Le dashboard lit les onglets datés tant qu’ils existent.

## 3. Proposition de meilleure organisation

### 3.1 Un seul tableau vivant par périmètre au lieu d’un onglet copié à chaque réunion

| Onglet | Contenu | Règle |
| --- | --- | --- |
| `ACTIONS` | Une ligne par action, jamais supprimée | Colonnes ci-dessous, statut par liste déroulante |
| `SUIVI` | Une ligne par commentaire daté (réf., date, auteur, texte) | Remplace les commentaires « 13/07/2023 : … » cumulés dans une cellule |
| `REUNIONS` | Date, participants, prochaine réunion | Alimente l’en-tête, plus de recopie manuelle |

Les tables `MFT_*_OFFICIEL` du classeur PA correspondent déjà à cette structure, et le dashboard sait les lire (colonne `DATE_CLOTURE`). Pour conserver une trace de chaque réunion, on peut utiliser un export PDF ou l’historique des versions Google Sheets plutôt que de dupliquer l’onglet.

### 3.2 Colonnes obligatoires

| Colonne | Format | Pourquoi |
| --- | --- | --- |
| `IMMO` | Liste validée depuis le master (plusieurs valeurs séparées par `;`) | Relier l’action aux barres du dashboard |
| `Famille` | Liste validée depuis le master | Idem, quand l’action concerne toute une famille |
| `Poste` | 280/290 (PA), 355/360/370 (TC) | Filtrer par poste |
| `Pilote` | Une personne nommée (et les contributeurs à part) | Relances |
| `Échéance` | Date uniquement | Calculer le retard |
| `Statut` | `Ouverte`, `Terminée`, `Reportée`, `Abandonnée` | Supprimer `Due` : le retard se calcule (échéance < aujourd’hui) |
| `Date de clôture` | Date, obligatoire quand le statut passe à `Terminée` | Règle des 6 mois exacte, sans reconstitution |
| `Priorité` | 1 / 2 / 3 | Présente aujourd’hui en PA et en 370, absente en 355 |
| `Réexamen` | Date, obligatoire si `Reportée` | Éviter les reports sans fin |

Un script `onEdit` ou une formule peut remplir `Date de clôture` automatiquement au passage à `Terminée`.

### 3.3 Rituel de revue MFT

1. Ouvrir le Pilotage, item 2, sur la période de la réunion, et commencer par les **barres rouges les plus coûteuses** (aucune action) puis les **oranges** (problème qui revient) : chacune demande une action ou une justification.
2. Passer ensuite les **actions en retard** : replanifier avec une date, clôturer ou reporter avec une date de réexamen.
3. Vérifier les **barres vertes dont les coûts continuent** : si les coûts remontent après la clôture, l’action n’a pas été efficace.
4. Suivre 4 indicateurs d’une réunion à l’autre : part des coûts en rouge ou orange (KPI « Coûts non traités »), nombre d’actions en retard, âge médian des actions ouvertes, nombre d’actions terminées dans le mois.

### 3.4 Actions immédiates proposées

- TC 355/360/OSW : revoir les 12 actions en retard de plus de 90 jours, en commençant par les réf. 170, 180, 186 et 187.
- PA : décider pour les actions reportées 267, 281 et 284, et dater les actions ouvertes 293, 294, 296 et 297.
- TC 370 : remplacer « Fin 2025 » par une date (réf. 318, 319) et revoir la réf. 323 (échéance 18/12/2025).
- Tous les plans : compléter IMMO/famille sur les actions ouvertes pour qu’elles colorent les bonnes barres.

## 4. Améliorations apportées au code (29/09/2026)

- **Couleurs vert / bleu / orange pastel / rouge** sur les graphiques de coût par famille et par IMMO, avec une légende indiquant le nombre d’actions par couleur, une info-bulle par barre et le détail par couleur dans le KPI « Coûts non traités ». Le calcul est identique en PA et en TC.
- **Filtres en listes déroulantes** (Poste, Famille, IMMO, MSN) : recherche, sélection multiple, variantes de poste regroupées.
- **Historique des plans** : lecture des onglets des 6 derniers mois et de l’onglet précédent, au lieu du seul dernier onglet, pour dater les clôtures. Le cache garde le résultat 60 minutes (clé renouvelée).
- **Rapidité** : suppression d’une instruction globale dans `MesImport.gs` qui lançait une recherche Drive (et pouvait créer un dossier « MES A DEPOSER ») **à chaque appel serveur**, donc à chaque chargement ou filtre du dashboard.
- **Fluidité** : les graphiques ne sont plus redessinés deux fois à chaque redimensionnement, ni en boucle quand leur propre hauteur change. La recherche dans le détail est différée de 120 ms et met en cache le texte normalisé des lignes.
- **Fiabilité** : famille citée dans un commentaire MES (le jeton le plus précis l’emporte), durées Sheets arrondies à la seconde, IMMO validé par la Qualité conservé hors master, libellés « hors périmètre TC » corrigés dans le dashboard TC.
- **Tests** : les deux suites échouaient dès la première assertion. Elles sont réalignées sur le code et couvrent la nouvelle règle de couleur (`npm test` dans chaque dossier).

## 5. Pistes d’amélioration restantes

1. **Une base de code commune PA/TC** : les deux copies divergent (tests TC recopiés du PA, libellés « PA » dans le code TC). Une bibliothèque Apps Script partagée, avec un fichier de configuration par périmètre, éviterait ces écarts.
2. **Tests automatiques sur GitHub** : exécuter `npm test` à chaque push pour que les tests ne redeviennent pas obsolètes.
3. **Lien aléa → action** : afficher dans le détail d’une barre les actions MFT associées (réf., statut, échéance), pas seulement la couleur.
4. **Croiser coûts et plans** : liste des familles rouges triées par coût, exportable pour préparer la réunion MFT.
5. Les points déjà relevés dans les audits précédents restent ouverts : autorisation serveur par rôle, icônes Lucide chargées depuis un CDN, pagination des historiques volumineux.
