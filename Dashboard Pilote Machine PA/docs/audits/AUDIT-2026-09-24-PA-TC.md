# Audit PA / TC - détails, qualité des données et cache

**Date :** 24/09/2026  
**Périmètre :** dépôts PA et TC, Apps Script et interface. Aucun accès authentifié aux classeurs Google en production ; les chiffres réels des sources ne sont donc pas vérifiables localement.

## Constats et corrections

| Priorité | Constat établi dans le code | Correction / risque restant |
| --- | --- | --- |
| P1 | La vue Aléas production reconstruit les faits depuis la source ; les recherches et les détails lisaient `FAITS_IMMO`. Deux générations de données pouvaient diverger. | Même lecture directe pour la vue, sa recherche et ses détails. Les détails directs ne sont pas conservés dans le cache des faits. Vérifier la charge de lecture sur le classeur source. |
| P1 | Les graphes source affichent des libellés de repli (poste, type, catégorie, problème inconnus), mais le détail comparait ces libellés à des cellules vides. | Correspondance alignée sur les libellés des graphes dans PA et TC. |
| P2 | Le détail de disponibilité TC pouvait inclure des problèmes MES exclus du graphique de disponibilité. | Même prédicat de problème et même source MES dans le graphique et le détail. |
| P1 | Le nettoyage recherchait trois underscores au lieu des deux underscores de `FAITS_IMMO__PUBLICATION_*`. Les onglets orphelins restaient visibles. | Noms corrigés ; les onglets vides sont supprimés, les onglets non vides sont masqués sans perte. Commande manuelle dans le menu Automatisation. |
| P2 | Un identifiant de publication non achevée pouvait être choisi comme feuille active malgré la présence d'un `FAITS_IMMO` publié. | La feuille canonique non vide est prioritaire. La publication en cours est masquée puis la feuille finale est réaffichée. |
| P2 | Les regroupements par famille PA / TC recréaient « Famille non renseignée » sur plusieurs graphiques de temps et de coût. | Les faits sans famille restent dans les totaux et dans l'audit qualité ; seuls les regroupements familiaux les écartent. Aucune donnée brute n'est supprimée. |
| P2 | Le filtre Poste PA était une recherche libre partielle ; TC utilisait une sélection multiple occupant dix lignes. | Sélecteur compact à cases : postes PA présents et conformes au périmètre P280/P290 ; postes TC 370/360/355 et variantes autorisées. Filtres PA des faits, sources brutes et MES synchronisés. |
| P2 | Les réponses analytiques expirent et les grandes réponses dépassant 95 Ko ne sont pas enregistrées. | TTL porté de 15 à 60 minutes, clé de version renouvelée et préchauffage **optionnel** de la vue annuelle toutes les 30 minutes. Les réponses trop grandes et les lectures directes restent recalculées. |

## Audit des données à exécuter dans chaque classeur

1. Dans la vue « Qualité des données », relever pour **PA et TC séparément** les lignes brutes, les lignes retenues, les exclusions par motif, les taux de famille et d'IMMO, les rapprochements master/MES et les erreurs `JOURNAL_IMPORT` ; comparer avec le dernier rafraîchissement. Ces valeurs ne peuvent pas être déduites d'une capture d'écran du guide.
2. Comparer les postes uniques de `FAITS_IMMO`, des aléas source et des NC : PA doit présenter les codes P280/P290 attendus, TC les codes 370/360/355 et variantes. Examiner à part les postes inconnus ou hors périmètre plutôt que les renommer automatiquement.
3. Sur une même période, comparer les totaux par source, les événements sans famille et les familles classées : l'écart entre total et somme par famille est attendu pour les lignes sans famille. Corriger à la source ou via le master après vérification de l'IMMO, sans inventer de famille.
4. Tester un détail par poste, semaine, problème « Non renseigné » et famille dans chaque vue ; pour Aléas production, comparer le nombre affiché au nombre de lignes de la source courante après filtres. Vérifier aussi le cas de la période « Toute la période » et des archives.
5. Exécuter « Dashboard Machine » > « Automatisation » > « Nettoyer les onglets temporaires » sur chaque classeur après déploiement. Contrôler que `FAITS_IMMO` et `FAITS_IMMO_ARCHIVES` ne sont pas touchés ; inspecter les anciennes feuilles non vides masquées avant toute suppression manuelle.

## Cache et exploitation

Google recommande les lectures/écritures Sheets par lot et `CacheService` pour les ressources lentes. Le cache Apps Script est temporaire : une entrée peut être évincée avant son TTL, les clés sont limitées à 250 caractères et les valeurs à 100 Ko. Un `cache.txt` Drive ajouterait des accès réseau et de la synchronisation, sans apporter de garantie de cohérence. Le cache applicatif actuel est indexé par version de publication ; le préchauffage ne concerne que le filtre annuel sans poste, famille ni source. Installer le déclencheur via le menu seulement après contrôle des quotas et de la durée des exécutions. Ne pas installer un second déclencheur de reconstruction si l'actualisation toutes les six heures est déjà active.

Références : https://developers.google.com/apps-script/reference/cache/cache ; https://developers.google.com/apps-script/reference/cache/cache-service ; https://developers.google.com/apps-script/guides/support/best-practices ; https://developers.google.com/apps-script/guides/triggers/installable

## Validation et réserves

Les tests du dépôt couvrent notamment le nettoyage des onglets, les libellés manquants, la sélection de postes PA, les publications interrompues et le détail de disponibilité TC. L'analyse statique VS Code ne signale pas d'erreur, mais les tests Node n'ont pas pu être exécutés : `node`, `npm` et `git` sont absents et le téléchargement du runtime retourne un proxy 407. La recette réelle des fichiers Google, les taux de qualité, les mesures de latence, les quotas de déclencheurs et les clics dans l'interface déployée nécessitent un compte ayant accès aux deux classeurs. Aucun chiffre de production ni gain de performance mesuré n'est revendiqué ici.