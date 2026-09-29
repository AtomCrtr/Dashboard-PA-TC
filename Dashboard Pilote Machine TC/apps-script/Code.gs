function onOpen() {
  try {
    ensureUsageGuide_(SpreadsheetApp.getActive());
  } catch (error) {
    console.warn(`Impossible de préparer le guide d’utilisation : ${error.message || error}`);
  }
  const ui = SpreadsheetApp.getUi();
  ui
    .createMenu('Dashboard Machine')
    .addItem('Actualiser toutes les données', 'actualiserTout')
    .addItem('Importer les extractions MES', 'importerNouveauxFichiersMes')
    .addSeparator()
    .addSubMenu(ui.createMenu('Configuration et maintenance')
      .addItem('Initialiser l’application', 'initialiserApplication')
      .addItem('Synchroniser les IDs des sources connues', 'synchroniserSourcesConnues')
      .addItem('Archiver les faits de plus de 24 mois', 'archiverFactsHistoriques')
      .addItem('Reconstruire l’historique MES', 'reconstruireHistoriqueMes')
      .addItem('Créer le dossier de dépôt MES', 'configurerDossierMes')
      .addItem('Configurer le classeur MFT TC', 'configurerClasseurMft')
      .addItem('Diagnostiquer le classeur MFT TC', 'diagnostiquerClasseurMft')
      .addItem('Initialiser / migrer la table MFT officielle', 'initialiserTableMftOfficielle'))
    .addSubMenu(ui.createMenu('Automatisation')
      .addItem('Installer l’actualisation automatique', 'installerDeclencheur')
      .addItem('Installer le préchauffage du cache', 'installerPrechauffageCache')
      .addItem('Nettoyer les onglets temporaires', 'nettoyerOngletsTemporaires'))
    .addToUi();

  ui
    .createMenu('NC Qualité - Préparation')
    .addItem('1. Ouvrir les NC à compléter', 'ouvrirNcPourPreparation')
    .addItem('2. Soumettre les lignes sélectionnées', 'soumettreNcPrevisionnelles')
    .addToUi();

  SpreadsheetApp.getUi()
    .createMenu('NC Qualité')
    .addItem('1. Ouvrir les NC soumises', 'ouvrirNcPourQualite')
    .addItem('2. Enregistrer les décisions', 'enregistrerDecisionsQualite')
    .addItem('3. Actualiser après validation', 'actualiserApresValidationNc')
    .addToUi();
}

function usageGuideRows_() {
  return [
    ['GUIDE D’UTILISATION', APP.scope.label],
    ['1. Télécharger le tableau MES dans Qlik Sense', 'Ouvrez le tableau MES, cliquez sur « ⋯ » (Plus d’actions), puis « Télécharger sous… » > « Données ». Choisissez Excel (.xlsx) ou CSV, pas PDF ni image.'],
    ['2. Déposer le fichier', 'Déposez le fichier téléchargé dans le dossier Google Drive « MES A DEPOSER » configuré pour ce classeur. Ne le laissez pas uniquement dans les téléchargements de votre ordinateur.'],
    ['3. Importer les extractions MES', 'Dans le classeur, cliquez sur le menu « Dashboard Machine » > « Importer les extractions MES ». Attendez le message de fin. Les fichiers importés sans erreur sont rangés dans « Archives ».'],
    ['4. Actualiser les données', 'Dans le même menu, cliquez sur « Dashboard Machine » > « Actualiser toutes les données ». Attendez le message indiquant le nombre d’événements actualisés. Cette étape reconstruit FAITS_IMMO et invalide le cache analytique.'],
    ['5. Rafraîchir le dashboard ouvert', 'Cliquez en haut à droite sur « Recharger les données publiées » pour afficher rapidement les faits déjà consolidés, sans ouvrir les fichiers sources. Pour intégrer de nouveaux fichiers, lancez « Actualiser toutes les données » depuis le menu du classeur.'],
    ['Dossier non configuré', 'Cliquez sur « Dashboard Machine » > « Configuration et maintenance » > « Créer le dossier de dépôt MES », puis déposez les fichiers dans « MES A DEPOSER ».'],
    ['En cas d’erreur', 'Consultez JOURNAL_IMPORT. Vérifiez le format CSV/XLSX, le dossier de dépôt configuré et le message associé à la ligne en erreur avant de relancer l’import.']
  ];
}

function ensureUsageGuide_(spreadsheet) {
  const guide = spreadsheet.getSheetByName(APP.sheets.usageGuide) || spreadsheet.insertSheet(APP.sheets.usageGuide);
  if (guide.isSheetHidden()) guide.showSheet();
  if (guide.getLastRow() === 0) {
    const rows = usageGuideRows_();
    replaceSheetData_(guide, rows);
    guide.setFrozenRows(1);
    guide.setColumnWidth(1, 310);
    guide.setColumnWidth(2, 850);
    guide.getRange(1, 1, rows.length, 2).setWrap(true);
    guide.getRange(1, 1, 1, 2).setBackground('#17324d').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14);
    guide.getRange(2, 1, rows.length - 1, 2).setVerticalAlignment('top');
    guide.getRange(2, 1, rows.length - 1, 1).setFontWeight('bold');
    guide.autoResizeRows(1, rows.length);
  }
  if (guide.getLastRow() >= 6 && clean_(guide.getRange(6, 2).getValue()).includes('Actualiser les données sources')) {
    guide.getRange(6, 2).setValue(usageGuideRows_()[5][1]);
  }
  if (guide.getIndex() !== 1) {
    const activeSheet = spreadsheet.getActiveSheet();
    guide.activate();
    spreadsheet.moveActiveSheet(1);
    if (activeSheet && activeSheet.getSheetId() !== guide.getSheetId()) spreadsheet.setActiveSheet(activeSheet);
  }
  return guide;
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dashboard Pilote Machine TC');
}

function initialiserApplication() {
  const spreadsheet = SpreadsheetApp.getActive();
  ensureUsageGuide_(spreadsheet);
  const parameters = ensureSheet_(spreadsheet, APP.sheets.parameters);
  const current = parameters.getLastRow() > 0
    ? Object.fromEntries(parameters.getDataRange().getDisplayValues().slice(1).map(row => [row[0], row[1]]))
    : {};
  migrateSecureParameters_(current, spreadsheet);

  const defaults = Object.entries(APP.parameterDefaults).filter(([key]) => !isSecureParameter_(key)).map(([key, value]) => {
    if (current[key] !== undefined && current[key] !== '') return [key, current[key]];
    return [key, value];
  });

  replaceSheetData_(parameters, [['CLE', 'VALEUR'], ...defaults]);
  parameters.setFrozenRows(1);
  parameters.autoResizeColumns(1, 2);
  styleHeader_(parameters, 2);

  const facts = getActiveFactsSheet_(spreadsheet);
  cleanupStaleFactsPublicationSheets_(spreadsheet, facts);
  const factsSchema = ensureFactsSchema_(facts);
  if (factsSchema.needsRefresh) PropertiesService.getScriptProperties().setProperty('FACTS_SCHEMA_REBUILD_REQUIRED', 'OUI');
  const controls = ensureSheet_(spreadsheet, APP.sheets.controls);
  if (controls.getLastRow() === 0) replaceSheetData_(controls, [['TYPE_CONTROLE', 'IMMO', 'DETAIL', 'NOMBRE']]);
  const log = ensureSheet_(spreadsheet, APP.sheets.importLog);
  if (log.getLastRow() === 0) replaceSheetData_(log, [['DATE_IMPORT', 'ID_FICHIER', 'NOM_FICHIER', 'STATUT', 'LIGNES', 'MESSAGE']]);
  const staging = ensureSheet_(spreadsheet, APP.sheets.mesStaging);
  ensureMesStagingSchema_(staging);
  const mesPreNc = ensureSheet_(spreadsheet, APP.sheets.mesPreNc);
  ensureMesPreNcSchema_(mesPreNc);
  applyMesPreNcWorkflowValidation_(mesPreNc, mesPreNcHeaders_());
  const mftActions = spreadsheet.getSheetByName(APP.sheets.mftActions);
  if (mftActions) ensureMftActionsSchema_(mftActions);

  [facts, controls, log, staging, mesPreNc, mftActions].filter(Boolean).forEach(sheet => {
    sheet.setFrozenRows(1);
    styleHeader_(sheet, sheet.getLastColumn());
  });
  styleMesPreNcSheet_(mesPreNc, mesPreNcHeaders_());
  let mftMessage = '';
  try {
    const mft = initializeOfficialMftRepository_();
    mftMessage = ` Table MFT officielle prête (${mft.actionsImported} action(s) importée(s)).`;
  } catch (error) {
    mftMessage = ` Table MFT à initialiser séparément : ${error.message || String(error)}`;
  }
  SpreadsheetApp.getActive().toast(`Initialisation terminée.${mftMessage}`, 'Dashboard Machine', 12);
}

function actualiserTout() {
  return withScriptLock_(actualiserToutUnlocked_);
}

function diagnostiquerDatesAleasProduction() {
  const parameters = getParameters_();
  const spreadsheet = SpreadsheetApp.openById(parameters.ID_FICHIER_ALEAS);
  const sheet = findSourceSheet_(spreadsheet, APP.sourceSheets.aleas);
  if (!sheet) throw new Error(`Feuille introuvable : « ${APP.sourceSheets.aleas} ».`);
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();
  const sourceHeaders = (values.shift() || []).map(clean_);
  displayValues.shift();
  const headers = canonicalizeSourceHeaders_(sourceHeaders, values, APP.sourceSheets.aleas);
  const dateColumn = headers.findIndex(header => normalizeHeader_(header) === normalizeHeader_('Date'));
  if (dateColumn < 0) throw new Error('Colonne « Date » introuvable dans la source aléas.');
  const sourceRows = values.filter(row => row.some(value => clean_(value) !== ''));
  const factsSheet = getActiveFactsSheet_(SpreadsheetApp.getActive());
  const factsValues = factsSheet && factsSheet.getLastRow() > 1 ? factsSheet.getDataRange().getValues() : [];
  const factsHeaders = factsValues.length ? factsValues.shift().map(clean_) : [];
  const factsSourceColumn = factsHeaders.indexOf('SOURCE');
  const factsDateColumn = factsHeaders.indexOf('DATE');
  const aleaFacts = factsValues.filter(row => clean_(row[factsSourceColumn]) === 'ALEA');
  const summarize = (rows, column) => ({
    total: rows.length,
    nonEmpty: rows.filter(row => clean_(row[column]) !== '').length,
    parseable: rows.filter(row => parseDate_(row[column])).length,
    samples: rows.slice(0, 8).map((row, index) => ({
      row: index + 2,
      raw: row[column],
      display: displayValues[index] ? displayValues[index][column] : '',
      type: Object.prototype.toString.call(row[column]),
      parsed: dateKey_(parseDate_(row[column]))
    }))
  });
  return {
    sourceSheet: sheet.getName(),
    sourceDateColumn: headers[dateColumn],
    source: summarize(sourceRows, dateColumn),
    factsAleas: summarize(aleaFacts, factsDateColumn),
    generatedAt: new Date().toISOString()
  };
}

function actualiserToutUnlocked_() {
    const startedAt = new Date();
    const parameters = getParameters_();
    validateCoreParameters_(parameters);
    const masterRows = readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master);
    const master = enrichMasterWithDocMartin_(buildMasterIndex_(masterRows), readDocMartinEquipmentRecords_(parameters));
  importerNouveauxFichiersMes_(parameters, master);
    const facts = [];

    const aleasRows = readRecords_(parameters.ID_FICHIER_ALEAS, APP.sourceSheets.aleas);
    appendFacts_(facts, aleasRows, 'ALEA', APP.aliases.aleas, master, parameters, APP.sourceSheets.aleas);
    assertAleaConsolidation_(aleasRows, facts);

    const mesRows = readStagedMes_();
    if (parameters.ID_FICHIER_NC) {
      const ncSpreadsheet = SpreadsheetApp.openById(parameters.ID_FICHIER_NC);
      if (findSourceSheet_(ncSpreadsheet, APP.sourceSheets.nc)) {
        const ncRows = readRecords_(parameters.ID_FICHIER_NC, APP.sourceSheets.nc);
        appendFacts_(facts, ncRows, 'NC', APP.aliases.nc, master, parameters, APP.sourceSheets.nc);
      }
    }
    const workflowRows = writeMesPreNc_(mesRows);
    appendStagedMesFacts_(facts, mesRows.filter(row => clean_(row.SOURCE) !== 'NC'), master, parameters);

    const deduplicated = deduplicateFacts_(facts);
    const retained = partitionFactsByRetention_(deduplicated, new Date(), 1);
    const archiveResult = appendArchivedFacts_(retained.archived, new Date());
    writeFacts_(retained.active);
    writeControls_(retained.active, master);
    PropertiesService.getScriptProperties().setProperties({
      LAST_REFRESH: startedAt.toISOString(),
      LAST_REFRESH_ROWS: String(retained.active.length),
      LAST_ARCHIVE_ROWS: String(archiveResult.count),
      LAST_ARCHIVE_UPDATES: String(archiveResult.updated)
    });
    const archiveMessage = archiveResult.updated
      ? `${archiveResult.count} nouvel(aux) fait(s) archivé(s) ; ${archiveResult.updated} fait(s) archivé(s) mis à jour.`
      : `${archiveResult.count} nouvel(aux) fait(s) archivé(s).`;
    SpreadsheetApp.getActive().toast(`${retained.active.length} événements actifs ; ${archiveMessage}`, 'Dashboard Machine', 8);
    return { rows: retained.active.length, archived: archiveResult.count, archiveUpdates: archiveResult.updated, refreshedAt: startedAt.toISOString() };
}

function installerDeclencheur() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'actualiserTout')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('actualiserTout').timeBased().everyHours(6).create();
  SpreadsheetApp.getActive().toast('Actualisation automatique installée toutes les 6 heures.', 'Dashboard Machine', 8);
}

function installerPrechauffageCache() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'prechaufferCacheDashboard')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('prechaufferCacheDashboard').timeBased().everyMinutes(30).create();
  prechaufferCacheDashboard();
  SpreadsheetApp.getActive().toast('Préchauffage de la vue annuelle installé toutes les 30 minutes.', 'Dashboard Machine', 8);
}

function prechaufferCacheDashboard() {
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(today.getFullYear() - 1);
  return getDashboardData({ family: '', source: '', immo: '', station: [], msn: '', from: dateKey_(yearAgo), to: dateKey_(today) });
}

function ouvrirNcPourPreparation() {
  return ouvrirNcWorkflow_(['A_COMPLETER', 'A_CORRIGER'], 'NC Qualité - Préparation');
}

function ouvrirNcPourQualite() {
  return ouvrirNcWorkflow_(['SOUMIS'], 'NC Qualité');
}

function actualiserApresValidationNc() {
  return actualiserTout();
}

function ouvrirNcWorkflow_(statuses, roleLabel) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = ensureSheet_(spreadsheet, APP.sheets.mesPreNc);
  ensureMesPreNcSchema_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sortMesPreNcSheet_(sheet, headers);
  applyMesPreNcWorkflowValidation_(sheet, headers);
  const statusColumn = headers.indexOf('STATUT_WORKFLOW') + 1;
  const filterRange = sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), headers.length);
  const filter = sheet.getFilter() || filterRange.createFilter();
  filter.setColumnFilterCriteria(statusColumn, SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(mesPreNcHiddenWorkflowStatuses_(statuses))
    .build());
  sheet.activate();
  sheet.getRange(Math.min(2, sheet.getMaxRows()), 1).activate();
  SpreadsheetApp.getActive().toast(`${roleLabel} : ${statuses.join(' / ')} affiché(s).`, 'Workflow NC', 6);
  return { sheet: APP.sheets.mesPreNc, statuses };
}

function soumettreNcPrevisionnelles() {
  return withScriptLock_(() => {
    const context = selectedMesPreNcRows_();
    const now = new Date();
    const user = workflowUser_();
    const errors = [];
    let submitted = 0;
    context.selected.forEach(item => {
      const row = item.values;
      const immo = clean_(row[context.index.IMMO_SAISI]) || clean_(row[context.index.IMMO]);
      const family = clean_(row[context.index.FAMILLE_SAISIE]) || clean_(row[context.index.FAMILLE]);
      const currentStatus = clean_(row[context.index.STATUT_WORKFLOW]);
      if (!immo && !family) {
        errors.push(`Ligne ${item.rowNumber} : renseignez un IMMO ou une famille.`);
        return;
      }
      if (['VALIDEE', 'REJETEE'].includes(currentStatus)) {
        errors.push(`Ligne ${item.rowNumber} : statut ${currentStatus} non resoumis.`);
        return;
      }
      context.sheet.getRange(item.rowNumber, context.index.STATUT_WORKFLOW + 1).setValue('SOUMIS');
      context.sheet.getRange(item.rowNumber, context.index.DATE_SOUMISSION + 1).setValue(now);
      context.sheet.getRange(item.rowNumber, context.index.SOUMIS_PAR + 1).setValue(user);
      context.sheet.getRange(item.rowNumber, context.index.DECISION_QUALITE + 1).clearContent();
      submitted += 1;
    });
    const message = `${submitted} ligne(s) soumise(s)${errors.length ? ` ; ${errors.length} erreur(s)` : ''}.`;
    SpreadsheetApp.getActive().toast(message, 'Workflow NC', 8);
    return { submitted, errors };
  });
}

function enregistrerDecisionsQualite() {
  return withScriptLock_(() => {
    const context = selectedMesPreNcRows_();
    const now = new Date();
    const user = workflowUser_();
    const decisions = ['VALIDEE', 'A_CORRIGER', 'REJETEE'];
    const errors = [];
    let processed = 0;
    context.selected.forEach(item => {
      const row = item.values;
      const decision = clean_(row[context.index.DECISION_QUALITE]).toUpperCase();
      if (!decisions.includes(decision)) {
        errors.push(`Ligne ${item.rowNumber} : choisissez VALIDEE, A_CORRIGER ou REJETEE.`);
        return;
      }
      if (clean_(row[context.index.STATUT_WORKFLOW]) !== 'SOUMIS') {
        errors.push(`Ligne ${item.rowNumber} : la ligne doit être au statut SOUMIS.`);
        return;
      }
      context.sheet.getRange(item.rowNumber, context.index.STATUT_WORKFLOW + 1).setValue(decision);
      context.sheet.getRange(item.rowNumber, context.index.DATE_VALIDATION + 1).setValue(now);
      context.sheet.getRange(item.rowNumber, context.index.VALIDE_PAR + 1).setValue(user);
      processed += 1;
    });
    const message = `${processed} décision(s) qualité enregistrée(s)${errors.length ? ` ; ${errors.length} erreur(s)` : ''}.`;
    SpreadsheetApp.getActive().toast(message, 'Workflow NC', 8);
    return { processed, errors };
  });
}

function selectedMesPreNcRows_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getActiveSheet();
  if (!sheet || sheet.getName() !== APP.sheets.mesPreNc) {
    throw new Error(`Sélectionnez des lignes dans la feuille « ${APP.sheets.mesPreNc} ».`);
  }
  ensureMesPreNcSchema_(sheet);
  if (sheet.getLastRow() < 2) throw new Error('Aucune NC prévisionnelle à traiter.');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const required = ['ID_EVENEMENT', 'IMMO', 'FAMILLE', 'IMMO_SAISI', 'FAMILLE_SAISIE', 'STATUT_WORKFLOW', 'DATE_SOUMISSION', 'SOUMIS_PAR', 'DECISION_QUALITE', 'DATE_VALIDATION', 'VALIDE_PAR'];
  const missing = required.filter(header => index[header] === undefined);
  if (missing.length) throw new Error(`Colonnes workflow absentes : ${missing.join(', ')}. Lancez « Initialiser ».`);
  const lastColumn = headers.length;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues();
  const activeRange = spreadsheet.getActiveRange();
  const firstSelectedRow = Math.max(2, activeRange ? activeRange.getRow() : 2);
  const lastSelectedRow = Math.min(sheet.getLastRow(), activeRange ? activeRange.getLastRow() : sheet.getLastRow());
  const selected = [];
  for (let rowNumber = firstSelectedRow; rowNumber <= lastSelectedRow; rowNumber += 1) {
    const row = values[rowNumber - 2];
    if (row && clean_(row[index.ID_EVENEMENT])) selected.push({ rowNumber, values: row });
  }
  if (!selected.length) throw new Error('Aucune ligne de données sélectionnée.');
  return { sheet, index, selected };
}

function workflowUser_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'Utilisateur Apps Script';
}

function getDashboardData(filters, publishedOnly) {
  const requested = filters || {};
  const cacheKey = analyticsCacheKey_(publishedOnly ? 'dashboard-published' : 'dashboard', requested);
  const cached = publishedOnly
    ? readAnalyticsCache_(analyticsCacheKey_('dashboard', requested)) || readAnalyticsCache_(cacheKey)
    : readAnalyticsCache_(cacheKey);
  if (cached) return withReviewActionPlanCoverage_(withDirectNcReviewCosts_(cached, requested));
  const spreadsheet = SpreadsheetApp.getActive();
  const factData = readFactsForAnalysis_(requested);
  if (!factData.values.length) {
    return cacheAnalyticsResponse_(cacheKey, emptyDashboard_('Aucune donnée consolidée. Lancez « Actualiser toutes les données ».', publishedOnly));
  }
  const values = factData.values;
  const headers = factData.headers;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const options = collectFilterOptions_(values, index);
  const filtered = values.filter(row => matchesFilters_(row, index, requested));
  const mesEvidence = buildMesEvidenceQuality_(readStagedMes_(), requested, isAvailabilityMesProblem_);
  const trendFilters = Object.assign({}, trendWindow_(), requested);
  trendFilters.trendLabel = requested.from || requested.to ? 'période filtrée' : trendFilters.trendLabel;
  const trendRows = values.filter(row => matchesFilters_(row, index, trendFilters));
  const trend = {};
  const families = {};
  const problems = {};
  const machines = {};
  const downtimeFamilies = {};
  const availabilityFamilies = {};
  const ncCostFamilies = {};
  const mesCostFamilies = {};
  const combinedCostFamilies = {};
  const ncCostMachines = {};
  const unavailableCostMachines = {};
  const combinedCostMachines = {};
  const costMsns = {};
  const sources = { ALEA: 0, NC: 0, ALEA_MES: 0 };
  const impactWeights = { ALEA: {}, NC: {}, ALEA_MES: {} };
  const declarations = new Set();
  let totalQuantity = 0;
  let totalCost = 0;
  let knownCostRows = 0;
  let withoutImmoRows = 0;
  let withoutImmoQuantity = 0;
  let impactScore = 0;
  let downtimeHours = 0;
  let availabilityDowntimeHours = 0;
  const downtimeBySource = { ALEA: 0, NC: 0, ALEA_MES: 0 };
  const costBySource = { ALEA: 0, NC: 0, ALEA_MES: 0 };
  let masterMatchedImpacts = 0;
  let identifiedImpacts = 0;
  const availabilityQuality = { total: 0, family: 0, immo: 0, msn: 0, downtime: 0 };
  const ncQuality = { total: 0, immo: 0, family: 0, msn: 0 };

  trendRows.forEach(row => {
    const source = String(row[index.SOURCE] || 'INCONNU');
    const quantity = factQuantity_(row, index);
    const week = weekKey_(row[index.DATE]);
    trend[week] = trend[week] || { ALEA: 0, NC: 0, ALEA_MES: 0 };
    trend[week][source] = (trend[week][source] || 0) + quantity;
  });

  filtered.forEach(row => {
    const source = String(row[index.SOURCE] || 'INCONNU');
    const quantity = factQuantity_(row, index);
    const family = String(row[index.FAMILLE] || '');
    const problem = String(row[index.PROBLEME] || row[index.CATEGORIE] || 'Non renseigné');
    const immo = String(row[index.IMMO] || '');
    const score = numberOr_(row[index.POIDS_IMPACT], 0) * quantity;
    const downtime = numberOr_(row[index.TEMPS_PERDU_HEURES], 0);
    const hasImmo = Boolean(immo);
    const hasFamily = Boolean(family);
    const isMasterMatched = row[index.IMMO_DANS_MASTER] === true || String(row[index.IMMO_DANS_MASTER]).toUpperCase() === 'OUI';
    const weight = numberOr_(row[index.POIDS_IMPACT], 0);
    const msn = clean_(row[index.MSN]);

    totalQuantity += quantity;
    if (!hasImmo) {
      withoutImmoRows += 1;
      withoutImmoQuantity += quantity;
    }
    declarations.add(String(row[index.ID_EVENEMENT] || '').replace(/-[0-9a-f]{8}$/i, ''));
    impactScore += score;
    downtimeHours += downtime;
    downtimeBySource[source] = (downtimeBySource[source] || 0) + downtime;
    if (hasImmo) identifiedImpacts += quantity;
    if (isMasterMatched) {
      masterMatchedImpacts += quantity;
    }
    impactWeights[source] = impactWeights[source] || {};
    impactWeights[source][String(weight)] = (impactWeights[source][String(weight)] || 0) + quantity;
    sources[source] = (sources[source] || 0) + quantity;
    if (family) addAggregate_(families, family, source, quantity, score, downtime);
    if (family) addAggregate_(downtimeFamilies, family, source, quantity, score, downtime);
    addAggregate_(problems, problem, source, quantity, score, downtime);
    if (immo) {
      addAggregate_(machines, immo, source, quantity, score, downtime);
      if (!machines[immo].family && family) machines[immo].family = family;
    }

    if (source === 'ALEA_MES' && isAvailabilityMesProblem_(problem)) {
      availabilityQuality.total += 1;
      if (family) availabilityQuality.family += 1;
      if (immo) availabilityQuality.immo += 1;
      if (msn) availabilityQuality.msn += 1;
      if (downtime > 0) availabilityQuality.downtime += 1;
      availabilityDowntimeHours += downtime;
      addAvailabilityAggregate_(availabilityFamilies, family, problem, source, quantity, score, downtime);
    }
    if (source === 'ALEA_MES') {
      const mesCost = downtime * 100;
      addMesFamilyCostAggregate_(mesCostFamilies, family, mesCost, source);
      if (isUsableCostFamily_(family)) addCostAggregate_(combinedCostFamilies, family, mesCost, source);
      if (immo) {
        addCostAggregate_(unavailableCostMachines, immo, mesCost, source, family);
        addCostAggregate_(combinedCostMachines, immo, mesCost, source, family);
      }
      if (msn) addCostAggregate_(costMsns, msn, mesCost, source);
    }
    if (source === 'NC') {
      const ncCost = quantity * 300;
      ncQuality.total += 1;
      if (immo) ncQuality.immo += 1;
      if (family) ncQuality.family += 1;
      if (msn) ncQuality.msn += 1;
      if (isUsableCostFamily_(family)) {
        addCostAggregate_(ncCostFamilies, family, ncCost, source);
        addCostAggregate_(combinedCostFamilies, family, ncCost, source);
      }
      if (immo) {
        addCostAggregate_(ncCostMachines, immo, ncCost, source, family);
        addCostAggregate_(combinedCostMachines, immo, ncCost, source, family);
      }
      if (msn) addCostAggregate_(costMsns, msn, ncCost, source);
    }

    if (row[index.COUT_RENSEIGNE] === true || String(row[index.COUT_RENSEIGNE]).toUpperCase() === 'OUI') {
      const cost = numberOr_(row[index.COUT_TOTAL_EUR], 0);
      totalCost += cost;
      costBySource[source] = (costBySource[source] || 0) + cost;
      knownCostRows += 1;
    }
  });

  const references = publishedOnly ? { activityMsn: null, drillingByFamily: {} } : getAnalyticReferences_(requested);
  const machineValues = Object.values(machines);
  const recurrentMachines = machineValues.filter(item => item.total >= 2).length;
  const machineImpactTotal = machineValues.reduce((sum, item) => sum + item.total, 0);
  const topFiveMachineImpacts = machineValues.sort((left, right) => right.total - left.total).slice(0, 5)
    .reduce((sum, item) => sum + item.total, 0);
  const familyResults = topAggregates_(families, 12, 'total').map(item => {
    const drilling = references.drillingByFamily[normalizeHeader_(item.label)] || 0;
    return {
      ...item,
      drilling,
      impactsPer1000Drillings: drilling ? item.total * 1000 / drilling : null
    };
  });
  const downtimeFamilyResults = topAggregates_(downtimeFamilies, 10, 'downtime');
  const trendData = Object.keys(trend).sort().map(week => [week, trend[week].ALEA || 0, trend[week].NC || 0, trend[week].ALEA_MES || 0]);
  const mesStagingRows = trendData.some(row => row[3] > 0) ? readStagedMes_() : [];
  const mesPeakDiagnostics = buildMesPeakDiagnostics_(trendRows, index, mesStagingRows);
  const properties = PropertiesService.getScriptProperties().getProperties();
  const result = {
    empty: false,
    message: '',
    refreshedAt: properties.LAST_REFRESH || '',
    controlsCount: countControlOccurrences_(spreadsheet.getSheetByName(APP.sheets.controls)),
    mes: publishedOnly ? null : getMesStatus_(),
    options,
    kpis: {
      events: totalQuantity,
      declarations: declarations.size,
      aleas: sources.ALEA || 0,
      nc: sources.NC || 0,
      mes: sources.ALEA_MES || 0,
      defects: Object.keys(problems).length,
      downtimeHours,
      downtimeBySource,
      averageDowntime: totalQuantity ? downtimeHours / totalQuantity : 0,
      averageMesDowntime: sources.ALEA_MES ? downtimeBySource.ALEA_MES / sources.ALEA_MES : 0,
      activityMsn: references.activityMsn,
      impactsPerMsn: references.activityMsn ? totalQuantity / references.activityMsn : null,
      ncShare: totalQuantity ? Math.round((sources.NC || 0) * 100 / totalQuantity) : 0,
      impactScore,
      masterCoverage: totalQuantity ? Math.round(masterMatchedImpacts * 100 / totalQuantity) : 0,
      identifiedImpacts,
      masterMatchedImpacts,
      unmatchedMasterImpacts: Math.max(0, totalQuantity - masterMatchedImpacts),
      recurrentMachines,
      topFiveMachineShare: machineImpactTotal ? Math.round(topFiveMachineImpacts * 100 / machineImpactTotal) : 0,
      totalCost,
      costBySource,
      costCoverage: filtered.length ? Math.round(knownCostRows * 100 / filtered.length) : 0,
        machines: new Set(filtered.map(row => String(row[index.IMMO] || '')).filter(Boolean)).size,
        withoutImmoRows,
        withoutImmoQuantity
    },
    trend: trendData,
    trendQuality: buildTrendQuality_(trendData, mesPeakDiagnostics),
    trendLabel: trendFilters.trendLabel,
    definitions: buildDashboardDefinitions_(impactWeights),
    families: familyResults,
    problems: topAggregates_(problems, 10, 'score'),
    downtimeProblems: topAggregates_(problems, 8, 'downtime'),
    machines: topAggregates_(machines, 0, 'total'),
    downtimeMachines: topAggregates_(machines, 10, 'downtime'),
    downtimeFamilies: downtimeFamilyResults,
    review: {
      assumptions: { ncUnitCost: 300, unavailableHourlyCost: 100 },
      availability: {
        kpis: {
          events: mesEvidence.events,
          downtimeHours: availabilityDowntimeHours,
          familyCoverage: mesEvidence.familyCoverage,
          immoCoverage: mesEvidence.immoCoverage,
          msnCoverage: mesEvidence.msnCoverage,
          downtimeCoverage: qualityPercentage_(availabilityQuality.downtime, availabilityQuality.total)
        },
        families: topAggregates_(availabilityFamilies, 12, 'downtime')
      },
      costs: {
        ncFamilies: topCostAggregates_(ncCostFamilies, 12),
        mesFamilies: topCostAggregates_(mesCostFamilies, 12),
        mesFamilyTotals: Object.values(mesCostFamilies).map(item => ({ label: item.label, family: item.family || '', NC: item.NC || 0, ALEA_MES: item.ALEA_MES || 0, cost: item.cost })),
        combinedFamilies: topCostAggregates_(combinedCostFamilies, 12),
        combinedFamilyTotals: Object.values(combinedCostFamilies).map(item => ({ label: item.label, cost: item.cost })),
        ncMachines: topCostAggregates_(ncCostMachines, 12),
        unavailableMachines: topCostAggregates_(unavailableCostMachines, 12),
        mesMachineTotals: Object.values(unavailableCostMachines).map(item => ({ label: item.label, family: item.family || '', NC: item.NC || 0, ALEA_MES: item.ALEA_MES || 0, cost: item.cost })),
        combinedMachines: topCostAggregates_(combinedCostMachines, 12),
        msns: topCostAggregates_(costMsns, 12)
      },
      quality: {
        nc: {
          events: ncQuality.total,
          immoMissing: ncQuality.total - ncQuality.immo,
          immoCoverage: qualityPercentage_(ncQuality.immo, ncQuality.total),
          familyCoverage: qualityPercentage_(ncQuality.family, ncQuality.total),
          msnCoverage: qualityPercentage_(ncQuality.msn, ncQuality.total)
        }
      }
    },
    sources: [['Aléas production', sources.ALEA || 0], ['NC', sources.NC || 0], ['Aléas MES', sources.ALEA_MES || 0]]
      .sort((left, right) => right[1] - left[1])
  };
  return withReviewActionPlanCoverage_(withDirectNcReviewCosts_(cacheAnalyticsResponse_(cacheKey, result), requested));
}

function searchSourceAnalysisDetails(source, filters, query, requestedLimit) {
  if (!['ALEA', 'NC'].includes(source)) throw new Error('Analyse source non prise en charge.');
  const requested = Object.assign({}, filters || {}, { source });
  const normalizedQuery = normalizeHeader_(query);
  const limit = Math.min(500, Math.max(1, Math.floor(numberOr_(requestedLimit, 100))));
  const cacheKey = analyticsCacheKey_(`source-details-${source}`, { filters: requested, query: normalizedQuery, limit });
  const cached = source === 'ALEA' ? null : readAnalyticsCache_(cacheKey);
  if (cached) return cached;
  const factData = source === 'ALEA' ? readProductionAleaFacts_() : readFactsForAnalysis_(requested);
  if (!factData.values.length) return { total: 0, limit, rows: [] };
  const index = Object.fromEntries(factData.headers.map((header, position) => [header, position]));
  const sourceRows = factData.values.filter(row => matchesFilters_(row, index, requested));
  const details = buildSourceDetailRows_(sourceRows, index, source)
    .filter(detail => !normalizedQuery || normalizeHeader_(Object.values(detail).join(' ')).includes(normalizedQuery));
  const result = { total: details.length, limit, rows: details.slice(0, limit) };
  return source === 'ALEA' ? result : cacheAnalyticsResponse_(cacheKey, result);
}

function getDataQualityAuditData(filters) {
  const requested = Object.assign({}, filters || {});
  const cacheKey = analyticsCacheKey_('quality-source', requested);
  const cached = readAnalyticsCache_(cacheKey);
  if (cached) return cached;

  const parameters = getParameters_();
  const masterRows = readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master);
  const master = enrichMasterWithDocMartin_(buildMasterIndex_(masterRows), readDocMartinEquipmentRecords_(parameters));
  const sourceDefinitions = [
    ['ALEA', 'Aléas production', parameters.ID_FICHIER_ALEAS, APP.sourceSheets.aleas, APP.aliases.aleas],
    ['NC', 'Non-conformités historiques', parameters.ID_FICHIER_NC, APP.sourceSheets.nc, APP.aliases.nc]
  ];
  const sources = sourceDefinitions
    .filter(([code]) => !requested.source || requested.source === code)
    .map(([code, label, spreadsheetId, sheetName, aliases]) => {
      if (!spreadsheetId) return emptySourceQualityAudit_(code, label, sheetName, 'ID de fichier non renseigné.');
      try {
        return buildRawSourceQualityAudit_(code, label, sheetName, readRecords_(spreadsheetId, sheetName), master, requested, aliases);
      } catch (error) {
        return emptySourceQualityAudit_(code, label, sheetName, error.message || String(error));
      }
    });
  const includeMes = !requested.source || requested.source === 'ALEA_MES' || requested.source === 'NC';
  const mes = includeMes ? buildMesSourceQualityAudit_(readStagedMes_(), master, requested) : emptyMesSourceQualityAudit_();
  const result = {
    version: 'source-quality-v1',
    refreshedAt: PropertiesService.getScriptProperties().getProperty('LAST_REFRESH') || '',
    filters: requested,
    master: {
      sourceRows: masterRows.length,
      validImmos: Object.keys(master.byImmo || {}).length,
      duplicateImmos: Object.keys(master.duplicates || {}).length,
      invalidImmos: Object.keys(master.invalidImmos || {}).length
    },
    sources,
    mes,
    imports: buildImportQualityAudit_(SpreadsheetApp.getActive().getSheetByName(APP.sheets.importLog))
  };
  return cacheAnalyticsResponse_(cacheKey, result);
}

function sourceAnalysisOrigin_(source) {
  return {
    sourceSheet: source === 'NC' ? APP.sourceSheets.nc : APP.sourceSheets.aleas,
    sourceFileParameter: source === 'NC' ? 'ID_FICHIER_NC' : 'ID_FICHIER_ALEAS',
    consolidatedSheet: APP.sheets.facts,
    directSource: source === 'ALEA',
    retentionRule: '24 mois glissants après actualisation'
  };
}

function createSourceQualityCounter_() {
  return {
    rawRows: 0, rawQuantity: 0, retainedRows: 0, retainedFacts: 0, retainedQuantity: 0,
    retainedWithoutImmo: 0,
    dateMissing: 0, dateInvalid: 0, immoMissing: 0, immoProvided: 0, immoUnrecognized: 0, familyMissing: 0,
    commentsMissing: 0, quantityMissing: 0, quantityInvalid: 0,
    masterMatchedRows: 0, familyResolvedRows: 0, partialRows: 0,
    exclusions: {}
  };
}

function addQualityExclusion_(counter, code, label, quantity) {
  if (!counter.exclusions[code]) counter.exclusions[code] = { code, label, rows: 0, quantity: 0 };
  counter.exclusions[code].rows += 1;
  counter.exclusions[code].quantity += quantity;
}

function sourceQualityRate_(numerator, denominator) {
  return { numerator, denominator, percentage: qualityPercentage_(numerator, denominator) };
}

function finalizeSourceQualityAudit_(code, label, origin, counter, available, error) {
  const excludedRows = Math.max(0, counter.rawRows - counter.retainedRows);
  const excludedQuantity = Math.max(0, counter.rawQuantity - counter.retainedQuantity);
  return {
    code, label, origin, available, error: error || '',
    rawRows: counter.rawRows, rawQuantity: counter.rawQuantity,
    retainedRows: counter.retainedRows, retainedFacts: counter.retainedFacts, retainedQuantity: counter.retainedQuantity,
    retainedWithoutImmo: counter.retainedWithoutImmo,
    excludedRows, excludedQuantity,
    dateMissing: counter.dateMissing, dateInvalid: counter.dateInvalid,
    immoMissing: counter.immoMissing, immoProvided: counter.immoProvided, immoUnrecognized: counter.immoUnrecognized,
    familyMissing: counter.familyMissing,
    commentsMissing: counter.commentsMissing, quantityMissing: counter.quantityMissing, quantityInvalid: counter.quantityInvalid,
    masterMatchedRows: counter.masterMatchedRows, familyResolvedRows: counter.familyResolvedRows, partialRows: counter.partialRows,
    rates: {
      retainedRows: sourceQualityRate_(counter.retainedRows, counter.rawRows),
      retainedQuantity: sourceQualityRate_(counter.retainedQuantity, counter.rawQuantity),
      immoProvided: sourceQualityRate_(counter.immoProvided, counter.rawRows),
      masterMatched: sourceQualityRate_(counter.masterMatchedRows, counter.rawRows),
      familyResolved: sourceQualityRate_(counter.familyResolvedRows, counter.rawRows),
      dateComplete: sourceQualityRate_(counter.rawRows - counter.dateMissing - counter.dateInvalid, counter.rawRows)
    },
    exclusions: Object.values(counter.exclusions).sort((left, right) => right.rows - left.rows || left.label.localeCompare(right.label))
  };
}

function rawRecordFamily_(record, source, master, aliases) {
  const sourceFamily = clean_(pick_(record, aliases.family));
  const masterFamily = splitImmos_(pick_(record, aliases.immo))
    .filter(Boolean)
    .map(immo => clean_((master.byImmo[immo] || {}).family))
    .find(Boolean) || '';
  return source === 'NC' ? sourceFamily || masterFamily : masterFamily || sourceFamily;
}

function rawRecordMatchesQualityFilters_(record, aliases, filters, master, source) {
  const requested = filters || {};
  const family = rawRecordFamily_(record, source, master, aliases);
  const immos = splitImmos_(pick_(record, aliases.immo)).filter(Boolean);
  const station = canonicalStation_(clean_(pick_(record, aliases.station)) || sourceMachineName_(record, aliases));
  if (!filterValuesMatch_([family], requested.family, true)) return false;
  if (!filterValuesMatch_(immos, requested.immo, true)) return false;
  if (!stationMatchesFilter_(station, requested.station)) return false;
  const date = parseDate_(pick_(record, aliases.date));
  if (requested.from && (!date || date < parseFilterDate_(requested.from, false))) return false;
  if (requested.to && (!date || date > parseFilterDate_(requested.to, true))) return false;
  return true;
}

function sourceQualityQuantity_(record, source, aliases) {
  const declared = source === 'NC' ? pick_(record, aliases.ncCount) : '';
  const raw = source === 'NC' && clean_(declared) !== '' ? declared : pick_(record, aliases.quantity);
  const text = clean_(raw);
  const parsed = text === '' ? NaN : Number(text.replace(/\s/g, '').replace(',', '.'));
  return {
    value: Number.isFinite(parsed) ? Math.max(1, parsed) : 1,
    missing: text === '',
    invalid: text !== '' && (!Number.isFinite(parsed) || parsed <= 0)
  };
}

function evaluateRawSourceRecord_(source, record, master, aliases) {
  const immos = splitImmos_(pick_(record, aliases.immo)).filter(Boolean);
  const sourceSection = clean_(pick_(record, aliases.section));
  const sourceFamily = clean_(pick_(record, aliases.family));
  const sourceMachineName = sourceMachineName_(record, aliases);
  const sourceStation = clean_(pick_(record, aliases.station)) || sourceMachineName;
  const aleaSourceInScope = source === 'ALEA' && isAleaProductionSourceRowInScope_(sourceSection, sourceStation);
  const retainedWithoutImmo = aleaSourceInScope && !immos.length
    || canRetainNcWithoutImmo_(source, immos, sourceFamily, sourceMachineName, sourceStation, sourceSection);
  const masterEntries = immos.map(immo => ({ immo, data: master.byImmo[immo] || {} }));
  const eligibleMasterEntries = masterEntries.filter(entry => entry.data.immo
    && isDrillingMachine_(entry.data)
    && isInScope_(entry.data.section));
  const acceptedEntries = eligibleMasterEntries.filter(entry => {
    if (!isInScope_(sourceSection || entry.data.section || '')) return false;
    const station = sourceStation || clean_(entry.data.station);
    return source !== 'ALEA' || isAleaStationInScope_(station);
  });
  const acceptedImmos = acceptedEntries.map(entry => entry.immo);
  const retainedImmos = source === 'ALEA'
    ? (aleaSourceInScope ? immos : [])
    : retainedSourceImmos_(source, immos, acceptedImmos, master, sourceSection, sourceStation);
  let exclusionCode = '';
  let exclusionLabel = '';
  if (source === 'ALEA') {
    if (!clean_(sourceSection) || !isInScope_(sourceSection)) {
      exclusionCode = 'SECTION_HORS_PERIMETRE';
      exclusionLabel = 'Section source absente ou hors périmètre TC';
    } else if (!sourceStation) {
      exclusionCode = 'POSTE_MANQUANT';
      exclusionLabel = 'Poste production absent';
    } else if (!isAleaStationInScope_(sourceStation)) {
      exclusionCode = 'POSTE_HORS_PERIMETRE';
      exclusionLabel = 'Poste production hors périmètre TC';
    }
  } else if (!immos.length) {
    if (!retainedWithoutImmo) {
      exclusionCode = 'IMMO_MANQUANT';
      exclusionLabel = 'IMMO absent de la ligne source';
    }
  } else if (!masterEntries.some(entry => entry.data.immo) && !retainedImmos.length) {
    exclusionCode = 'IMMO_NON_RECONNU';
    exclusionLabel = 'IMMO absent du master';
  } else if (!eligibleMasterEntries.length) {
    exclusionCode = 'IMMO_HORS_PERIMETRE';
    exclusionLabel = 'IMMO master hors PA / Perçage';
  } else if (!isInScope_(sourceSection || eligibleMasterEntries[0].data.section || '')) {
    exclusionCode = 'SECTION_HORS_PERIMETRE';
    exclusionLabel = 'Section source hors périmètre TC';
  }
  return {
    immos, acceptedImmos, retainedImmos,
    immoUnrecognized: immos.some(immo => !master.byImmo[immo]),
    retainedWithoutImmo,
    machineName: sourceMachineName || sourceStation,
    masterMatched: eligibleMasterEntries.length > 0,
    familyResolved: Boolean(clean_(pick_(record, aliases.family)) || acceptedEntries.some(entry => clean_(entry.data.family))),
    partial: Boolean(acceptedEntries.length && acceptedEntries.length < immos.length),
    exclusionCode, exclusionLabel
  };
}

function buildRawSourceQualityAudit_(source, label, origin, records, master, filters, aliases) {
  const counter = createSourceQualityCounter_();
  (records || []).filter(record => rawRecordMatchesQualityFilters_(record, aliases, filters, master, source)).forEach(record => {
    const quantity = sourceQualityQuantity_(record, source, aliases);
    const dateValue = pick_(record, aliases.date);
    const date = parseDate_(dateValue);
    const comment = clean_(pick_(record, aliases.comment));
    const evaluation = evaluateRawSourceRecord_(source, record, master, aliases);
    counter.rawRows += 1;
    counter.rawQuantity += quantity.value;
    if (!clean_(dateValue)) counter.dateMissing += 1;
    else if (!date) counter.dateInvalid += 1;
    if (!evaluation.immos.length) counter.immoMissing += 1;
    else {
      counter.immoProvided += 1;
      if (evaluation.immoUnrecognized) counter.immoUnrecognized += 1;
    }
    if (!clean_(pick_(record, aliases.family))) counter.familyMissing += 1;
    if (!comment) counter.commentsMissing += 1;
    if (quantity.missing) counter.quantityMissing += 1;
    if (quantity.invalid) counter.quantityInvalid += 1;
    if (evaluation.masterMatched) counter.masterMatchedRows += 1;
    if (evaluation.familyResolved) counter.familyResolvedRows += 1;
    if (evaluation.partial) counter.partialRows += 1;
    if (evaluation.retainedImmos.length || evaluation.retainedWithoutImmo) {
      counter.retainedRows += 1;
      counter.retainedFacts += evaluation.retainedImmos.length || 1;
      counter.retainedQuantity += quantity.value;
      if (evaluation.retainedWithoutImmo) counter.retainedWithoutImmo += 1;
    } else {
      addQualityExclusion_(counter, evaluation.exclusionCode || 'REGLE_CONSOLIDATION', evaluation.exclusionLabel || 'Règle de consolidation', quantity.value);
    }
  });
  return finalizeSourceQualityAudit_(source, label, origin, counter, true, '');
}

function mesQualityRowMatchesFilters_(row, filters, family, immos) {
  const requested = filters || {};
  if (!filterValuesMatch_([family], requested.family, true)) return false;
  if (!filterValuesMatch_(immos || [], requested.immo, true)) return false;
  if (!stationMatchesFilter_(row.POSTE, requested.station)) return false;
  if (!filterValuesMatch_([row.MSN], requested.msn, true)) return false;
  const date = parseDate_(row.DATE);
  if (requested.from && (!date || date < parseFilterDate_(requested.from, false))) return false;
  if (requested.to && (!date || date > parseFilterDate_(requested.to, true))) return false;
  return true;
}

function buildMesEvidenceQuality_(rows, filters, problemFilter) {
  const result = { events: 0, immoCited: 0, immoMissing: 0, familyCited: 0, msnCited: 0, immoCoverage: 0, familyCoverage: 0, msnCoverage: 0 };
  if (filters && filters.source && filters.source !== 'ALEA_MES') return result;
  (rows || []).forEach(row => {
    if (clean_(row.SOURCE) !== 'ALEA_MES') return;
    const problem = clean_(row.PROBLEME) || clean_(row.CATEGORIE) || 'Non renseigné';
    if (problemFilter && !problemFilter(problem)) return;
    const method = clean_(row.METHODE_RAPPROCHEMENT);
    const immos = splitImmos_(row.IMMO).filter(Boolean);
    if (!mesQualityRowMatchesFilters_(row, filters, row.FAMILLE, immos)) return;
    const immoCited = !isMissingMesImmo_(row.IMMO_SOURCE) || isMesIdentityImmoMethod_(method);
    const familyCited = Boolean(clean_(row.FAMILLE_SOURCE)) || /^FAMILLE_/.test(method);
    result.events += 1;
    if (immoCited) result.immoCited += 1;
    else result.immoMissing += 1;
    if (familyCited) result.familyCited += 1;
    if (clean_(row.MSN)) result.msnCited += 1;
  });
  result.immoCoverage = qualityPercentage_(result.immoCited, result.events);
  result.familyCoverage = qualityPercentage_(result.familyCited, result.events);
  result.msnCoverage = qualityPercentage_(result.msnCited, result.events);
  return result;
}

function buildMesSourceQualityAudit_(rows, master, filters) {
  const counters = { ALEA_MES: createSourceQualityCounter_(), NC: createSourceQualityCounter_() };
  const methods = { ALEA_MES: {}, NC: {} };
  const statusCounts = {};
  (rows || []).forEach(row => {
    const source = clean_(row.SOURCE) === 'NC' ? 'NC' : 'ALEA_MES';
    if (filters && filters.source && filters.source !== source) return;
    const identity = resolveMesIdentity_(row.IMMO || row.IMMO_SOURCE, row.FAMILLE, row.COMMENTAIRE_INITIAL, master);
    const immos = identity.immos.length ? identity.immos : [];
    const family = clean_(row.FAMILLE) || identity.family;
    if (!mesQualityRowMatchesFilters_(row, filters, family, immos)) return;
    const counter = counters[source];
    const quantityValue = source === 'NC' ? Math.max(1, numberOr_(row.NB_NC, row.QUANTITE)) : Math.max(1, numberOr_(row.QUANTITE, 1));
    const rawQuantity = source === 'NC' ? row.NB_NC : row.QUANTITE;
    const rawQuantityText = clean_(rawQuantity);
    const parsedQuantity = rawQuantityText === '' ? NaN : Number(rawQuantityText.replace(/\s/g, '').replace(',', '.'));
    const dateValue = row.DATE;
    const date = parseDate_(dateValue);
    const comment = clean_(row.COMMENTAIRE_INITIAL);
    const masterImmos = immos.filter(immo => {
      const data = master.byImmo[immo] || {};
      return data.immo && isDrillingMachine_(data) && isInScope_(data.section);
    });
    const sourceSection = clean_(row.SECTION);
    const acceptedImmos = masterImmos.filter(immo => {
      const data = master.byImmo[immo] || {};
      return isInScope_(sourceSection || data.section || '');
    });
    const status = clean_(row.STATUT_WORKFLOW) || 'NON_APPLICABLE';
    const method = clean_(row.METHODE_RAPPROCHEMENT) || identity.method || 'NON_RENSEIGNE';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    methods[source][method] = (methods[source][method] || 0) + 1;
    counter.rawRows += 1;
    counter.rawQuantity += quantityValue;
    if (!clean_(dateValue)) counter.dateMissing += 1;
    else if (!date) counter.dateInvalid += 1;
    const immoProvided = !isMissingMesImmo_(row.IMMO_SOURCE) || isMesIdentityImmoMethod_(method);
    const familyProvided = Boolean(clean_(row.FAMILLE_SOURCE)) || /^FAMILLE_/.test(method);
    if (immoProvided) counter.immoProvided += 1;
    else counter.immoMissing += 1;
    if (immoProvided && !masterImmos.length) counter.immoUnrecognized += 1;
    if (!familyProvided) counter.familyMissing += 1;
    if (!comment) counter.commentsMissing += 1;
    if (!rawQuantityText) counter.quantityMissing += 1;
    else if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) counter.quantityInvalid += 1;
    if (masterImmos.length) counter.masterMatchedRows += 1;
    if (familyProvided) counter.familyResolvedRows += 1;
    const excludedByComment = source === 'ALEA_MES' && isExcludedMesSourceComment_(comment);
    const workflowPending = source === 'NC' && status !== 'VALIDEE';
    let exclusionCode = '';
    let exclusionLabel = '';
    if (excludedByComment) {
      exclusionCode = 'COMMENTAIRE_SOURCE_EXCLU';
      exclusionLabel = 'Commentaire MES identifié comme BOX / VPC';
    } else if (workflowPending) {
      exclusionCode = 'NC_NON_VALIDEE';
      exclusionLabel = 'NC MES en attente de validation Qualité';
    } else if (!masterImmos.length) {
      exclusionCode = /^.*A_VERIFIER$/.test(identity.method) ? 'RAPPROCHEMENT_AMBIGU' : 'IMMO_NON_RECONNU';
      exclusionLabel = /^.*A_VERIFIER$/.test(identity.method) ? 'Rapprochement MES ambigu ou à vérifier' : 'IMMO/famille MES non rapproché au master';
    } else if (!acceptedImmos.length) {
      exclusionCode = 'SECTION_HORS_PERIMETRE';
      exclusionLabel = 'Section MES hors périmètre TC';
    }
    if (acceptedImmos.length && !excludedByComment && !workflowPending) {
      counter.retainedRows += 1;
      counter.retainedFacts += acceptedImmos.length;
      counter.retainedQuantity += quantityValue;
    } else {
      addQualityExclusion_(counter, exclusionCode || 'REGLE_CONSOLIDATION', exclusionLabel || 'Règle de consolidation MES', quantityValue);
    }
  });
  const bySource = Object.keys(counters).map(source => finalizeSourceQualityAudit_(
    source,
    source === 'NC' ? 'NC MES en préparation' : 'Aléas MES staging',
    'STG_MES',
    counters[source],
    true,
    ''
  ));
  return {
    stagingRows: bySource.reduce((sum, item) => sum + item.rawRows, 0),
    stagingQuantity: bySource.reduce((sum, item) => sum + item.rawQuantity, 0),
    bySource,
    statusCounts,
    methods: Object.entries(methods.ALEA_MES).map(([method, rows]) => ({ method, rows })).sort((left, right) => right.rows - left.rows),
    note: 'Les NC MES restent une préparation humaine ; les NC analytiques proviennent de Données NC TC.'
  };
}

function emptySourceQualityAudit_(code, label, origin, error) {
  return finalizeSourceQualityAudit_(code, label, origin, createSourceQualityCounter_(), false, error);
}

function emptyMesSourceQualityAudit_() {
  return { stagingRows: 0, stagingQuantity: 0, bySource: [], statusCounts: {}, methods: [], note: '' };
}

function buildImportQualityAudit_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return { rows: 0, statuses: {}, errors: [] };
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(normalizeHeader_);
  const statusIndex = headers.indexOf('STATUT');
  const fileIndex = headers.indexOf('NOMFICHIER');
  const messageIndex = headers.indexOf('MESSAGE');
  const statuses = {};
  const errors = [];
  values.filter(row => row.some(value => clean_(value) !== '')).forEach(row => {
    const status = clean_(row[statusIndex]) || 'NON_RENSEIGNE';
    statuses[status] = (statuses[status] || 0) + 1;
    if (normalizeHeader_(status) === 'ERREUR') errors.push({ file: clean_(row[fileIndex]), message: clean_(row[messageIndex]) });
  });
  return { rows: values.length, statuses, errors: errors.slice(-20) };
}

function getSourceAnalysisData(source, filters, publishedOnly) {
  if (!['ALEA', 'NC'].includes(source)) throw new Error('Analyse source non prise en charge.');
  const requested = Object.assign({}, filters || {}, { source });
  if (source === 'ALEA' && !publishedOnly) return getProductionAleaAnalysisData_(requested);
  const cacheKey = analyticsCacheKey_(publishedOnly ? `source-${source}-published` : `source-${source}`, requested);
  const cached = readAnalyticsCache_(cacheKey);
  if (cached) return cached;
  const factData = readFactsForAnalysis_(requested);
  if (!factData.values.length) {
    const empty = emptySourceAnalysis_(source, 'Aucune donnée consolidée. Lancez « Actualiser toutes les données ».');
    if (publishedOnly) empty.origin.directSource = false;
    return cacheAnalyticsResponse_(cacheKey, empty);
  }
  const values = factData.values;
  const headers = factData.headers;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const data = buildSourceAnalysis_(values, index, source, requested,
    publishedOnly ? { activityMsn: null, drillingByFamily: {} } : getAnalyticReferences_(requested));
  const properties = PropertiesService.getScriptProperties().getProperties();
  const result = Object.assign(data, {
    origin: Object.assign(sourceAnalysisOrigin_(source), { directSource: false }),
    empty: data.kpis.total === 0,
    message: data.kpis.total === 0 ? 'Aucun événement pour ces filtres.' : '',
    refreshedAt: properties.LAST_REFRESH || '',
    options: collectSourceAnalysisOptions_(values, index, source),
    schema: (() => {
      const status = factsSchemaStatus_(factData.schemaHeaders);
      return Object.assign(status, { needsRefresh: status.needsRefresh || properties.FACTS_SCHEMA_REBUILD_REQUIRED === 'OUI' });
    })()
  });
  return cacheAnalyticsResponse_(cacheKey, result);
}

function getProductionAleaAnalysisData_(filters) {
  const factData = readProductionAleaFacts_();
  const values = factData.values;
  const sourceRows = factData.sourceRows;
  const headers = factData.headers;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const data = buildSourceAnalysis_(values, index, 'ALEA', filters, getAnalyticReferences_(filters));
  const properties = PropertiesService.getScriptProperties().getProperties();
  return Object.assign(data, {
    origin: sourceAnalysisOrigin_('ALEA'),
    empty: data.kpis.total === 0,
    message: data.kpis.total === 0
      ? 'Aucun aléa ne correspond aux filtres. Vérifiez les colonnes Section (TC) et Poste (370, 360 ou 355) de la source.'
      : '',
    refreshedAt: properties.LAST_REFRESH || '',
    options: collectSourceAnalysisOptions_(values, index, 'ALEA'),
    schema: { missing: [], needsRefresh: false },
    sourceQuality: { rawRows: sourceRows.length, retainedRows: values.length }
  });
}

function readProductionAleaFacts_() {
  const parameters = getParameters_();
  if (!parameters.ID_FICHIER_ALEAS) throw new Error('Paramètre obligatoire non renseigné : ID_FICHIER_ALEAS');

  let master = buildMasterIndex_([]);
  if (parameters.ID_FICHIER_MASTER) {
    try {
      master = buildMasterIndex_(readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master));
    } catch (error) {
    }
  }

  const sourceRows = readRecords_(parameters.ID_FICHIER_ALEAS, APP.sourceSheets.aleas);
  const values = [];
  appendFacts_(values, sourceRows, 'ALEA', APP.aliases.aleas, master, parameters, APP.sourceSheets.aleas);
  const headers = APP.factsHeaders.slice();
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const data = buildSourceAnalysis_(values, index, 'ALEA', filters, getAnalyticReferences_(filters));
  const properties = PropertiesService.getScriptProperties().getProperties();
  return Object.assign(data, {
    origin: sourceAnalysisOrigin_('ALEA'),
    empty: data.kpis.total === 0,
    message: data.kpis.total === 0
      ? 'Aucun aléa ne correspond aux filtres. Vérifiez les colonnes Section (TC) et Poste de la source.'
      : '',
    refreshedAt: properties.LAST_REFRESH || '',
    options: collectSourceAnalysisOptions_(values, index, 'ALEA'),
    schema: { missing: [], needsRefresh: false },
    sourceQuality: { rawRows: sourceRows.length, retainedRows: values.length }
  });
}

function getCombinedAleaAnalysisData(filters) {
  const requested = Object.assign({}, filters || {});
  delete requested.source;
  const cacheKey = analyticsCacheKey_('combined-alea', requested);
  const cached = readAnalyticsCache_(cacheKey);
  if (cached) return cached;
  const factData = readFactsForAnalysis_(requested);
  if (!factData.values.length) {
    return cacheAnalyticsResponse_(cacheKey, emptyCombinedAleaAnalysis_('Aucune donnée consolidée. Lancez « Actualiser toutes les données ».'));
  }
  const values = factData.values;
  const headers = factData.headers;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  let master = null;
  try {
    const parameters = getParameters_();
    master = buildMasterIndex_(readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master));
  } catch (error) {
    master = null;
  }
  const data = buildCombinedAleaAnalysis_(values, index, requested, master);
  const properties = PropertiesService.getScriptProperties().getProperties();
  return cacheAnalyticsResponse_(cacheKey, Object.assign(data, {
    refreshedAt: properties.LAST_REFRESH || '',
    options: collectFilterOptions_(values, index),
    schema: (() => {
      const status = factsSchemaStatus_(factData.schemaHeaders);
      return Object.assign(status, { needsRefresh: status.needsRefresh || properties.FACTS_SCHEMA_REBUILD_REQUIRED === 'OUI' });
    })()
  }));
}

function emptyCombinedAleaAnalysis_(message) {
  return {
    source: 'COMBINED_ALEA', empty: true, message, detailsTotal: 0, detailsLimit: 200, rows: [],
    kpis: {
      productionEvents: 0, mesEvents: 0, productionHours: 0, mesHours: 0,
      matchedEvents: 0, strongMatches: 0, probableMatches: 0, reviewMatches: 0,
      unmatchedProduction: 0, unmatchedMes: 0
    }
  };
}

function buildCombinedAleaAnalysis_(values, index, filters, master) {
  const requested = Object.assign({}, filters || {});
  delete requested.source;
  const rows = values.filter(row => ['ALEA', 'ALEA_MES'].includes(clean_(row[index.SOURCE]))
    && !(clean_(row[index.SOURCE]) === 'ALEA_MES' && isExcludedCombinedMesComment_(row[index.COMMENTAIRE]))
    && matchesFilters_(row, index, requested));
  const production = rows.filter(row => clean_(row[index.SOURCE]) === 'ALEA')
    .map(row => combinedAleaDetailRow_(row, index, 'ALEA', master));
  const mes = rows.filter(row => clean_(row[index.SOURCE]) === 'ALEA_MES')
    .map(row => combinedAleaDetailRow_(row, index, 'ALEA_MES', master));
  const comparisons = matchCombinedAleaRows_(production, mes);
  const productionHours = production.reduce((sum, row) => sum + row.downtime, 0);
  const mesHours = mes.reduce((sum, row) => sum + row.downtime, 0);
  const matched = comparisons.filter(row => row.correspondence.label !== 'Aucune');
  const strongMatches = matched.filter(row => row.correspondence.label === 'Forte').length;
  const probableMatches = matched.filter(row => row.correspondence.label === 'Probable').length;
  const reviewMatches = matched.filter(row => row.correspondence.label === 'À vérifier').length;
  const sorted = comparisons.slice().sort((left, right) => {
    const rank = { Forte: 3, Probable: 2, 'À vérifier': 1, Aucune: 0 };
    return (rank[right.correspondence.label] || 0) - (rank[left.correspondence.label] || 0)
      || dateSortValue_(right.date) - dateSortValue_(left.date);
  });
  return {
    source: 'COMBINED_ALEA',
    empty: !production.length && !mes.length,
    message: !production.length && !mes.length ? 'Aucun aléa production ou MES pour ces filtres.' : '',
    kpis: {
      productionEvents: production.length,
      mesEvents: mes.length,
      productionHours,
      mesHours,
      matchedEvents: matched.length,
      strongMatches,
      probableMatches,
      reviewMatches,
      unmatchedProduction: sorted.filter(row => row.production && !row.mes).length,
      unmatchedMes: sorted.filter(row => row.mes && !row.production).length
    },
    detailsTotal: sorted.length,
    detailsLimit: 200,
    rows: sorted.slice(0, 200)
  };
}

function combinedAleaDetailRow_(row, index, source, master) {
  const problem = clean_(row[index.PROBLEME]) || clean_(row[index.CATEGORIE]);
  const immo = clean_(row[index.IMMO]);
  const family = clean_(row[index.FAMILLE]);
  const comment = clean_(row[index.COMMENTAIRE]);
  const commentIdentity = source === 'ALEA_MES' && master
    ? resolveMesIdentity_('', family, comment, master)
    : { immos: [], family: '', method: '' };
  const immos = [...new Set([immo, ...commentIdentity.immos].map(normalizeImmo_).filter(Boolean))];
  const detail = {
    id: `${source}|${clean_(row[index.ID_EVENEMENT])}`,
    date: sourceAnalysisDateKey_(row[index.DATE]),
    station: canonicalStation_(row[index.POSTE]),
    immo: immo || immos.join(' / '),
    immos,
    family: family || commentIdentity.family || (master && immos.length === 1 ? clean_((master.byImmo[immos[0]] || {}).family) : ''),
    problem,
    category: clean_(row[index.CATEGORIE]),
    comment,
    identityMethod: commentIdentity.method,
    quantity: numberOr_(row[index.QUANTITE], 1),
    downtime: numberOr_(row[index.TEMPS_PERDU_HEURES], 0)
  };
  detail.keywords = combinedAleaKeywords_([detail.problem, detail.category, detail.comment].join(' '));
  return detail;
}

function matchCombinedAleaRows_(production, mes) {
  const productionByDay = new Map();
  production.forEach(row => {
    const day = row.date;
    if (!day) return;
    if (!productionByDay.has(day)) productionByDay.set(day, []);
    productionByDay.get(day).push(row);
  });
  const candidates = [];
  mes.forEach(mesRow => {
    const mesDate = parseDate_(mesRow.date);
    if (!mesDate) return;
    for (let offset = -1; offset <= 1; offset += 1) {
      const candidateDate = new Date(mesDate.getTime() + offset * 86400000);
      const day = dateKey_(candidateDate);
      (productionByDay.get(day) || []).forEach(productionRow => {
        const candidate = combinedAleaMatch_(productionRow, mesRow);
        if (candidate) candidates.push(candidate);
      });
    }
  });
  candidates.sort((left, right) => right.score - left.score
    || left.dateGap - right.dateGap
    || left.mes.id.localeCompare(right.mes.id, 'fr', { numeric: true, sensitivity: 'base' })
    || left.production.id.localeCompare(right.production.id, 'fr', { numeric: true, sensitivity: 'base' }));
  const matchedProduction = new Set();
  const matchedMes = new Set();
  const selected = [];
  candidates.forEach(candidate => {
    if (matchedProduction.has(candidate.production.id) || matchedMes.has(candidate.mes.id)) return;
    matchedProduction.add(candidate.production.id);
    matchedMes.add(candidate.mes.id);
    selected.push(candidate);
  });
  const byProduction = new Map(selected.map(candidate => [candidate.production.id, candidate]));
  const byMes = new Map(selected.map(candidate => [candidate.mes.id, candidate]));
  const comparisons = [];
  production.forEach(row => {
    const candidate = byProduction.get(row.id);
    comparisons.push(combinedAleaComparisonRow_(candidate ? candidate.production : row, candidate ? candidate.mes : null, candidate));
  });
  mes.forEach(row => {
    if (!byMes.has(row.id)) comparisons.push(combinedAleaComparisonRow_(null, row, null));
  });
  return comparisons;
}

function combinedAleaMatch_(production, mes) {
  const productionDate = parseDate_(production.date);
  const mesDate = parseDate_(mes.date);
  if (!productionDate || !mesDate) return null;
  const dateGap = Math.round(Math.abs(productionDate.getTime() - mesDate.getTime()) / 86400000);
  if (dateGap > 1) return null;
  const productionImmos = production.immos && production.immos.length
    ? production.immos
    : [normalizeImmo_(production.immo)].filter(Boolean);
  const mesImmos = mes.immos && mes.immos.length
    ? mes.immos
    : [normalizeImmo_(mes.immo)].filter(Boolean);
  const sharedImmos = productionImmos.filter(immo => mesImmos.includes(immo));
  const sameImmo = sharedImmos.length > 0;
  const productionStation = combinedAleaStationKey_(production.station);
  const mesStation = combinedAleaStationKey_(mes.station);
  const sameStation = Boolean(productionStation && mesStation && productionStation === mesStation);
  const sameFamily = Boolean(production.family && mes.family
    && identityKey_(production.family) === identityKey_(mes.family));
  const sharedKeywords = (production.keywords || []).filter(keyword => (mes.keywords || []).includes(keyword));
  if (!sameImmo && !sameStation && !sameFamily && !sharedKeywords.length) return null;
  let score = dateGap === 0 ? 30 : 15;
  const reasons = [dateGap === 0 ? 'date identique' : 'date à ±1 jour'];
  if (sameImmo) {
    score += 40;
    reasons.push('IMMO identique');
    if (/^IMMO_SOURCE/.test(mes.identityMethod)) reasons.push(`IMMO renseigné dans la source MES : ${sharedImmos.join(', ')}`);
    if (mes.identityMethod === 'IMMO_COMMENTAIRE_EXACT') reasons.push(`IMMO exact trouvé dans le commentaire MES : ${sharedImmos.join(', ')}`);
    if (mes.identityMethod === 'IMMO_COMMENTAIRE_CORRIGE') reasons.push(`IMMO corrigé depuis le commentaire MES : ${sharedImmos.join(', ')}`);
  }
  if (sameStation) { score += 20; reasons.push('poste identique'); }
  if (sameFamily) { score += 25; reasons.push('famille machine identique'); }
  if (sharedKeywords.length) { score += Math.min(20, sharedKeywords.length * 10); reasons.push(`mots-clés : ${sharedKeywords.slice(0, 3).join(', ')}`); }
  score = Math.min(100, score);
  const label = score >= 80 ? 'Forte' : score >= 55 ? 'Probable' : 'À vérifier';
  return { production, mes, score, dateGap, label, reasons };
}

function isExcludedCombinedMesComment_(comment) {
  const normalized = normalizeHeader_(comment);
  return normalized.includes('GRILLE') || isExcludedMesSourceComment_(comment);
}

function isExcludedMesSourceComment_(comment) {
  const normalized = normalizeHeader_(comment);
  return normalized.includes('BOX') || normalized.includes('VPC');
}

function combinedAleaComparisonRow_(production, mes, candidate) {
  const date = (mes && mes.date) || (production && production.date) || '';
  const displayImmo = candidate && candidate.production
    ? candidate.production.immo || (mes && mes.immo) || ''
    : (mes && mes.immo) || (production && production.immo) || '';
  return {
    date,
    station: (mes && mes.station) || (production && production.station) || '',
    immo: displayImmo,
    production: production ? {
      problem: production.problem, comment: production.comment, downtime: production.downtime, quantity: production.quantity
    } : null,
    mes: mes ? {
      problem: mes.problem, comment: mes.comment, downtime: mes.downtime, quantity: mes.quantity
    } : null,
    correspondence: candidate
      ? { label: candidate.label, score: candidate.score, reasons: candidate.reasons }
      : { label: 'Aucune', score: 0, reasons: [] }
  };
}

function combinedAleaStationKey_(value) {
  const normalized = normalizeHeader_(value);
  const match = normalized.match(/P?(280|290)/);
  return match ? `P${match[1]}` : normalized;
}

function combinedAleaKeywords_(value) {
  const keywords = tokenizeComment_(value).map(token => {
    if (/^(CAS|ENDOMMAGE|ABIME|INUTILISABLE)/.test(token)) return 'CASSE';
    if (/^(MANQU|ABSENT|NONDISPONIBLE|INDISPONIBLE)/.test(token)) return 'MANQUANT';
    if (/^(BLOQU|DEBOUCH|NONDEBOUCHANT)/.test(token)) return 'BLOCAGE';
    if (/^(FRAISUR|HT$)/.test(token)) return 'FRAISURAGE';
    if (/^(ASPIR)/.test(token)) return 'ASPIRATION';
    if (/^(CLAMP)/.test(token)) return 'CLAMPAGE';
    if (/^(OUTIL|FORET|PERCEUSE)/.test(token)) return 'OUTIL';
    if (/^(PERC)/.test(token)) return 'PERCAGE';
    if (/^(LUBR)/.test(token)) return 'LUBRIFICATION';
    if (/^(AFFICH)/.test(token)) return 'AFFICHAGE';
    if (/^(ELECTR)/.test(token)) return 'ELECTRICITE';
    if (/^(NONCONFORM)/.test(token)) return 'NON_CONFORMITE';
    return '';
  }).filter(Boolean);
  return [...new Set(keywords)];
}

function archiverFactsHistoriques() {
  return withScriptLock_(() => {
    const sheet = getActiveFactsSheet_(SpreadsheetApp.getActive());
    if (!sheet || sheet.getLastRow() < 2) return { active: 0, archived: 0 };
    const factsSchema = ensureFactsSchema_(sheet);
    const values = sheet.getDataRange().getValues();
    const normalized = normalizeFactRowsToCurrentSchema_(values.shift(), values);
    const retained = partitionFactsByRetention_(normalized.rows, new Date(), 1);
    const archiveResult = appendArchivedFacts_(retained.archived, new Date());
    writeFacts_(retained.active);
    preserveFactsRebuildFlag_(factsSchema);
    const archiveMessage = archiveResult.updated
      ? `${archiveResult.count} nouvel(aux) fait(s) archivé(s) ; ${archiveResult.updated} fait(s) archivé(s) mis à jour.`
      : `${archiveResult.count} nouvel(aux) fait(s) archivé(s).`;
    SpreadsheetApp.getActive().toast(`${retained.active.length} faits actifs ; ${archiveMessage}`, 'Dashboard Machine', 8);
    return { active: retained.active.length, archived: archiveResult.count, archiveUpdates: archiveResult.updated };
  });
}

function buildSourceAnalysis_(values, index, source, filters, references) {
  const requested = Object.assign({}, filters || {}, { source });
  const rows = values.filter(row => matchesFilters_(row, index, requested));
  const families = {};
  const machines = {};
  const problems = {};
  const stations = {};
  const machineTypes = {};
  const categories = {};
  const msns = {};
  const trend = {};
  const declarations = new Set();
  let total = 0;
  let ncCount = 0;
  let masterMatched = 0;
  let downtimeHours = 0;
  let totalCost = 0;
  let knownCostRows = 0;
  let withoutImmoRows = 0;
  let withoutImmoQuantity = 0;

  rows.forEach(row => {
    const quantity = factQuantity_(row, index);
    const score = quantity * numberOr_(row[index.POIDS_IMPACT], source === 'NC' ? 5 : 1);
    const isMasterMatched = row[index.IMMO_DANS_MASTER] === true || String(row[index.IMMO_DANS_MASTER]).toUpperCase() === 'OUI';
    const family = clean_(row[index.FAMILLE]);
    const immo = clean_(row[index.IMMO]);
    const problem = clean_(row[index.PROBLEME]) || clean_(row[index.CATEGORIE]) || 'Non renseigné';
    const station = canonicalStation_(row[index.POSTE]) || 'Poste inconnu';
    const machineType = clean_(row[index.TYPE_MACHINE]) || 'Type non renseigné';
    const category = clean_(row[index.CATEGORIE]) || 'Catégorie non renseignée';
    const msn = clean_(row[index.MSN]);
    const week = weekKey_(row[index.DATE]);
    const downtime = numberOr_(row[index.TEMPS_PERDU_HEURES], 0);

    total += quantity;
    ncCount += quantity;
    if (!immo) {
      withoutImmoRows += 1;
      withoutImmoQuantity += quantity;
    }
    if (isMasterMatched) masterMatched += quantity;
    downtimeHours += downtime;
    declarations.add(String(row[index.ID_EVENEMENT] || '').replace(/-[0-9a-f]{8}$/i, ''));
    trend[week] = (trend[week] || 0) + quantity;
    if (family) addAggregate_(families, family, source, quantity, score, downtime);
    if (immo) addAggregate_(machines, immo, source, quantity, score, downtime);
    addAggregate_(problems, problem, source, quantity, score, downtime);
    addAggregate_(stations, station, source, quantity, score, downtime);
    if (source === 'ALEA') addAggregate_(machineTypes, machineType, source, quantity, score, downtime);
    addAggregate_(categories, category, source, quantity, score, downtime);
    if (msn) addAggregate_(msns, msn, source, quantity, score, downtime);
    if (row[index.COUT_RENSEIGNE] === true || String(row[index.COUT_RENSEIGNE]).toUpperCase() === 'OUI') {
      totalCost += numberOr_(row[index.COUT_TOTAL_EUR], 0);
      knownCostRows += 1;
    }
  });

  const machineResults = topAggregates_(machines, 0, 'total');
  const topFiveTotal = machineResults.slice(0, 5).reduce((sum, item) => sum + item.total, 0);
  const drillingByFamily = (references && references.drillingByFamily) || {};
  const familyResults = topAggregates_(families, 0, 'total').map(item => {
    const drilling = drillingByFamily[normalizeHeader_(item.label)] || 0;
    return Object.assign(item, { drilling, impactsPer1000Drillings: drilling ? item.total * 1000 / drilling : null });
  });
  const activityMsn = references && references.activityMsn ? references.activityMsn : null;
  const detailsLimit = 100;
  const detailRows = buildSourceDetailRows_(rows, index, source);
  const detailsTotal = detailRows.length;
  return {
    source,
    kpis: {
      total,
      ncCount,
      declarations: declarations.size,
      machines: machineResults.length,
      families: familyResults.length,
      recurrentMachines: machineResults.filter(item => item.total >= 2).length,
      topFiveShare: total ? Math.round(topFiveTotal * 100 / total) : 0,
      masterCoverage: total ? Math.round(masterMatched * 100 / total) : 0,
      downtimeHours,
      averageDowntime: total ? downtimeHours / total : 0,
      totalCost,
      costCoverage: rows.length ? Math.round(knownCostRows * 100 / rows.length) : 0,
      activityMsn,
      impactsPerMsn: activityMsn ? Math.round(total * 100 / activityMsn) / 100 : null,
      withoutImmoRows,
      withoutImmoQuantity
    },
    trend: Object.keys(trend).sort().map(week => [week, trend[week]]),
    machines: machineResults,
    families: familyResults,
    problems: topAggregates_(problems, 10, 'total'),
    stations: topAggregates_(stations, 10, 'total'),
    machineTypes: topAggregates_(machineTypes, 10, 'total'),
    categories: topAggregates_(categories, 10, 'total'),
    msns: topAggregates_(msns, 12, 'total'),
    detailsTotal,
    detailsLimit,
    details: detailRows.slice(0, detailsLimit)
  };
}

function buildSourceDetailRows_(rows, index, source) {
  const sortedRows = rows.slice().sort((left, right) => dateSortValue_(right[index.DATE]) - dateSortValue_(left[index.DATE]));
  return source === 'NC'
    ? groupNcDetailRows_(sortedRows, index)
    : sortedRows.map(row => sourceDetailRow_(row, index, source));
}

function sourceDetailRow_(row, index, source) {
  const comment = clean_(row[index.COMMENTAIRE]);
  const commentQuality = clean_(row[index.COMMENTAIRE_QUALITE]);
  const immo = clean_(row[index.IMMO]);
  return {
    date: sourceAnalysisDateKey_(row[index.DATE]), immo, machineName: !immo ? clean_(row[index.TYPE_MACHINE]) || clean_(row[index.POSTE]) : '', family: clean_(row[index.FAMILLE]),
    station: canonicalStation_(row[index.POSTE]), category: clean_(row[index.CATEGORIE]), problem: clean_(row[index.PROBLEME]),
    comment, commentQuality, hypothesisCause: source === 'ALEA' ? comment : '', ncNumber: clean_(row[index.NC_NUMERO]),
    ncCount: numberOr_(row[index.NB_NC], 0), msn: clean_(row[index.MSN]), quantity: numberOr_(row[index.QUANTITE], 1),
    downtime: numberOr_(row[index.TEMPS_PERDU_HEURES], 0)
  };
}

function groupNcDetailRows_(rows, index) {
  const groups = {};
  rows.forEach(row => {
    const detail = sourceDetailRow_(row, index, 'NC');
    const declarationId = clean_(row[index.ID_EVENEMENT]).replace(/-[0-9a-f]{8}$/i, '');
    const key = detail.ncNumber ? `NC:${detail.ncNumber}` : `EVENEMENT:${declarationId}`;
    if (!groups[key]) {
      groups[key] = Object.assign({}, detail, { immo: '', station: '', family: '', msn: '', comment: '', commentQuality: '', quantity: 0, ncCount: 0, downtime: 0, immos: [], stations: [], families: [], msns: [], comments: [], qualityComments: [] });
    }
    const group = groups[key];
    [detail.immo].filter(Boolean).forEach(value => group.immos.push(value));
    [detail.station].filter(Boolean).forEach(value => group.stations.push(value));
    [detail.family].filter(Boolean).forEach(value => group.families.push(value));
    [detail.msn].filter(Boolean).forEach(value => group.msns.push(value));
    [detail.comment].filter(Boolean).forEach(value => group.comments.push(value));
    [detail.commentQuality].filter(Boolean).forEach(value => group.qualityComments.push(value));
    group.quantity += detail.quantity;
    group.ncCount += detail.ncCount;
    group.downtime += detail.downtime;
  });
  return Object.values(groups).map(group => Object.assign(group, {
    immo: uniqueDetailValues_(group.immos).join(' / '),
    station: uniqueDetailValues_(group.stations).join(' / '),
    family: uniqueDetailValues_(group.families).join(' / '),
    msn: uniqueDetailValues_(group.msns).join(' / '),
    comment: uniqueDetailValues_(group.comments).join(' | '),
    commentQuality: uniqueDetailValues_(group.qualityComments).join(' | ')
  }));
}

function uniqueDetailValues_(values) {
  return [...new Set(values || [])];
}

function collectSourceAnalysisOptions_(rows, index, source) {
  const sourceRows = rows.filter(row => row[index.SOURCE] === source);
  const unique = column => [...new Set(sourceRows.map(row => clean_(row[index[column]])).filter(Boolean))].sort();
  return { families: unique('FAMILLE'), stations: stationFilterOptions_(), categories: unique('CATEGORIE'), immos: unique('IMMO').filter(isPlausibleImmo_), msns: unique('MSN') };
}

function sourceAnalysisDateKey_(value) {
  const date = parseDate_(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

function factsSchemaStatus_(headers) {
  const known = new Set((headers || []).map(clean_));
  const missing = APP.factsHeaders.filter(header => !known.has(header));
  return { missing, needsRefresh: missing.length > 0 };
}

function ensureFactsSchema_(sheet) {
  if (sheet.getLastRow() === 0) {
    replaceSheetData_(sheet, [APP.factsHeaders]);
    return { missing: [], needsRefresh: false };
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const status = factsSchemaStatus_(headers);
  if (!status.missing.length) return status;
  sheet.insertColumnsAfter(sheet.getLastColumn(), status.missing.length);
  setSheetValues_(sheet.getRange(1, headers.length + 1, 1, status.missing.length), [status.missing]);
  return status;
}

function preserveFactsRebuildFlag_(schemaStatus) {
  if (schemaStatus && schemaStatus.needsRefresh) {
    PropertiesService.getScriptProperties().setProperty('FACTS_SCHEMA_REBUILD_REQUIRED', 'OUI');
  }
}

function emptySourceAnalysis_(source, message) {
  return {
    source, empty: true, message, refreshedAt: '', origin: sourceAnalysisOrigin_(source), options: { families: [], stations: [], categories: [] },
    kpis: { total: 0, ncCount: 0, declarations: 0, machines: 0, families: 0, recurrentMachines: 0, topFiveShare: 0, masterCoverage: 0, downtimeHours: 0, averageDowntime: 0, totalCost: 0, costCoverage: 0, activityMsn: null, impactsPerMsn: null },
    detailsTotal: 0, detailsLimit: 100,
    trend: [], machines: [], families: [], problems: [], stations: [], machineTypes: [], categories: [], msns: [], details: []
  };
}

function trendWindow_() {
  const today = new Date();
  const year = today.getFullYear();
  return { from: toIsoDate_(new Date(year, 0, 1)), to: toIsoDate_(today), trendLabel: `Année ${year}` };
}

function getDashboardDetails(filters, selection) {
  const request = { filters: filters || {}, selection: selection || {} };
  const cacheKey = analyticsCacheKey_('details', request);
  const directSource = selection && selection.directSource && filters && filters.source === 'ALEA';
  const cached = directSource ? null : readAnalyticsCache_(cacheKey);
  if (cached) return cached;
  const factData = directSource ? readProductionAleaFacts_() : readFactsForAnalysis_(filters || {});
  if (!factData.values.length) {
    const empty = { total: 0, rows: [] };
    return directSource ? empty : cacheAnalyticsResponse_(cacheKey, empty);
  }
  const values = factData.values;
  const headers = factData.headers;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const selected = selection || {};
  const matching = values
    .filter(row => matchesFilters_(row, index, filters || {}))
    .filter(row => matchesDetailSelection_(row, index, selected))
    .sort((left, right) => dateSortValue_(right[index.DATE]) - dateSortValue_(left[index.DATE]));
  const result = {
    total: matching.length,
    rows: matching.slice(0, 500).map(row => ({
      date: dateKey_(row[index.DATE]),
      source: sourceLabel_(row[index.SOURCE]),
      immo: clean_(row[index.IMMO]),
      family: clean_(row[index.FAMILLE]),
      station: canonicalStation_(row[index.POSTE]),
      category: clean_(row[index.CATEGORIE]),
      problem: clean_(row[index.PROBLEME]),
      comment: clean_(row[index.COMMENTAIRE]),
      ncNumber: clean_(row[index.NC_NUMERO]),
      ncCount: numberOr_(row[index.NB_NC], 0),
      quantity: numberOr_(row[index.QUANTITE], 1),
      downtime: numberOr_(row[index.TEMPS_PERDU_HEURES], 0),
      matchMethod: clean_(row[index.RAPPROCHEMENT_MES])
    }))
  };
  return directSource ? result : cacheAnalyticsResponse_(cacheKey, result);
}

function matchesDetailSelection_(row, index, selection) {
  const value = clean_(selection.value);
  if (!value) return true;
  switch (selection.dimension) {
    case 'week': return weekKey_(row[index.DATE]) === value;
    case 'immo': return clean_(row[index.IMMO]) === value;
    case 'family': return clean_(row[index.FAMILLE]) === value;
    case 'station': return (canonicalStation_(row[index.POSTE]) || 'Poste inconnu') === canonicalStation_(value);
    case 'availability':
      return clean_(row[index.SOURCE]) === 'ALEA_MES'
        && clean_(row[index.FAMILLE]) === clean_(selection.family || selection.value)
        && isAvailabilityMesProblem_(row[index.PROBLEME]);
    case 'machineType': return (clean_(row[index.TYPE_MACHINE]) || 'Type non renseigné') === value;
    case 'category': return (clean_(row[index.CATEGORIE]) || 'Catégorie non renseignée') === value;
    case 'msn': return clean_(row[index.MSN]) === value;
    case 'problem': return (clean_(row[index.PROBLEME]) || clean_(row[index.CATEGORIE]) || 'Non renseigné') === value;
    case 'source': return clean_(row[index.SOURCE]) === value;
    default: return true;
  }
}

function sourceLabel_(source) {
  return { ALEA: 'Aléas production', NC: 'NC', ALEA_MES: 'Aléas MES' }[clean_(source)] || clean_(source);
}

function dateSortValue_(value) {
  const parsed = parseDate_(value);
  return parsed ? parsed.getTime() : 0;
}

function mftActionsHeaders_() {
  return [
    'ID', 'DATE_CREATION', 'IMMO', 'FAMILLE', 'CONSTAT', 'DECISION', 'RESPONSABLE',
    'ECHEANCE', 'STATUT', 'DATE_CLOTURE', 'PRIORITE', 'SYNC_MFT_FEUILLE',
    'SYNC_MFT_LIGNE', 'SYNC_MFT_STATUT'
  ];
}

function getMftAgenda() {
  return getNormalizedMftAgenda_();
}

function getOfficialMftPlan_() {
  return getNormalizedOfficialMftPlan_();
}

function findLatestMftSheet_(spreadsheet) {
  const datePattern = /(\d{2})[ _./-]?(\d{2})[ _./-]?(\d{4})/;
  const candidates = spreadsheet.getSheets().map(sheet => {
    const name = sheet.getName();
    const normalized = normalizeHeader_(name);
    if (!normalized.includes('MFT') || !normalized.includes('MACHINES') || !normalized.includes('PA')) return null;
    if (!/ALEAS|ALEA/.test(normalized)) return null;
    const match = name.match(datePattern);
    if (!match) return null;
    const meetingDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (Number.isNaN(meetingDate.getTime())) return null;
    return { sheet, name, meetingDate };
  }).filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.meetingDate.getTime() - left.meetingDate.getTime());
  return candidates[0];
}

function findMftHeaderRow_(rawValues) {
  const required = ['REF', 'ISSUE', 'ACTION'];
  for (let rowIndex = 0; rowIndex < Math.min(rawValues.length, 20); rowIndex += 1) {
    const normalized = rawValues[rowIndex].map(normalizeHeader_);
    if (required.every(token => normalized.includes(token))) return rowIndex;
  }
  return -1;
}

function mapMftColumns_(headerRow) {
  const normalized = headerRow.map(normalizeHeader_);
  const find = (...tokens) => normalized.findIndex(value => tokens.includes(value));
  return {
    ref: find('REF'),
    whoRaise: find('WHORAISE'),
    when: find('WHEN'),
    issue: find('ISSUE'),
    action: find('ACTION'),
    responsable: find('RESP', 'RESPONSABLE'),
    due: find('DUE'),
    status: find('STATUS', 'STATUT'),
    priority: find('PRIORITE', 'PRIORITY'),
    comment: find('COMMENT', 'COMMENTAIRE')
  };
}

function formatMftDue_(rawValue, displayValue) {
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) return toIsoDate_(rawValue);
  const numeric = Number(rawValue);
  if (Number.isFinite(numeric) && numeric > 20000) return toIsoDate_(new Date(Date.UTC(1899, 11, 30) + numeric * 86400000));
  if (Number.isFinite(numeric) && numeric >= 1900 && numeric <= 2100) return String(numeric);
  return clean_(displayValue);
}

function extractMftMetadata_(values, headerRow) {
  let participants = '';
  const statusCounts = {};
  let nextMeeting = '';
  for (let rowIndex = 0; rowIndex < headerRow; rowIndex += 1) {
    const row = values[rowIndex] || [];
    row.forEach((cell, colIndex) => {
      const text = clean_(cell);
      if (!text) return;
      if (/prochaine\s+r[ée]union/i.test(text)) nextMeeting = text;
      if (/^participants$/i.test(text)) {
        const value = row.slice(colIndex + 1).map(clean_).find(Boolean);
        if (value) participants = value;
      }
      if (/^(open|done|due|deferred)$/i.test(text)) {
        const count = Number(clean_(row[colIndex + 1]));
        if (Number.isFinite(count)) statusCounts[text.toLowerCase()] = count;
      }
    });
  }
  return { participants, nextMeeting, statusCounts };
}


function sortMftActions_(left, right) {
  const openLeft = left.statut !== 'Fait' && left.statut !== 'Abandonné';
  const openRight = right.statut !== 'Fait' && right.statut !== 'Abandonné';
  if (openLeft !== openRight) return openLeft ? -1 : 1;
  return dateSortValue_(left.echeance) - dateSortValue_(right.echeance);
}

function saveMftAction(action) {
  return saveOfficialMftAction_(action);
}

function deleteMftAction(id) {
  return abandonOfficialMftAction_(id);
}

function readMftActions_() {
  return readNormalizedMftActions_();
}

function ensureMftActionsSchema_(sheet) {
  const expected = mftActionsHeaders_();
  if (sheet.getLastRow() === 0) {
    replaceSheetData_(sheet, [expected]);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
  expected.forEach(header => {
    if (!existing.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });
}

function toIsoDate_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function appendFacts_(target, records, source, aliases, master, parameters, sourceName) {
  records.forEach((record, rowIndex) => {
    const immos = splitImmos_(pick_(record, aliases.immo));
    const sourceSection = clean_(pick_(record, aliases.section));
    const sourceStation = clean_(pick_(record, aliases.station));
    const sourceMachineName = sourceMachineName_(record, aliases);
    const sourceFamily = clean_(pick_(record, aliases.family));
    const sourceMachineType = clean_(pick_(record, aliases.machineType));
    const sourceImmos = immos.filter(Boolean);
    const aleaSourceInScope = source === 'ALEA' && isAleaProductionSourceRowInScope_(sourceSection, sourceStation);
    const sourceQuantity = Math.max(1, numberOr_(pick_(record, aliases.quantity), 1));
    const declaredNc = pick_(record, aliases.ncCount);
    const acceptedImmos = immos.filter(immo => {
      const indexedMasterData = master.byImmo[immo] || {};
      if (!indexedMasterData.immo || !isDrillingMachine_(indexedMasterData)) return false;
      if (!isInScope_(indexedMasterData.section)) return false;
      return isInScope_(sourceSection || indexedMasterData.section || '');
    });
    const retainedImmos = retainedSourceImmos_(source, sourceImmos, acceptedImmos, master, sourceSection, sourceStation);
    const canRetainWithoutImmo = canRetainNcWithoutImmo_(source, sourceImmos, sourceFamily, sourceMachineName, sourceStation, sourceSection);
    const factImmos = source === 'ALEA'
      ? (aleaSourceInScope ? (sourceImmos.length ? sourceImmos : ['']) : [])
      : (retainedImmos.length ? retainedImmos : canRetainWithoutImmo ? [''] : []);
    factImmos.forEach(immo => {
      const indexedMasterData = master.byImmo[immo] || {};
      const masterData = indexedMasterData.immo && isInScope_(indexedMasterData.section) ? indexedMasterData : {};
      const section = sourceSection || masterData.section || '';
      const station = sourceStation || sourceMachineName || masterData.station || '';
      if (source === 'ALEA' && !isAleaStationInScope_(station)) return;
      const date = parseDate_(pick_(record, aliases.date));
      const allocationCount = source === 'NC' ? Math.max(1, factImmos.length) : 1;
      const quantity = sourceQuantity / allocationCount;
      const category = clean_(pick_(record, aliases.category));
      const category2 = clean_(pick_(record, aliases.category2));
      const problem = clean_(pick_(record, aliases.problem));
      const comment = clean_(pick_(record, aliases.comment));
      const ncNumber = clean_(pick_(record, aliases.ncNumber));
      const ncCount = declaredNc === '' ? '' : numberOr_(declaredNc, '') / allocationCount;
      const msn = clean_(pick_(record, aliases.msn));
      const explicitId = clean_(pick_(record, aliases.eventId));
      const parentEventId = explicitId || digest_([source, dateKey_(date), category, problem, rowIndex + 2].join('|'));
      const eventId = factImmos.length > 1 ? `${parentEventId}-${digest_(immo).slice(0, 8)}` : parentEventId;
      const downtimeHours = parseDurationHours_(pick_(record, aliases.durationHours));
      const allocatedDowntime = downtimeHours / Math.max(1, factImmos.length);
      const cost = resolveFactCost_(parameters, source, quantity, allocatedDowntime, factImmos.length);
      const weight = configuredWeight_(parameters, source);
      const family = source === 'NC' ? sourceFamily || masterData.family || '' : masterData.family || sourceFamily || '';
      target.push([
        `${source}-${eventId}`, date || '', monthKey_(date), source, immo,
        family,
        masterData.machineType || sourceMachineType || (source === 'NC' && !immo ? sourceMachineName : ''),
        masterData.program || '', masterData.site || '',
        section,
        station,
        category, problem, quantity, cost.unit === null ? '' : cost.unit,
        cost.total === null ? '' : cost.total, cost.known,
        weight, Boolean(masterData.immo), sourceName, new Date(), allocatedDowntime, '',
        category2, comment, ncNumber, ncCount, msn, clean_(pick_(record, aliases.commentQuality))
      ]);
    });
  });
}

function assertAleaConsolidation_(sourceRows, facts) {
  if (!(sourceRows || []).length) {
    throw new Error(`La feuille « ${APP.sourceSheets.aleas} » ne contient aucune ligne de données.`);
  }
  const retained = (facts || []).filter(row => clean_(row[3]) === 'ALEA').length;
  if (!retained) {
    throw new Error('Aucun aléa production TC n’a été consolidé. Actualisation interrompue pour préserver FAITS_IMMO ; contrôlez les colonnes IMMO, Section, Poste et le master.');
  }
  return retained;
}

function appendStagedMesFacts_(target, rows, master, parameters) {
  rows.forEach((row, rowIndex) => {
    const source = clean_(row.SOURCE) === 'NC' ? 'NC' : 'ALEA_MES';
    if (source === 'ALEA_MES' && isExcludedMesSourceComment_(row.COMMENTAIRE_INITIAL || row.COMMENTAIRE)) return;
    if (source === 'ALEA_MES' && !isMesTimeAnalysisRow_(row)) return;
    if (source === 'NC' && clean_(row.STATUT_WORKFLOW) !== 'VALIDEE') return;
    const isLegacyQlik = !clean_(row.SOURCE) && /^DZ/i.test(clean_(row.ID_EVENEMENT));
    if (isLegacyQlik && normalizeHeader_(row.TYPE_MACHINE) !== 'UPAMEDU') return;
    if (isLegacyQlik && !normalizeHeader_(row.SECTION).startsWith('TCA350STR')) return;
    const identity = resolveMesIdentity_(row.IMMO || row.IMMO_SOURCE, row.FAMILLE, row.COMMENTAIRE_INITIAL, master);
    // Un IMMO saisi puis validé par la Qualité reste attribué même s'il manque au master.
    const validatedImmo = source === 'NC' ? normalizeImmo_(clean_(row.IMMO_SAISI)) : '';
    const immos = isMesIdentityImmoMethod_(identity.method) && identity.immos.length
      ? identity.immos
      : isPlausibleImmo_(validatedImmo) ? [validatedImmo] : [''];
    immos.forEach(immo => {
      const indexedMasterData = master.byImmo[immo] || {};
      const masterData = indexedMasterData.immo && isInScope_(indexedMasterData.section)
        ? indexedMasterData
        : identity.masterData || master.byImmo[identity.immos[0]] || {};
      const section = clean_(row.SECTION) || masterData.section || '';
      if (!isInScope_(section)) return;
      if (masterData.immo && !isDrillingMachine_(masterData)) return;
      const date = parseDate_(row.DATE);
      const quantity = source === 'NC'
        ? Math.max(1, numberOr_(row.NB_NC, row.QUANTITE))
        : Math.max(1, numberOr_(row.QUANTITE, 1));
      const parentEventId = clean_(row.ID_EVENEMENT) || digest_([source, dateKey_(date), row.PROBLEME, row.FICHIER_ID, rowIndex].join('|'));
      const eventId = immos.length > 1 ? `${parentEventId}-${digest_(immo).slice(0, 8)}` : parentEventId;
      const allocatedDowntime = Math.max(0, numberOr_(row.TEMPS_PERDU_HEURES, 0)) / immos.length;
      const cost = resolveFactCost_(parameters, source, quantity, allocatedDowntime, immos.length);
      target.push([
        `${source}-${eventId}`, date || '', monthKey_(date), source, immo,
        masterData.family || '',
        masterData.machineType || clean_(row.TYPE_MACHINE) || '',
        masterData.program || '', masterData.site || '',
        section,
        clean_(row.POSTE) || masterData.station || '', clean_(row.CATEGORIE),
        normalizeQlikProblem_(row.PROBLEME, isLegacyQlik), quantity, cost.unit === null ? '' : cost.unit,
        cost.total === null ? '' : cost.total, cost.known,
        configuredWeight_(parameters, source), Boolean(masterData.immo),
        clean_(row.FICHIER_NOM), new Date(), allocatedDowntime, clean_(row.METHODE_RAPPROCHEMENT) || identity.method,
        '', clean_(row.COMMENTAIRE_INITIAL), clean_(row.NC_NUMERO), source === 'NC' ? quantity : '', clean_(row.MSN), clean_(row.COMMENTAIRE_PREPARATION)
      ]);
    });
  });
}

function isMesTimeAnalysisRow_(row, referenceDate) {
  if (normalizeHeader_(row.CATEGORIE) !== '03MOYENS') return false;
  const date = parseDate_(row.DATE);
  if (!date) return false;
  const now = referenceDate || new Date();
  const cutoff = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  return date >= cutoff;
}

function buildMasterIndex_(records) {
  const byImmo = {};
  const byImmoKey = {};
  const byEquipmentKey = {};
  const identityOwners = {};
  const equipmentOwners = {};
  const byFamilyKey = {};
  const familyIdentityOwners = {};
  const familyGroups = {};
  const duplicates = {};
  const invalidImmos = {};
  records.forEach(record => {
    const immo = normalizeImmo_(pick_(record, APP.aliases.master.immo));
    if (!immo) return;
    if (!isPlausibleImmo_(immo)) {
      invalidImmos[immo] = (invalidImmos[immo] || 0) + 1;
      return;
    }
    const masterCategory = clean_(pick_(record, APP.aliases.master.category));
    const hasCategoryColumn = Object.keys(record).some(key => normalizeHeader_(key) === 'CATEGORIE');
    const equipment = normalizeEquipment_(pick_(record, APP.aliases.master.equipment));
    if (byImmo[immo]) duplicates[immo] = (duplicates[immo] || 1) + 1;
    byImmo[immo] = {
      immo,
      equipment,
      family: clean_(pick_(record, APP.aliases.master.family)),
      machineType: clean_(pick_(record, APP.aliases.master.machineType)),
      category: masterCategory || (hasCategoryColumn ? '' : APP.scope.machineCategory),
      program: clean_(pick_(record, APP.aliases.master.program)),
      site: clean_(pick_(record, APP.aliases.master.site)),
      section: clean_(pick_(record, APP.aliases.master.section)),
      station: clean_(pick_(record, APP.aliases.master.station))
    };
    [immo, byImmo[immo].family, byImmo[immo].machineType].flatMap(identityVariants_).forEach(key => {
      if (!key) return;
      identityOwners[key] = identityOwners[key] || [];
      if (!identityOwners[key].includes(immo)) identityOwners[key].push(immo);
    });
    if (equipment) {
      equipmentOwners[equipment] = equipmentOwners[equipment] || [];
      if (!equipmentOwners[equipment].includes(immo)) equipmentOwners[equipment].push(immo);
    }
    const familyKey = identityKey_(byImmo[immo].family);
    if (familyKey && isInScope_(byImmo[immo].section)) {
      familyGroups[familyKey] = familyGroups[familyKey] || [];
      familyGroups[familyKey].push(byImmo[immo]);
    }
  });
  Object.entries(identityOwners).forEach(([key, immos]) => {
    if (immos.length === 1) byImmoKey[key] = immos[0];
  });
  Object.entries(equipmentOwners).forEach(([key, immos]) => {
    if (immos.length === 1) byEquipmentKey[key] = immos[0];
  });
  const immosByFamilyKey = {};
  Object.entries(familyGroups).forEach(([familyKey, entries]) => {
    immosByFamilyKey[familyKey] = [...new Set(entries.map(entry => entry.immo))];
    byFamilyKey[familyKey] = {
      family: entries[0].family,
      machineType: commonMasterValue_(entries, 'machineType'),
      category: commonMasterValue_(entries, 'category'),
      program: commonMasterValue_(entries, 'program'),
      site: commonMasterValue_(entries, 'site'),
      section: commonMasterValue_(entries, 'section'),
      station: commonMasterValue_(entries, 'station')
    };
    identityVariants_(byFamilyKey[familyKey].family).forEach(key => {
      familyIdentityOwners[key] = familyIdentityOwners[key] || [];
      if (!familyIdentityOwners[key].includes(familyKey)) familyIdentityOwners[key].push(familyKey);
    });
  });
  return { byImmo, byImmoKey, byEquipmentKey, identityOwners, equipmentOwners, byFamilyKey, familyIdentityOwners, immosByFamilyKey, duplicates, invalidImmos };
}

function commonMasterValue_(entries, field) {
  const values = [...new Set(entries.map(entry => clean_(entry[field])).filter(Boolean))];
  return values.length === 1 ? values[0] : '';
}

function writeFacts_(facts) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.insertSheet(`${APP.sheets.facts}__PUBLICATION_${new Date().getTime()}`);
  try {
    sheet.hideSheet();
  } catch (error) {
    console.warn(`Feuille de publication temporaire laissée visible : ${error.message || error}`);
  }
  try {
    setSheetValues_(sheet.getRange(1, 1, facts.length + 1, APP.factsHeaders.length), [APP.factsHeaders, ...facts]);
    sheet.setFrozenRows(1);
    styleHeader_(sheet, APP.factsHeaders.length);
    if (facts.length) {
      sheet.getRange(2, 2, facts.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(2, 15, facts.length, 2).setNumberFormat('#,##0.00 [$€-fr-FR]');
      sheet.getRange(2, 22, facts.length, 1).setNumberFormat('0.00 "h"');
    }
  } catch (error) {
    if (spreadsheet.getSheets().some(candidate => candidate.getSheetId() === sheet.getSheetId())) spreadsheet.deleteSheet(sheet);
    throw error;
  }
  publishFactsSheet_(spreadsheet, sheet);
  PropertiesService.getScriptProperties().deleteProperty('FACTS_SCHEMA_REBUILD_REQUIRED');
  PropertiesService.getScriptProperties().setProperty('ANALYTICS_CACHE_VERSION', new Date().toISOString());
}

function partitionFactsByRetention_(facts, referenceDate, dateIndex) {
  const cutoff = new Date(referenceDate.getFullYear() - 2, referenceDate.getMonth(), referenceDate.getDate());
  const active = [];
  const archived = [];
  facts.forEach(row => {
    const date = parseDate_(row[dateIndex]);
    if (date && date < cutoff) archived.push(row);
    else active.push(row);
  });
  return { active, archived, cutoff };
}

function normalizeFactRowsToCurrentSchema_(headers, rows) {
  const positions = Object.fromEntries((headers || []).map((header, index) => [clean_(header), index]));
  return {
    headers: APP.factsHeaders.slice(),
    rows: (rows || []).map(row => APP.factsHeaders.map(header => {
      const position = positions[header];
      return position === undefined ? '' : row[position];
    }))
  };
}

function shouldIncludeArchivedFacts_(filters, referenceDate) {
  if (!filters || !clean_(filters.from)) return true;
  const from = parseFilterDate_(filters.from, false);
  if (!from) return true;
  const now = referenceDate || new Date();
  const cutoff = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  return from < cutoff;
}

function mergeAnalysisFactRows_(activeRows, archivedRows) {
  const byKey = new Map();
  [...(activeRows || []), ...(archivedRows || [])].forEach(row => {
    const source = clean_(row[3]) || 'INCONNU';
    const key = `${source}:${archiveFactKey_(row)}`;
    if (!byKey.has(key)) byKey.set(key, row);
  });
  return [...byKey.values()];
}

function readFactsForAnalysis_(filters) {
  const spreadsheet = SpreadsheetApp.getActive();
  const activeSheet = getActiveFactsSheet_(spreadsheet);
  let schemaHeaders = APP.factsHeaders.slice();
  let activeRows = [];
  if (activeSheet && activeSheet.getLastRow() >= 1) {
    const activeValues = activeSheet.getDataRange().getValues();
    schemaHeaders = activeValues.shift();
    activeRows = normalizeFactRowsToCurrentSchema_(schemaHeaders, activeValues).rows;
  }
  if (!shouldIncludeArchivedFacts_(filters, new Date())) {
    return { headers: APP.factsHeaders.slice(), schemaHeaders, values: activeRows };
  }
  const archiveSheet = spreadsheet.getSheetByName(APP.sheets.factsArchive);
  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    return { headers: APP.factsHeaders.slice(), schemaHeaders, values: activeRows };
  }
  const archiveValues = archiveSheet.getDataRange().getValues();
  const archiveHeaders = archiveValues.shift();
  const archivedRows = normalizeFactRowsToCurrentSchema_(archiveHeaders, archiveValues).rows;
  return {
    headers: APP.factsHeaders.slice(),
    schemaHeaders,
    values: mergeAnalysisFactRows_(activeRows, archivedRows)
  };
}

function archiveFactKey_(row) {
  const id = clean_(row[0]);
  if (id) return `ID-${id}`;
  const serialized = row.map(value => value instanceof Date ? value.toISOString() : clean_(value)).join('\u001f');
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = ((second * 33) ^ code) >>> 0;
  }
  return `SANS_ID-${(first >>> 0).toString(36)}-${second.toString(36)}-${serialized.length}`;
}

function ensureFactsArchiveSchema_(sheet) {
  const expectedHeaders = [...APP.factsHeaders, 'CLE_ARCHIVAGE', 'DATE_ARCHIVAGE'];
  if (sheet.getLastRow() === 0) {
    replaceSheetData_(sheet, [expectedHeaders]);
    return expectedHeaders;
  }
  const values = sheet.getDataRange().getValues();
  const currentHeaders = values.shift();
  const isCurrent = currentHeaders.length === expectedHeaders.length && currentHeaders.every((header, index) => header === expectedHeaders[index]);
  if (isCurrent) return expectedHeaders;
  const positions = Object.fromEntries(currentHeaders.map((header, index) => [clean_(header), index]));
  const normalized = values.map(row => {
    const fact = APP.factsHeaders.map(header => positions[header] === undefined ? '' : row[positions[header]]);
    const archiveKey = positions.CLE_ARCHIVAGE === undefined ? archiveFactKey_(fact) : clean_(row[positions.CLE_ARCHIVAGE]) || archiveFactKey_(fact);
    const archivedAt = positions.DATE_ARCHIVAGE === undefined ? '' : row[positions.DATE_ARCHIVAGE];
    return [...fact, archiveKey, archivedAt];
  });
  replaceSheetData_(sheet, [expectedHeaders, ...normalized]);
  return expectedHeaders;
}

function appendArchivedFacts_(facts, archivedAt) {
  if (!facts.length) return { count: 0, updated: 0 };
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = ensureSheet_(spreadsheet, APP.sheets.factsArchive);
  const headers = ensureFactsArchiveSchema_(sheet);
  const archiveKeyColumn = headers.indexOf('CLE_ARCHIVAGE') + 1;
  const existingRows = sheet.getLastRow() < 2
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const existingByKey = new Map(existingRows.map((row, index) => [clean_(row[archiveKeyColumn - 1]), { row, sheetRow: index + 2 }]));
  const inserts = [];
  const updates = [];
  facts.map(row => ({ row, key: archiveFactKey_(row) })).forEach(item => {
    const next = [...item.row, item.key, archivedAt];
    const existing = existingByKey.get(item.key);
    if (!existing) {
      inserts.push(next);
      existingByKey.set(item.key, { row: next, sheetRow: 0 });
    } else if (!sameArchiveFact_(existing.row, next)) {
      updates.push({ sheetRow: existing.sheetRow, row: next });
    }
  });
  updates.forEach(item => setSheetValues_(sheet.getRange(item.sheetRow, 1, 1, headers.length), [item.row]));
  if (inserts.length) setSheetValues_(sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, headers.length), inserts);
  sheet.setFrozenRows(1);
  styleHeader_(sheet, headers.length);
  return { count: inserts.length, updated: updates.length };
}

function sameArchiveFact_(left, right) {
  return left.slice(0, APP.factsHeaders.length).every((value, index) => archiveComparableValue_(value) === archiveComparableValue_(right[index]));
}

function archiveComparableValue_(value) {
  return value instanceof Date ? value.toISOString() : clean_(value);
}

function writeControls_(facts, master) {
  const controls = {};
  facts.forEach(row => {
    const immo = row[4] || '(vide)';
    if (!row[4]) addControl_(controls, 'IMMO_MANQUANT_SOURCE', immo, row[3]);
    else if (!row[18]) addControl_(controls, 'IMMO_ABSENT_MASTER', immo, row[3]);
    if (!row[1]) addControl_(controls, 'DATE_MANQUANTE', immo, row[3]);
    if (!row[5]) addControl_(controls, 'FAMILLE_MANQUANTE', immo, row[3]);
    if (['FAMILLE_PARTIELLE', 'FAMILLE_COMMENTAIRE_A_VERIFIER', 'IMMO_HORS_PERIMETRE'].includes(row[22])) {
      addControl_(controls, 'RAPPROCHEMENT_MES_A_VERIFIER', immo, row[5] || row[22]);
    }
  });
  Object.entries(master.duplicates).forEach(([immo, count]) => {
    controls[`DOUBLON_MASTER|${immo}`] = ['DOUBLON_MASTER', immo, 'BDD_Master_amélio', count];
  });
  Object.entries(master.invalidImmos).forEach(([immo, count]) => {
    controls[`IMMO_MASTER_INVALIDE|${immo}`] = ['IMMO_MASTER_INVALIDE', immo, 'Valeur exclue du rapprochement', count];
  });
  const sheet = ensureSheet_(SpreadsheetApp.getActive(), APP.sheets.controls);
  replaceSheetData_(sheet, [['TYPE_CONTROLE', 'IMMO', 'DETAIL', 'NOMBRE'], ...Object.values(controls)]);
  sheet.setFrozenRows(1);
  styleHeader_(sheet, 4);
  sheet.autoResizeColumns(1, 4);
}

function countControlOccurrences_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(normalizeHeader_);
  const countIndex = headers.indexOf('NOMBRE');
  return values.reduce((total, row) => total + Math.max(0, numberOr_(row[countIndex], 1)), 0);
}

function addControl_(controls, type, immo, detail) {
  const key = `${type}|${immo}|${detail}`;
  if (!controls[key]) controls[key] = [type, immo, detail, 0];
  controls[key][3] += 1;
}

function readRecords_(spreadsheetId, sheetName) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = findSourceSheet_(spreadsheet, sheetName);
  if (!sheet) {
    const available = spreadsheet.getSheets().map(item => `« ${item.getName()} »`).join(', ');
    throw new Error(`Feuille introuvable : « ${sheetName} ». Feuilles disponibles : ${available}`);
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = canonicalizeSourceHeaders_(values.shift().map(clean_), values, sheetName);
  return values
    .filter(row => row.some(value => clean_(value) !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [normalizeHeader_(header), row[index]])));
}

function docMartinEquipmentRecords_(values) {
  const headerIndex = values.findIndex(row => ['NIMMO', 'FAMILLE', 'EQUIPEMENT']
    .every((header, column) => normalizeHeader_(row[column]) === header));
  if (headerIndex < 0) throw new Error('Colonnes N° IMMO, Famille et Equipement introuvables dans Doc&Martin.');
  return values.slice(headerIndex + 1).map(row => ({
    immo: normalizeImmo_(row[0]), family: clean_(row[1]), equipment: normalizeEquipment_(row[2])
  })).filter(row => row.immo && row.equipment && isPlausibleImmo_(row.immo));
}

function enrichMasterWithDocMartin_(master, records) {
  const owners = {};
  const families = {};
  master.byEquipmentKey = master.byEquipmentKey || {};
  (records || []).forEach(row => {
    owners[row.equipment] = owners[row.equipment] || new Set();
    owners[row.equipment].add(row.immo);
    if (!families[row.equipment] && row.family) families[row.equipment] = row.family;
  });
  Object.entries(owners).forEach(([equipment, immos]) => {
    if (immos.size !== 1 || (master.equipmentOwners[equipment] || []).length > 1) {
      delete master.byEquipmentKey[equipment];
      return;
    }
    const immo = [...immos][0];
    const data = master.byImmo[immo];
    if (!data || !isInScope_(data.section) || !isDrillingMachine_(data)) return;
    if (master.byEquipmentKey[equipment] && master.byEquipmentKey[equipment] !== immo) {
      delete master.byEquipmentKey[equipment];
      return;
    }
    const family = families[equipment];
    if (!data.family && family) data.family = family;
    master.byEquipmentKey[equipment] = immo;
  });
  return master;
}

function readMesMaster_(parameters) {
  return enrichMasterWithDocMartin_(
    buildMasterIndex_(readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master)),
    readDocMartinEquipmentRecords_(parameters)
  );
}

function readDocMartinEquipmentRecords_(parameters) {
  const spreadsheetId = clean_(parameters.ID_FICHIER_DOC_MARTIN);
  if (!spreadsheetId) return [];
  const sheet = findSourceSheet_(SpreadsheetApp.openById(spreadsheetId), 'Tables BDD SAP');
  if (!sheet) throw new Error('Onglet « Tables BDD SAP » introuvable dans Doc&Martin.');
  const lastRow = sheet.getLastRow();
  return docMartinEquipmentRecords_(lastRow ? sheet.getRange(1, 1, lastRow, 3).getDisplayValues() : []);
}

function canonicalizeSourceHeaders_(headers, rows, sheetName) {
  const normalized = (headers || []).map(clean_);
  if (normalizeHeader_(sheetName) !== normalizeHeader_(APP.sourceSheets.aleas)) return normalized;
  if (normalized.some(header => normalizeHeader_(header) === 'DATE')) return normalized;
  const samples = (rows || []).map(row => row[0]).filter(value => clean_(value) !== '').slice(0, 20);
  const parseable = samples.filter(value => parseDate_(value)).length;
  if (samples.length && parseable / samples.length >= 0.8) normalized[0] = 'Date';
  return normalized;
}

function getParameters_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.parameters);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Lancez d’abord « Initialiser ».');
  const sheetParameters = Object.fromEntries(sheet.getDataRange().getDisplayValues().slice(1)
    .filter(row => row[0])
    .map(row => [String(row[0]).trim(), String(row[1]).trim()]));
  const properties = PropertiesService.getScriptProperties();
  Object.keys(APP.parameterDefaults).filter(isSecureParameter_).forEach(key => {
    sheetParameters[key] = properties.getProperty(key) || sheetParameters[key] || '';
  });
  return sheetParameters;
}

function isSecureParameter_(key) {
  return /^ID_/.test(key);
}

function migrateSecureParameters_(current, spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const updates = {};
  Object.keys(APP.parameterDefaults).filter(isSecureParameter_).forEach(key => {
    if (properties.getProperty(key)) return;
    if (clean_(current[key])) {
      updates[key] = clean_(current[key]);
      return;
    }
    if (clean_(APP.parameterDefaults[key])) {
      updates[key] = clean_(APP.parameterDefaults[key]);
      return;
    }
    if (key === 'ID_FICHIER_MASTER' && findSourceSheet_(spreadsheet, APP.sourceSheets.master)) updates[key] = spreadsheet.getId();
    if (key === 'ID_FICHIER_ALEAS' && findSourceSheet_(spreadsheet, APP.sourceSheets.aleas)) updates[key] = spreadsheet.getId();
    if (key === 'ID_FICHIER_NC' && findSourceSheet_(spreadsheet, APP.sourceSheets.nc)) updates[key] = spreadsheet.getId();
  });
  if (Object.keys(updates).length) properties.setProperties(updates);
}

function synchroniserSourcesConnues() {
  return withScriptLock_(() => {
    const current = getParameters_();
    const masterId = clean_(current.ID_FICHIER_MASTER);
    const mftId = clean_(current.ID_FICHIER_PLAN_ACTIONS_MFT);
    const properties = PropertiesService.getScriptProperties();
    const keys = ['ID_FICHIER_ALEAS', 'ID_FICHIER_NC', 'ID_FICHIER_PLANNING_MSN', 'ID_FICHIER_TAUX_PERCAGE', 'ID_FICHIER_DOC_MARTIN'];
    const ids = Object.fromEntries(keys.map(key => [key, APP.parameterDefaults[key]]));
    properties.setProperties(ids);
    properties.setProperty('ANALYTICS_CACHE_VERSION', new Date().toISOString());
    SpreadsheetApp.getActive().toast(
      `5 sources synchronisées. Master : ${masterId ? `…${masterId.slice(-8)}` : 'absent'} ; MFT : ${mftId ? `…${mftId.slice(-8)}` : 'absent'}.`,
      'Dashboard Machine', 12
    );
    return { ...ids, ID_FICHIER_MASTER: masterId, ID_FICHIER_PLAN_ACTIONS_MFT: mftId };
  });
}

function getActiveFactsSheet_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const sheetId = Number(properties.getProperty('FACTS_ACTIVE_SHEET_ID'));
  const activeSheet = Number.isFinite(sheetId) ? spreadsheet.getSheetById(sheetId) : null;
  if (activeSheet) {
    const canonical = spreadsheet.getSheetByName(APP.sheets.facts);
    const activeIsUnpublished = activeSheet.getName().startsWith(`${APP.sheets.facts}__PUBLICATION_`);
    if (activeIsUnpublished && canonical && canonical.getSheetId() !== activeSheet.getSheetId() && canonical.getLastRow() >= 2) {
      properties.setProperty('FACTS_ACTIVE_SHEET_ID', String(canonical.getSheetId()));
      return canonical;
    }
    return activeSheet;
  }
  const fallback = ensureSheet_(spreadsheet, APP.sheets.facts);
  properties.setProperty('FACTS_ACTIVE_SHEET_ID', String(fallback.getSheetId()));
  return fallback;
}

function cleanupStaleFactsPublicationSheets_(spreadsheet, activeSheet) {
  const staleName = new RegExp('^' + APP.sheets.facts + '(?:_\\d+|__(?:PUBLICATION|PRECEDENT)_\\d+)$', 'i');
  spreadsheet.getSheets()
    .filter(sheet => staleName.test(sheet.getName())
      && sheet.getSheetId() !== activeSheet.getSheetId())
    .forEach(sheet => {
      try {
        if (sheet.getLastRow() < 2) spreadsheet.deleteSheet(sheet);
        else if (!sheet.isSheetHidden()) sheet.hideSheet();
      } catch (error) {
        console.warn(`Ancienne feuille de faits conservée (${sheet.getName()}) : ${error.message || error}`);
      }
    });
}

function nettoyerOngletsTemporaires() {
  return withScriptLock_(() => {
    const spreadsheet = SpreadsheetApp.getActive();
    cleanupStaleFactsPublicationSheets_(spreadsheet, getActiveFactsSheet_(spreadsheet));
    spreadsheet.toast('Onglets temporaires vides supprimés ; onglets non vides masqués.', 'Dashboard Machine', 8);
  });
}

function publishFactsSheet_(spreadsheet, nextSheet) {
  const previousSheet = getActiveFactsSheet_(spreadsheet);
  if (previousSheet.getSheetId() === nextSheet.getSheetId()) return;
  previousSheet.setName(`${APP.sheets.facts}__PRECEDENT_${new Date().getTime()}`);
  nextSheet.setName(APP.sheets.facts);
  nextSheet.showSheet();
  PropertiesService.getScriptProperties().setProperty('FACTS_ACTIVE_SHEET_ID', String(nextSheet.getSheetId()));
  try {
    spreadsheet.deleteSheet(previousSheet);
  } catch (error) {
    console.warn(`Ancienne publication des faits conservée : ${error.message || error}`);
  }
  cleanupStaleFactsPublicationSheets_(spreadsheet, nextSheet);
}

function validateCoreParameters_(parameters) {
  ['ID_FICHIER_MASTER', 'ID_FICHIER_ALEAS'].forEach(key => {
    if (!parameters[key]) throw new Error(`Paramètre obligatoire non renseigné : ${key}`);
  });
}

function ensureSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function findSourceSheet_(spreadsheet, expectedName) {
  return spreadsheet.getSheetByName(expectedName)
    || spreadsheet.getSheets().find(sheet => normalizeHeader_(sheet.getName()) === normalizeHeader_(expectedName))
    || null;
}

function replaceSheetData_(sheet, values) {
  sheet.clearContents();
  if (values.length && values[0].length) setSheetValues_(sheet.getRange(1, 1, values.length, values[0].length), values);
}

function setSheetValues_(range, values) {
  range.setValues(values.map(row => row.map(protectSpreadsheetValue_)));
}

function protectSpreadsheetValue_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function styleHeader_(sheet, columns) {
  if (!columns) return;
  const headerColors = {
    PARAMETRES: '#b7791f',
    FAITS_IMMO: '#1f7a8c',
    FAITS_IMMO_ARCHIVES: '#64748b',
    CONTROLES: '#c05621',
    STG_MES: '#2b6cb0',
    NC_MES_PREVISIONNELLES: '#dd6b20',
    JOURNAL_IMPORT: '#805ad5'
  };
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(1);
  if (headerColors[sheet.getName()]) sheet.setTabColor(headerColors[sheet.getName()]);
  sheet.getRange(1, 1, 1, columns)
    .setBackground(headerColors[sheet.getName()] || '#173f46')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 34);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, columns)
      .setBackground('#f7fafb')
      .setFontColor('#243640')
      .setVerticalAlignment('middle')
      .setWrap(true);
  }
}

function pick_(record, aliases) {
  if (!aliases) return '';
  for (const alias of aliases) {
    const key = normalizeHeader_(alias);
    if (record[key] !== undefined && clean_(record[key]) !== '') return record[key];
  }
  return '';
}

function sourceMachineName_(record, aliases) {
  return clean_(pick_(record, aliases && aliases.machineName));
}

function canRetainNcWithoutImmo_(source, immos, family, machineName, station, section) {
  return source === 'NC' && !immos.length
    && Boolean(family || machineName || station)
    && isInScope_(section);
}

function retainedSourceImmos_(source, immos, acceptedImmos, master, sourceSection, sourceStation) {
  if (source !== 'NC' || !isInScope_(sourceSection)) return acceptedImmos;
  const acceptedSet = new Set(acceptedImmos);
  return immos.filter(immo => acceptedSet.has(immo) || (isPlausibleImmo_(immo) && !master.byImmo[immo]));
}

function normalizeHeader_(value) {
  return clean_(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clean_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeImmo_(value) {
  return clean_(value).replace(/\.0$/, '').toUpperCase();
}

function normalizeEquipment_(value) {
  return normalizeHeader_(clean_(value).replace(/\.0$/, ''));
}

function canonicalStation_(value) {
  const station = clean_(value);
  if (!station) return '';
  const normalized = station.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutPrefix = normalized.replace(/^P\s*/, '');
  const letterVariant = withoutPrefix.match(/^(370|360)\s*([A-E])$/);
  if (letterVariant) return `${letterVariant[1]}${letterVariant[2]}`;
  if (/^370(?:\s+(?:BLEU|BLUE|PAT(?:\s+FREIGHTER)?))?$/.test(withoutPrefix)) return '370';
  if (/^360(?:\s+PAT)?$/.test(withoutPrefix)) return '360';
  if (/^355$/.test(withoutPrefix)) return '355';
  return station;
}

function stationFilterOptions_() {
  return ['370', '370A', '370B', '370C', '370D', '370E', '360', '360A', '360B', '355'];
}

function stationFilterValues_(value) {
  const values = Array.isArray(value) ? value : [value];
  const allowed = new Set(stationFilterOptions_());
  return [...new Set(values.map(canonicalStation_).filter(station => allowed.has(station)))];
}

function stationMatchesFilter_(actual, requested) {
  const hasRequested = Array.isArray(requested) ? requested.length > 0 : Boolean(clean_(requested));
  if (!hasRequested) return true;
  return stationFilterValues_(requested).includes(canonicalStation_(actual));
}

function isPlausibleImmo_(value) {
  const normalized = normalizeImmo_(value);
  return /^(?=.*\d)[A-Z0-9_-]{5,30}$/.test(normalized);
}

function splitImmos_(value) {
  const immos = clean_(value)
    .split(/[\/;\r\n]+/)
    .map(normalizeImmo_)
    .filter(Boolean);
  return immos.length ? [...new Set(immos)] : [''];
}

function isAleaStationInScope_(value) {
  const normalized = normalizeHeader_(canonicalStation_(value)).replace(/[^A-Z0-9]/g, '');
  if (!normalized) return false;
  const stations = APP.scope.stations || [];
  return !stations.length || stations.some(station => normalized === normalizeHeader_(canonicalStation_(station)).replace(/[^A-Z0-9]/g, ''));
}

function isAleaProductionSourceRowInScope_(section, station) {
  return Boolean(clean_(section)) && isInScope_(section) && isAleaStationInScope_(station);
}

function isDrillingMachine_(masterData) {
  return normalizeHeader_(masterData && masterData.category) === normalizeHeader_(APP.scope.machineCategory);
}

function isInScope_(section) {
  if (!clean_(section)) return true;
  const normalizedSection = normalizeHeader_(section);
  return APP.scope.sections.some(value => {
    const expected = normalizeHeader_(value);
    return normalizedSection === expected || normalizedSection.startsWith(expected);
  });
}

function resolveMesIdentity_(immoValue, familyValue, comment, master) {
  const sourceImmo = isMissingMesImmo_(immoValue) ? '' : immoValue;
  const structuredTokens = tokenizeComment_(sourceImmo);
  const equipmentMatches = sourceEquipmentMatchesInScope_(structuredTokens, master);
  if (equipmentMatches.length === 1) {
    const masterData = master.byImmo[equipmentMatches[0]] || {};
    return { immos: equipmentMatches, family: masterData.family || '', masterData, method: 'IMMO_EQUIPEMENT_EXACT' };
  }
  const structuredMatches = sourceImmoMatchesInScope_(structuredTokens, master);
  if (structuredMatches.length) {
    const masterData = master.byImmo[structuredMatches[0]] || {};
    return { immos: structuredMatches, family: masterData.family || '', masterData, method: 'IMMO_SOURCE_EXACT' };
  }

  const commentTokens = tokenizeComment_(comment);
  const commentImmoResolution = resolveCommentImmo_(commentTokens, master);
  if (commentImmoResolution) {
    const masterData = master.byImmo[commentImmoResolution.immo] || {};
    return {
      immos: [commentImmoResolution.immo],
      family: masterData.family || '',
      masterData,
      method: commentImmoResolution.method
    };
  }
  const commentImmoTokens = commentTokens.filter(token => /^\d{7,8}$/.test(token));
  const commentImmoMatches = sourceImmoMatchesInScope_(commentImmoTokens, master);
  if (commentImmoTokens.length) {
    return { immos: [], family: clean_(familyValue), masterData: {}, method: commentImmoMatches.length > 1 ? 'IMMO_COMMENTAIRE_A_VERIFIER' : 'IMMO_COMMENTAIRE_NON_RECONNU' };
  }
  const familyCommentMatch = resolveCommentFamily_(commentTokens, master);
  if (familyCommentMatch) {
    return {
      immos: [],
      family: familyCommentMatch.data ? familyCommentMatch.data.family : '',
      masterData: familyCommentMatch.data || {},
      method: familyCommentMatch.ambiguous ? 'FAMILLE_COMMENTAIRE_A_VERIFIER' : 'FAMILLE_COMMENTAIRE'
    };
  }

  const familyMatch = resolveMasterFamily_(familyValue, master);
  if (familyMatch) {
    return { immos: [], family: familyMatch.data.family, masterData: familyMatch.data, method: familyMatch.method };
  }
  const fallbackImmo = normalizeImmo_(sourceImmo);
  const fallbackMasterImmo = master.byImmoKey[identityKey_(fallbackImmo)];
  const outsideScope = fallbackMasterImmo && !isInScope_((master.byImmo[fallbackMasterImmo] || {}).section);
  return {
    immos: isPlausibleImmo_(fallbackImmo) && !outsideScope ? [fallbackImmo] : [],
    family: clean_(familyValue),
    masterData: {},
    method: outsideScope ? 'IMMO_HORS_PERIMETRE' : fallbackImmo ? 'IMMO_SOURCE_NON_RECONNU' : 'NON_TROUVE'
  };
}

function isMesIdentityImmoMethod_(method) {
  return /^IMMO_(SOURCE|EQUIPEMENT|COMMENTAIRE)_(EXACT|CORRIGE)$/.test(clean_(method));
}

function isMissingMesImmo_(value) {
  return ['', 'NAN', 'N/A', 'NA', 'NON RENSEIGNE', 'NON RENSEIGNEE'].includes(normalizeHeader_(value));
}

function resolveCommentFamily_(tokens, master) {
  const owners = master.familyIdentityOwners || {};
  const matchedTokens = commentFamilyTokens_(tokens).filter(token => owners[token] && owners[token].length);
  if (!matchedTokens.length) return null;
  // Le jeton le plus long est le plus spécifique : « 208V3021 » l'emporte sur « V3021 », partagé par plusieurs familles.
  const longest = Math.max(...matchedTokens.map(token => token.length));
  const familyKeys = [...new Set(matchedTokens.filter(token => token.length === longest).flatMap(token => owners[token]))];
  const families = familyKeys.map(key => master.byFamilyKey[key]).filter(Boolean);
  if (!families.length) return null;
  const uniqueFamilies = [...new Map(families.map(data => [identityKey_(data.family), data])).values()];
  const data = uniqueFamilies.length === 1 ? uniqueFamilies[0] : null;
  const immos = data ? master.immosByFamilyKey[identityKey_(data.family)] || [] : [];
  return { data, immos, ambiguous: uniqueFamilies.length > 1 };
}

function commentFamilyTokens_(tokens) {
  const strong = tokens.filter(token => /[A-Z]/.test(token) && /\d/.test(token) && token.length >= 5 && !isProgramIdentityToken_(token));
  if (tokens.includes('UPA')) strong.push(...tokens.filter(token => /^\d{3}$/.test(token)));
  return [...new Set(strong)];
}

function isProgramIdentityToken_(token) {
  const normalized = identityKey_(token);
  return normalized.includes('A350')
    || normalized === 'TC'
    || normalized === 'STR'
    || /P\d{3}/.test(normalized);
}

function resolveCommentImmo_(tokens, master) {
  const numericTokens = [...new Set(tokens.filter(token => /^\d{7,8}$/.test(token)))];
  const exactMatches = sourceImmoMatchesInScope_(numericTokens, master);
  if (exactMatches.length === 1) return { immo: exactMatches[0], method: 'IMMO_COMMENTAIRE_EXACT' };
  if (exactMatches.length > 1 || numericTokens.length !== 1 || !/^\d{8}$/.test(numericTokens[0])) return null;

  const correctedMatches = new Set();
  numericTokens.filter(token => /^\d{8}$/.test(token)).forEach(token => {
    for (let index = 0; index < token.length; index += 1) {
      const candidate = token.slice(0, index) + token.slice(index + 1);
      sourceImmoMatchesInScope_([candidate], master).forEach(immo => correctedMatches.add(immo));
    }
  });
  if (correctedMatches.size !== 1) return null;
  return { immo: [...correctedMatches][0], method: 'IMMO_COMMENTAIRE_CORRIGE' };
}

function identityMatchesInScope_(tokens, master) {
  return [...new Set(tokens.flatMap(token => {
    const candidates = master.identityOwners && master.identityOwners[token]
      ? master.identityOwners[token]
      : master.byImmoKey[token] ? [master.byImmoKey[token]] : [];
    return candidates;
  }).filter(immo => {
    const data = immo ? master.byImmo[immo] : null;
    return data && isInScope_(data.section) && isDrillingMachine_(data);
  }))];
}

function sourceImmoMatchesInScope_(tokens, master) {
  return [...new Set(tokens.map(token => master.byImmoKey[token]).filter(immo => {
    const data = immo ? master.byImmo[immo] : null;
    return data && isInScope_(data.section) && isDrillingMachine_(data);
  }))];
}

function sourceEquipmentMatchesInScope_(tokens, master) {
  return [...new Set(tokens.map(token => master.byEquipmentKey && master.byEquipmentKey[token]).filter(immo => {
    const data = immo ? master.byImmo[immo] : null;
    return data && isInScope_(data.section) && isDrillingMachine_(data);
  }))];
}

function tokenizeComment_(value) {
  const tokens = clean_(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const compactTokens = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 2; length <= 4 && start + length <= tokens.length; length += 1) {
      compactTokens.push(tokens.slice(start, start + length).join(''));
    }
  }
  return [...new Set([...tokens, ...compactTokens])];
}

function identityVariants_(value) {
  const key = identityKey_(value);
  if (!key) return [];
  const variants = [key];
  const machineFamily = key.match(/^(\d{3}[A-Z]\d{1,2}\d{3})(?:[A-Z].*)?$/);
  if (machineFamily) variants.push(machineFamily[1]);
  const equipmentCode = key.match(/^[A-Z]{3}([A-Z]\d{1,2}\d{2,3})(?:[A-Z].*)?$/);
  if (equipmentCode) variants.push(equipmentCode[1]);
  const numericEquipmentCode = key.match(/^(?:[A-Z]{3}|\d{3})(V\d{1,2}\d{3})(?:[A-Z].*)?$/);
  if (numericEquipmentCode) {
    variants.push(numericEquipmentCode[1]);
    variants.push(numericEquipmentCode[1].slice(-3));
  }
  const versionedCode = key.match(/^([A-Z]{3})([A-Z])(\d{1,2})(\d{3})$/);
  if (versionedCode) {
    const prefix = versionedCode[1];
    const familyCode = versionedCode[2];
    const version = versionedCode[3];
    const number = versionedCode[4];
    const shortNumber = String(Number(number));
    variants.push(`${prefix}${familyCode}${version}${shortNumber}`);
    variants.push(`${prefix}${familyCode}${number}`);
    variants.push(`${familyCode}${version}${shortNumber}`);
    variants.push(`${familyCode}${number}`);
  }
  return [...new Set(variants)];
}

function resolveMasterFamily_(familyValue, master) {
  const explicitKey = identityKey_(familyValue);
  if (explicitKey && master.byFamilyKey[explicitKey]) return { data: master.byFamilyKey[explicitKey], method: 'FAMILLE_EXACTE' };
  const familyTokens = commentFamilyTokens_(tokenizeComment_(familyValue));
  const familyKeys = [...new Set(familyTokens.flatMap(token => master.familyIdentityOwners && master.familyIdentityOwners[token] || []))];
  if (familyKeys.length !== 1) return null;
  return { data: master.byFamilyKey[familyKeys[0]], method: 'FAMILLE_EXACTE' };
}

function identityKey_(value) {
  return normalizeHeader_(value);
}

function longestCommonSubstringLength_(left, right) {
  let best = 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        current[rightIndex] = previous[rightIndex - 1] + 1;
        best = Math.max(best, current[rightIndex]);
      }
    }
    previous = current;
  }
  return best;
}

function normalizeQlikProblem_(problem, isQlik) {
  const value = clean_(problem);
  return isQlik ? value.replace(/^UPA\s*MEDU\s*[·-]\s*/i, '') : value;
}

function parseDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 20000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  const text = clean_(value);
  if (!text) return null;
  const french = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (french) {
    const year = french[3].length === 2 ? 2000 + Number(french[3]) : Number(french[3]);
    return new Date(year, Number(french[2]) - 1, Number(french[1]));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

function dateKey_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function numberOr_(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(clean_(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function factQuantity_(row, index) {
  if (clean_(row[index.SOURCE]) === 'ALEA_MES') return 1;
  const rawQuantity = numberOr_(row[index.QUANTITE], 1);
  const declaredNc = index.NB_NC === undefined ? '' : row[index.NB_NC];
  return row[index.SOURCE] === 'NC' && declaredNc !== '' ? numberOr_(declaredNc, rawQuantity) : rawQuantity;
}

function rawMesQuantity_(row, index) {
  return Math.max(1, numberOr_(row[index.QUANTITE], 1));
}

function configuredCost_(parameters, source) {
  const key = source === 'NC' ? 'COUT_MOYEN_NC_EUR' : source === 'ALEA_MES' ? 'COUT_MOYEN_ALEA_MES_EUR' : 'COUT_MOYEN_ALEA_EUR';
  return clean_(parameters[key]) === '' ? null : numberOr_(parameters[key], null);
}

function resolveFactCost_(parameters, source, quantity, downtimeHours, immoCount) {
  const hourlyRate = clean_(parameters.COUT_HEURE_PERDUE_EUR) === ''
    ? null
    : numberOr_(parameters.COUT_HEURE_PERDUE_EUR, null);
  if (hourlyRate !== null) {
    const total = Math.max(0, downtimeHours) * hourlyRate;
    return { unit: quantity ? total / quantity : 0, total, known: true };
  }
  const unitCost = configuredCost_(parameters, source);
  const allocatedUnitCost = unitCost === null ? null : unitCost / Math.max(1, immoCount);
  return {
    unit: allocatedUnitCost,
    total: allocatedUnitCost === null ? null : allocatedUnitCost * quantity,
    known: allocatedUnitCost !== null
  };
}

function configuredWeight_(parameters, source) {
  const key = source === 'NC' ? 'POIDS_NC' : source === 'ALEA_MES' ? 'POIDS_ALEA_MES' : 'POIDS_ALEA';
  return numberOr_(parameters[key], source === 'NC' ? 5 : 1);
}

function digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .slice(0, 12)
    .map(byte => (byte + 256).toString(16).slice(-2))
    .join('');
}

function deduplicateFacts_(facts) {
  const byBusinessKey = new Map();
  const byNcNumber = new Map();
  facts.forEach(row => {
    const ncNumber = normalizeFactKey_(row[25]);
    const source = clean_(row[3]) || 'INCONNU';
    if (source === 'NC' && ncNumber) {
      const groupKey = `${source}:${ncNumber}`;
      const group = byNcNumber.get(groupKey) || [];
      group.push(row);
      byNcNumber.set(groupKey, group);
      return;
    }
    const businessKey = factBusinessKey_(row) || `ID:${clean_(row[0])}`;
    const existing = byBusinessKey.get(businessKey);
    byBusinessKey.set(businessKey, existing ? mergeFactRows_(existing, row) : row);
  });
  const deduplicated = [...byBusinessKey.values()];
  byNcNumber.forEach(rows => deduplicated.push(...consolidateNcFactGroup_(rows)));
  return deduplicated.sort((left, right) => {
    const leftTime = left[1] instanceof Date ? left[1].getTime() : 0;
    const rightTime = right[1] instanceof Date ? right[1].getTime() : 0;
    return rightTime - leftTime;
  });
}

function consolidateNcFactGroup_(rows) {
  const immos = [...new Set(rows.flatMap(row => splitImmos_(row[4]).filter(Boolean)))];
  const mergedAll = rows.reduce((current, row) => current ? mergeFactRows_(current, row) : row, null);
  if (!immos.length || immos.length === 1) return [mergedAll];
  const quantityTotal = factGroupTotal_(rows, 13);
  const hasNcCount = rows.some(row => clean_(row[26]) !== '');
  const ncCountTotal = hasNcCount ? factGroupTotal_(rows, 26) : 0;
  const downtimeTotal = factGroupTotal_(rows, 21);
  const costTotal = factGroupTotal_(rows, 15);
  const allocationCount = immos.length;
  return immos.map(immo => {
    const matchingRows = rows.filter(row => splitImmos_(row[4]).filter(Boolean).includes(immo));
    const primary = (matchingRows.length ? matchingRows : rows)
      .reduce((current, row) => current ? mergeFactRows_(current, row) : row, null);
    const merged = mergeFactRows_(primary, mergedAll);
    merged[0] = primary[0];
    merged[4] = immo;
    merged[13] = quantityTotal / allocationCount;
    if (hasNcCount) merged[26] = ncCountTotal / allocationCount;
    merged[21] = downtimeTotal / allocationCount;
    if (merged[16] === true || String(merged[16]).toUpperCase() === 'OUI') {
      merged[15] = costTotal / allocationCount;
      merged[14] = merged[13] ? merged[15] / merged[13] : merged[14];
    }
    return merged;
  });
}

function factGroupTotal_(rows, index) {
  const totalsByEvent = new Map();
  rows.forEach((row, rowIndex) => {
    const eventId = clean_(row[0]).replace(/-[0-9a-f]{8}$/i, '') || `ROW:${rowIndex}`;
    totalsByEvent.set(eventId, (totalsByEvent.get(eventId) || 0) + numberOr_(row[index], 0));
  });
  const totals = [...totalsByEvent.values()];
  return totals.length ? Math.max(...totals) : 0;
}

function factBusinessKey_(row) {
  const source = clean_(row[3]) || 'INCONNU';
  const eventId = clean_(row[0]);
  if (eventId) return `ID:${source}:${eventId}`;
  const ncNumber = normalizeFactKey_(row[25]);
  if (source === 'NC' && ncNumber) return `NC:${ncNumber}`;
  const date = parseDate_(row[1]);
  const immo = normalizeFactKey_(row[4]);
  const comment = normalizeFactKey_(row[24]);
  return date && immo && comment ? `EVENT:${source}|${dateKey_(date)}|${immo}|${comment}` : '';
}

function normalizeFactKey_(value) {
  return normalizeHeader_(clean_(value));
}

function factSourcePriority_(source) {
  return { NC: 3, ALEA: 2, ALEA_MES: 1 }[clean_(source)] || 0;
}

function factRowPriority_(row) {
  return factSourcePriority_(row[3]) + (clean_(row[22]) ? 1 : 0);
}

function mergeFactRows_(current, incoming) {
  const currentFirst = factRowPriority_(current) >= factRowPriority_(incoming);
  const primary = currentFirst ? current : incoming;
  const secondary = currentFirst ? incoming : current;
  const merged = primary.slice();
  secondary.forEach((value, index) => {
    if (clean_(merged[index]) === '' && clean_(value) !== '') merged[index] = value;
  });
  [19, 22].forEach(index => {
    merged[index] = [...new Set([clean_(current[index]), clean_(incoming[index])].filter(Boolean))].join(' + ');
  });
  return merged;
}

function collectFilterOptions_(rows, index) {
  const unique = column => [...new Set(rows.map(row => clean_(row[index[column]])).filter(Boolean))].sort();
  return { families: unique('FAMILLE'), sources: unique('SOURCE'), stations: stationFilterOptions_(), msns: unique('MSN'), immos: unique('IMMO').filter(isPlausibleImmo_) };
}

// Filtre Famille / IMMO / MSN : une liste (listes déroulantes) sélectionne des valeurs exactes ;
// un texte seul (ancien champ de recherche) garde la correspondance partielle si partialText.
function filterValuesMatch_(actualValues, requested, partialText) {
  const actualKeys = (actualValues || []).map(value => normalizeHeader_(value)).filter(Boolean);
  if (Array.isArray(requested)) {
    const requestedKeys = requested.map(value => normalizeHeader_(value)).filter(Boolean);
    return !requestedKeys.length || requestedKeys.some(key => actualKeys.includes(key));
  }
  const requestedKey = normalizeHeader_(requested);
  if (!requestedKey) return true;
  return actualKeys.some(key => partialText ? key.includes(requestedKey) : key === requestedKey);
}

function matchesFilters_(row, index, filters) {
  if (!filterValuesMatch_([row[index.FAMILLE]], filters.family, true)) return false;
  if (filters.source && row[index.SOURCE] !== filters.source) return false;
  if (filters.site && row[index.SITE] !== filters.site) return false;
  if (filters.section && row[index.SECTION] !== filters.section) return false;
  if (!filterValuesMatch_([row[index.IMMO]], filters.immo, true)) return false;
  if (!stationMatchesFilter_(row[index.POSTE], filters.station)) return false;
  if (!filterValuesMatch_([row[index.MSN]], filters.msn, false)) return false;
  if (filters.category && !normalizeHeader_(row[index.CATEGORIE]).includes(normalizeHeader_(filters.category))) return false;
  const date = parseDate_(row[index.DATE]);
  if (filters.from && (!date || date < parseFilterDate_(filters.from, false))) return false;
  if (filters.to && (!date || date > parseFilterDate_(filters.to, true))) return false;
  return true;
}

function parseFilterDate_(value, endOfDay) {
  const parts = clean_(value).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
}

function weekKey_(value) {
  const date = parseDate_(value);
  if (!date) return 'Date inconnue';
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function missingFamilyLabel_() {
  return 'Famille non renseignée';
}

function median_(values) {
  const sorted = (values || []).filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildTrendQuality_(trendRows, diagnostic) {
  const rawMesRows = diagnostic && diagnostic.byWeek
    ? diagnostic.byWeek
      .map(row => ({ week: row.label, value: numberOr_(row.quantity, 0) }))
      .filter(row => row.value > 0)
    : [];
  const mesRows = (rawMesRows.length ? rawMesRows : (trendRows || [])
    .map(row => ({ week: row[0], value: numberOr_(row[3], 0) })))
    .filter(row => row.value > 0);
  if (!mesRows.length) return { mes: { peak: null, baseline: 0, threshold: 0, alerts: [], diagnostic: diagnostic || null, rawQuantity: false } };
  const baseline = median_(mesRows.map(row => row.value));
  const threshold = Math.max(100, baseline * 3);
  const peak = mesRows.slice().sort((left, right) => right.value - left.value)[0];
  const alerts = mesRows
    .filter(row => row.value >= threshold && (row.value - baseline >= 10 || row.value >= 100))
    .map(row => ({ week: row.week, value: row.value, ratio: baseline ? Math.round(row.value * 10 / baseline) / 10 : null }));
  return { mes: { peak, baseline, threshold, alerts, diagnostic: diagnostic || null, rawQuantity: rawMesRows.length > 0 } };
}

function mesPeakDiagnosticGroups_(entries, property, fallback) {
  const groups = {};
  (entries || []).forEach(entry => {
    const label = clean_(entry[property]) || fallback;
    if (!groups[label]) groups[label] = { label, rows: 0, quantity: 0 };
    groups[label].rows += 1;
    groups[label].quantity += entry.quantity;
  });
  return Object.values(groups)
    .sort((left, right) => right.quantity - left.quantity || right.rows - left.rows || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function findMesStagingRowForFact_(factId, stagingRows) {
  const normalizedFactId = clean_(factId).replace(/^ALEA_MES-/, '');
  if (!normalizedFactId) return {};
  const exact = (stagingRows || []).find(row => {
    const source = clean_(row.SOURCE);
    const stagingId = clean_(row.ID_EVENEMENT);
    return (!source || source === 'ALEA_MES') && stagingId && normalizedFactId === stagingId;
  });
  if (exact) return exact;
  return (stagingRows || []).find(row => {
    const source = clean_(row.SOURCE);
    const stagingId = clean_(row.ID_EVENEMENT);
    const suffix = stagingId ? normalizedFactId.slice(stagingId.length + 1) : '';
    return (!source || source === 'ALEA_MES') && stagingId
      && normalizedFactId.startsWith(`${stagingId}-`) && /^[0-9a-f]{8}$/i.test(suffix);
  }) || {};
}

function buildMesPeakDiagnostics_(rows, index, stagingRows) {
  const entries = (rows || [])
    .filter(row => clean_(row[index.SOURCE]) === 'ALEA_MES')
    .map(row => {
      const staging = findMesStagingRowForFact_(row[index.ID_EVENEMENT], stagingRows);
      return {
        file: clean_(row[index.FICHIER_SOURCE]) || clean_(staging.FICHIER_NOM),
        fileId: clean_(staging.FICHIER_ID),
        eventId: clean_(row[index.ID_EVENEMENT]) || clean_(staging.ID_EVENEMENT),
        week: weekKey_(row[index.DATE]),
        quantity: rawMesQuantity_(row, index),
        immo: clean_(row[index.IMMO]) || clean_(staging.IMMO),
        family: clean_(row[index.FAMILLE]) || clean_(staging.FAMILLE),
        method: clean_(row[index.RAPPROCHEMENT_MES]) || clean_(staging.METHODE_RAPPROCHEMENT)
      };
    });
  const byWeek = mesPeakDiagnosticGroups_(entries, 'week', 'Semaine inconnue');
  const peak = byWeek[0] || null;
  const peakEntries = peak ? entries.filter(entry => entry.week === peak.label) : [];
  return {
    peak: peak ? { week: peak.label, rows: peak.rows, quantity: peak.quantity } : null,
    byWeek,
    byFile: mesPeakDiagnosticGroups_(peakEntries, 'file', 'Fichier non renseigné'),
    byFileId: mesPeakDiagnosticGroups_(peakEntries, 'fileId', 'ID fichier non renseigné'),
    byEvent: mesPeakDiagnosticGroups_(peakEntries, 'eventId', 'Événement non renseigné'),
    byImmo: mesPeakDiagnosticGroups_(peakEntries, 'immo', 'IMMO non renseigné'),
    byFamily: mesPeakDiagnosticGroups_(peakEntries, 'family', missingFamilyLabel_()),
    byMethod: mesPeakDiagnosticGroups_(peakEntries, 'method', 'Méthode non renseignée'),
    records: peakEntries.slice(0, 200),
    recordCount: peakEntries.length
  };
}

function addAggregate_(target, label, source, quantity, score, downtime) {
  if (!target[label]) target[label] = { label, ALEA: 0, NC: 0, ALEA_MES: 0, total: 0, score: 0, downtime: 0 };
  target[label][source] = (target[label][source] || 0) + quantity;
  target[label].total += quantity;
  target[label].score += score;
  target[label].downtime += numberOr_(downtime, 0);
}

function withDirectNcReviewCosts_(data, filters) {
  if (!data || data.empty || !data.review || !data.review.costs) return data;
  try {
    const direct = readDirectNcCostAggregates_(filters);
    if (!direct.available) return data;
    const costs = data.review.costs;
    const mesFamilies = costs.mesFamilyTotals || costs.mesFamilies || [];
    const mesMachines = costs.mesMachineTotals || costs.unavailableMachines || [];
    const combinedFamilies = mergeCostRows_(direct.families, mesFamilies);
    const combinedMachines = mergeCostRows_(direct.machines, mesMachines);
    const review = Object.assign({}, data.review, {
      directNc: { available: true, refreshedAt: direct.refreshedAt },
      costs: Object.assign({}, costs, {
        ncFamilies: topCostRows_(direct.families, 12),
        ncMachines: topCostRows_(direct.machines, 12),
        combinedFamilies: topCostRows_(combinedFamilies, 12),
        combinedFamilyTotals: combinedFamilies,
        combinedMachines: topCostRows_(combinedMachines, 12)
      })
    });
    return Object.assign({}, data, { review });
  } catch (error) {
    return Object.assign({}, data, { review: Object.assign({}, data.review, {
      directNc: { available: false, error: error.message || String(error) }
    }) });
  }
}

function readDirectNcCostAggregates_(filters) {
  if (filters && filters.source && filters.source !== 'NC') return { available: true, families: [], machines: [], refreshedAt: '' };
  const parameters = getParameters_();
  const spreadsheetId = clean_(parameters.ID_FICHIER_NC);
  if (!spreadsheetId) return { available: false, families: [], machines: [], refreshedAt: '' };
  const cache = typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null;
  const cacheKey = `tc-direct-nc-${digest_(`${spreadsheetId}|${stableStringify_(filters || {})}`)}`;
  const cached = cache ? readJsonCache_(cache, cacheKey, 'coûts NC directs') : null;
  if (cached) return cached;
  const masterRows = readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master);
  const master = enrichMasterWithDocMartin_(buildMasterIndex_(masterRows), readDocMartinEquipmentRecords_(parameters));
  const records = readRecords_(spreadsheetId, APP.sourceSheets.nc);
  const facts = [];
  appendFacts_(facts, records, 'NC', APP.aliases.nc, master, parameters, APP.sourceSheets.nc);
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const requested = Object.assign({}, filters || {}, { source: 'NC' });
  const families = {};
  const machines = {};
  facts.filter(row => matchesFilters_(row, index, requested)).forEach(row => {
    const quantity = factQuantity_(row, index);
    const cost = quantity * 300;
    const family = clean_(row[index.FAMILLE]);
    const immo = clean_(row[index.IMMO]);
    if (isUsableCostFamily_(family)) addCostAggregate_(families, family, cost, 'NC');
    if (immo) addCostAggregate_(machines, immo, cost, 'NC', family);
  });
  const result = { available: true, families: Object.values(families), machines: Object.values(machines), refreshedAt: new Date().toISOString() };
  if (cache) writeJsonCache_(cache, cacheKey, result, 60, 'coûts NC directs');
  return result;
}

function mergeCostRows_(leftRows, rightRows) {
  const merged = {};
  [...(leftRows || []), ...(rightRows || [])].forEach(row => {
    if (!row || !row.label) return;
    const target = merged[row.label] || (merged[row.label] = { label: row.label, family: row.family || '', NC: 0, ALEA_MES: 0, cost: 0 });
    if (!target.family && row.family) target.family = row.family;
    target.NC += numberOr_(row.NC, 0);
    target.ALEA_MES += numberOr_(row.ALEA_MES, 0);
    target.cost += numberOr_(row.cost, 0);
  });
  return Object.values(merged);
}

function topCostRows_(rows, limit) {
  return (rows || []).slice().sort((left, right) => right.cost - left.cost || String(left.label).localeCompare(String(right.label))).slice(0, limit);
}

function addAvailabilityAggregate_(target, family, problem, source, quantity, score, downtime) {
  if (!clean_(family) || !isAvailabilityMesProblem_(problem)) return;
  const label = family;
  addAggregate_(target, label, source, quantity, score, downtime);
  target[label].family = family;
  target[label].problems = [...new Set([...(target[label].problems || []), clean_(problem) || 'Non renseigné'])];
}

function isAvailabilityMesProblem_(problem) {
  return clean_(problem) === '0911 Manquant Absent Non Disponible';
}

function withReviewActionPlanCoverage_(data) {
  if (!data || data.empty || !data.review || !data.review.costs) return data;
  const coverage = readActionPlanCoverage_();
  const costs = data.review.costs;
  const actionPlanCostQuality = buildActionPlanCostQuality_(
    costs.combinedFamilyTotals || [],
    coverage,
    Array.isArray(costs.combinedFamilyTotals)
  );
  const review = Object.assign({}, data.review, {
    actionPlanCoverage: {
      available: coverage.available,
      complete: coverage.complete,
      sourcesRead: coverage.sourcesRead,
      sourceCount: coverage.sourceCount,
      errors: coverage.errors,
      summary: coverage.summary || null,
      recentMonths: coverage.recentMonths || ACTION_PLAN_RECENT_MONTHS,
      referenceDate: coverage.referenceDate || ''
    },
    actionPlanCostQuality,
    costs: Object.assign({}, costs, {
      ncFamilies: annotateActionPlanRows_(costs.ncFamilies, 'family', coverage),
      mesFamilies: annotateActionPlanRows_(costs.mesFamilies, 'family', coverage),
      combinedFamilies: annotateActionPlanRows_(costs.combinedFamilies, 'family', coverage),
      ncMachines: annotateActionPlanRows_(costs.ncMachines, 'immo', coverage),
      unavailableMachines: annotateActionPlanRows_(costs.unavailableMachines, 'immo', coverage),
      combinedMachines: annotateActionPlanRows_(costs.combinedMachines, 'immo', coverage)
    })
  });
  return Object.assign({}, data, { review });
}

function readActionPlanCoverage_() {
  let parameters = {};
  try {
    parameters = getParameters_();
  } catch (error) {
    parameters = {};
  }
  const sources = [
    {
      label: 'MFT TC 370',
      id: clean_(parameters.ID_FICHIER_PLAN_ACTIONS_TC_370) || APP.parameterDefaults.ID_FICHIER_PLAN_ACTIONS_TC_370
    },
    {
      label: 'MFT TC 355/360/OSW',
      id: clean_(parameters.ID_FICHIER_PLAN_ACTIONS_TC_355_360_OSW) || APP.parameterDefaults.ID_FICHIER_PLAN_ACTIONS_TC_355_360_OSW
    }
  ].filter(source => clean_(source.id));
  const unavailable = {
    available: false,
    complete: false,
    sourcesRead: 0,
    sourceCount: sources.length,
    immos: {},
    families: {},
    unknownImmos: {},
    unknownFamilies: {},
    errors: sources.length ? [] : ['Aucun plan d’action TC configuré.']
  };
  if (!sources.length) return unavailable;

  const cache = typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null;
  const cacheKey = `tc-action-coverage-v3-${digest_(sources.map(source => source.id).join('|'))}`;
  const cached = cache ? readJsonCache_(cache, cacheKey, 'suivi des plans TC') : null;
  if (cached) return cached;

  const master = loadMasterForMftMigration_();
  const actions = [];
  const errors = [];
  let sourcesRead = 0;
  sources.forEach(source => {
    try {
      const spreadsheet = openSourceSpreadsheetWithRetry_(source.id);
      const sourceActions = readTcActionPlanActions_(spreadsheet, master);
      if (!sourceActions.length) throw new Error('Aucune action MFT exploitable dans le dernier onglet daté.');
      if (!sourceActions.some(item => clean_(item.immo) || clean_(item.family))) {
        throw new Error('Aucun IMMO ou famille rapproché dans le plan.');
      }
      actions.push(...sourceActions);
      sourcesRead += 1;
    } catch (error) {
      errors.push(`${source.label} : ${error.message || String(error)}`);
    }
  });

  const coverage = Object.assign(actionPlanCoverageFromActions_(actions), {
    available: sourcesRead > 0,
    complete: sourcesRead === sources.length,
    sourcesRead,
    sourceCount: sources.length,
    errors
  });
  if (cache) writeJsonCache_(cache, cacheKey, coverage, 60, 'suivi des plans TC');
  return coverage;
}

function readTcActionPlanActions_(spreadsheet, master) {
  const snapshots = listTcActionPlanSheets_(spreadsheet);
  if (snapshots.length) return readActionPlanSnapshots_(snapshots, master);
  const official = spreadsheet.getSheetByName(APP.sheets.mftOfficialActions);
  if (!official || official.getLastRow() < 2) return [];
  return readSheetObjects_(official).map(item => ({
    immo: clean_(item.IMMO),
    family: clean_(item.FAMILLE),
    action: clean_(item.ACTION_DECIDEE),
    status: normalizeMftStatus_(item.STATUT),
    closedAt: actionPlanIsoDate_(item.DATE_CLOTURE || (normalizeMftStatus_(item.STATUT) === 'Fait' ? item.DATE_DERNIERE_MAJ : ''))
  })).filter(item => item.action && (item.immo || item.family));
}

function findLatestTcActionPlanSheet_(spreadsheet) {
  return listTcActionPlanSheets_(spreadsheet)[0] || null;
}

function listTcActionPlanSheets_(spreadsheet) {
  const datePattern = /(\d{2})[ _./-]?(\d{2})[ _./-]?(\d{4})/;
  const candidates = spreadsheet.getSheets().map(sheet => {
    const name = sheet.getName();
    const normalized = normalizeHeader_(name);
    if (!normalized.includes('MFT') || !normalized.includes('MACHINES') || !/ALEAS|ALEA/.test(normalized)) return null;
    const match = name.match(datePattern);
    if (!match) return null;
    const meetingDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (Number.isNaN(meetingDate.getTime())) return null;
    return { sheet, name, meetingDate };
  }).filter(Boolean);
  candidates.sort((left, right) => right.meetingDate.getTime() - left.meetingDate.getTime());
  return candidates;
}

// Légende de l'item 2 (revue Pilotage). Une barre n'apparaît que si la machine a des coûts sur la période :
// - EN_COURS          (bleu)          : au moins une action ouverte / en cours sur l'IMMO ou la famille ;
// - TERMINEE_RECENTE  (vert)          : action clôturée et prise en compte dans les 6 derniers mois ;
// - CLOTUREE_ANCIENNE (orange pastel) : action clôturée depuis plus de 6 mois et le problème revient ;
// - NON_TRAITEE       (rouge)         : aucune action, ou action seulement reportée / abandonnée ;
// - INCONNU           (gris)          : plan illisible ou incomplet.
const ACTION_PLAN_RECENT_MONTHS = 6;
const ACTION_PLAN_TONE_RANK = Object.freeze({ EN_COURS: 4, TERMINEE_RECENTE: 3, CLOTUREE_ANCIENNE: 2, NON_TRAITEE: 1 });

function actionPlanCoverageFromActions_(actions, referenceDate) {
  const coverage = {
    immos: {}, families: {}, unknownImmos: {}, unknownFamilies: {},
    summary: { actions: 0, EN_COURS: 0, TERMINEE_RECENTE: 0, CLOTUREE_ANCIENNE: 0, NON_TRAITEE: 0, INCONNU: 0 },
    recentMonths: ACTION_PLAN_RECENT_MONTHS,
    referenceDate: toIsoDate_(referenceDate || new Date())
  };
  const recentLimit = actionPlanRecentLimit_(referenceDate);
  const keep = (target, key, tone) => {
    if (!target[key] || ACTION_PLAN_TONE_RANK[tone] > ACTION_PLAN_TONE_RANK[target[key]]) target[key] = tone;
  };
  (actions || []).forEach(action => {
    const tone = actionPlanToneForAction_(action, recentLimit);
    coverage.summary.actions += 1;
    coverage.summary[tone] += 1;
    const immoTarget = tone === 'INCONNU' ? coverage.unknownImmos : coverage.immos;
    const familyTarget = tone === 'INCONNU' ? coverage.unknownFamilies : coverage.families;
    actionPlanCoverageTokens_(action.immo, /[;,/|\n]+/).forEach(key => {
      if (tone === 'INCONNU') immoTarget[key] = true; else keep(immoTarget, key, tone);
    });
    actionPlanCoverageTokens_(action.family, /[;|\n]+/).forEach(key => {
      if (tone === 'INCONNU') familyTarget[key] = true; else keep(familyTarget, key, tone);
    });
  });
  return coverage;
}

function actionPlanRecentLimit_(referenceDate) {
  const reference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  return new Date(reference.getFullYear(), reference.getMonth() - ACTION_PLAN_RECENT_MONTHS, reference.getDate());
}

function actionPlanToneForAction_(action, recentLimit) {
  const status = actionPlanStatusFromValue_(action.status);
  if (status === 'OPEN') return 'EN_COURS';
  if (status === 'DONE') {
    const closedAt = parseDate_(action.closedAt);
    return closedAt && closedAt >= recentLimit ? 'TERMINEE_RECENTE' : 'CLOTUREE_ANCIENNE';
  }
  if (status === 'DROPPED') return 'NON_TRAITEE';
  return 'INCONNU';
}

function actionPlanStatusFromValue_(value) {
  const status = normalizeHeader_(value);
  if (['ENCOURS', 'ENRETARD', 'OPEN', 'DUE', 'OUVERT', 'OUVERTE', 'NOUVEAU', 'NOUVELLE', 'AFAIRE'].includes(status)) return 'OPEN';
  if (['FAIT', 'DONE', 'CLOTURE', 'CLOTUREE', 'TERMINE', 'TERMINEE', 'SOLDE', 'SOLDEE'].includes(status)) return 'DONE';
  if (['REPORTE', 'REPORTEE', 'DEFERRED', 'ABANDONNE', 'ABANDONNEE', 'ANNULE', 'ANNULEE', 'REJETE', 'REJETEE', 'SUPPRIME', 'SUPPRIMEE'].includes(status)) return 'DROPPED';
  return 'UNKNOWN';
}

// Lit les onglets datés utiles (6 derniers mois + l'onglet de référence précédent) et
// reconstitue l'historique de chaque action pour dater sa clôture.
function readActionPlanSnapshots_(snapshots, master, referenceDate) {
  const selected = selectActionPlanSnapshots_(snapshots, referenceDate);
  const parsed = selected.map(snapshot => ({
    meetingDate: snapshot.meetingDate,
    rows: readActionPlanSnapshotRows_(snapshot.sheet)
  }));
  return buildActionPlanTimeline_(parsed).map(action => {
    const identity = resolveLegacyMftIdentity_(action.issue, master);
    return {
      ref: action.ref,
      immo: identity.immo,
      family: identity.famille,
      action: action.decision,
      status: action.status,
      closedAt: action.closedAt ? toIsoDate_(action.closedAt) : ''
    };
  }).filter(item => item.action && (item.immo || item.family));
}

function selectActionPlanSnapshots_(snapshots, referenceDate) {
  const ordered = (snapshots || []).filter(snapshot => snapshot && snapshot.meetingDate)
    .slice().sort((left, right) => left.meetingDate.getTime() - right.meetingDate.getTime());
  const recentLimit = actionPlanRecentLimit_(referenceDate);
  const firstRecent = ordered.findIndex(snapshot => snapshot.meetingDate >= recentLimit);
  if (firstRecent < 0) return ordered.slice(-1);
  // L'onglet juste avant la fenêtre suffit à savoir si une action était déjà close avant.
  return ordered.slice(Math.max(0, firstRecent - 1));
}

function readActionPlanSnapshotRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headerRow = findMftHeaderRow_(values);
  if (headerRow < 0) return [];
  const columns = mapMftColumns_(values[headerRow]);
  return actionPlanRowsFromValues_(values.slice(headerRow + 1), columns);
}

function actionPlanRowsFromValues_(rows, columns) {
  const cell = (row, column) => column >= 0 ? row[column] : '';
  return (rows || []).map(row => ({
    ref: clean_(cell(row, columns.ref)).replace(/\.0+$/, ''),
    issue: clean_(cell(row, columns.issue)),
    decision: clean_(cell(row, columns.action)),
    status: normalizeMftStatus_(cell(row, columns.status)),
    due: cell(row, columns.due),
    comment: clean_(cell(row, columns.comment))
  })).filter(row => row.ref || row.issue || row.decision);
}

// snapshots : [{ meetingDate, rows: [{ ref, issue, decision, status, due, comment }] }].
// La date de clôture est celle de la première réunion où l'action passe à « Fait ».
// Une action déjà « Fait » dans le premier onglet lu est datée par son commentaire,
// puis par son échéance, sans dépasser cette réunion.
function buildActionPlanTimeline_(snapshots) {
  const ordered = (snapshots || []).filter(snapshot => snapshot && snapshot.meetingDate)
    .slice().sort((left, right) => left.meetingDate.getTime() - right.meetingDate.getTime());
  const entries = new Map();
  ordered.forEach((snapshot, position) => {
    (snapshot.rows || []).forEach(row => {
      const key = row.ref ? `REF-${normalizeHeader_(row.ref)}` : `TXT-${normalizeHeader_(`${row.issue}|${row.decision}`)}`;
      const entry = entries.get(key) || { firstSeen: position, seenOpen: false, doneSince: null, doneRow: null, lastSeen: position, row };
      if (row.status === 'Fait') {
        if (!entry.doneSince) {
          entry.doneSince = snapshot.meetingDate;
          entry.doneRow = row;
        }
      } else {
        entry.doneSince = null;
        entry.doneRow = null;
        if (row.status === 'En cours') entry.seenOpen = true;
      }
      entry.row = row;
      entry.lastSeen = position;
      entries.set(key, entry);
    });
  });
  const lastPosition = ordered.length - 1;
  return [...entries.values()].map(entry => {
    let status = entry.row.status;
    let closedAt = null;
    if (entry.lastSeen < lastPosition && status === 'En cours') {
      // Action ouverte retirée du plan : considérée close à la réunion suivante.
      status = 'Fait';
      closedAt = ordered[entry.lastSeen + 1].meetingDate;
    } else if (status === 'Fait') {
      closedAt = entry.seenOpen || entry.firstSeen > 0
        ? entry.doneSince
        : estimateActionPlanClosure_(entry.doneRow || entry.row, entry.doneSince);
    }
    return Object.assign({}, entry.row, { status, closedAt });
  });
}

function estimateActionPlanClosure_(row, upperBound) {
  const limit = upperBound ? upperBound.getTime() : Infinity;
  const commentDates = [...clean_(row.comment).matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/g)]
    .map(match => {
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
      return date.getMonth() === Number(match[2]) - 1 ? date : null;
    })
    .filter(date => date && date.getTime() <= limit);
  if (commentDates.length) return new Date(Math.max(...commentDates.map(date => date.getTime())));
  const due = row.due instanceof Date ? row.due : null;
  if (due && !Number.isNaN(due.getTime()) && due.getTime() <= limit) return due;
  return null;
}

function actionPlanIsoDate_(value) {
  const date = parseDate_(value);
  return date ? toIsoDate_(date) : '';
}

function actionPlanCoverageTokens_(value, separator) {
  return clean_(value).split(separator)
    .map(token => normalizeHeader_(token.replace(/\.0+$/, '')))
    .filter(Boolean);
}

function actionPlanStatusForKey_(label, dimension, coverage) {
  const identities = (dimension === 'immo' ? coverage.immos : coverage.families) || {};
  const unknownIdentities = (dimension === 'immo' ? coverage.unknownImmos : coverage.unknownFamilies) || {};
  const key = normalizeHeader_(clean_(label).replace(/\.0+$/, ''));
  if (identities[key] === 'EN_COURS' || identities[key] === 'TERMINEE_RECENTE') return identities[key];
  if (unknownIdentities[key]) return 'INCONNU';
  if (identities[key]) return identities[key];
  return coverage.complete ? 'NON_TRAITEE' : 'INCONNU';
}

function buildActionPlanCostQuality_(rows, coverage, hasCompleteTotals) {
  const quality = {
    status: 'INCONNU',
    available: Boolean(coverage && coverage.available),
    complete: Boolean(coverage && coverage.complete && hasCompleteTotals),
    sourceCount: coverage ? coverage.sourceCount : 0,
    sourcesRead: coverage ? coverage.sourcesRead : 0,
    totalCost: 0,
    classifiedCost: 0,
    treatedCost: 0,
    inProgressCost: 0,
    recentlyClosedCost: 0,
    recurringCost: 0,
    noActionCost: 0,
    untreatedCost: 0,
    unknownCost: 0,
    untreatedPercentage: null,
    treatedPercentage: null,
    unknownPercentage: null
  };
  if (!quality.complete) return quality;

  (rows || []).forEach(row => {
    const cost = numberOr_(row.cost, 0);
    if (cost <= 0) return;
    quality.totalCost += cost;
    const status = actionPlanStatusForKey_(row.label, 'family', coverage);
    if (status === 'EN_COURS') quality.inProgressCost += cost;
    else if (status === 'TERMINEE_RECENTE') quality.recentlyClosedCost += cost;
    else if (status === 'CLOTUREE_ANCIENNE') quality.recurringCost += cost;
    else if (status === 'NON_TRAITEE') quality.noActionCost += cost;
    else quality.unknownCost += cost;
  });
  quality.treatedCost = quality.inProgressCost + quality.recentlyClosedCost;
  quality.untreatedCost = quality.recurringCost + quality.noActionCost;
  quality.classifiedCost = quality.treatedCost + quality.untreatedCost;
  quality.untreatedPercentage = quality.classifiedCost
    ? quality.untreatedCost * 100 / quality.classifiedCost
    : null;
  quality.treatedPercentage = quality.classifiedCost
    ? quality.treatedCost * 100 / quality.classifiedCost
    : null;
  quality.unknownPercentage = quality.totalCost
    ? quality.unknownCost * 100 / quality.totalCost
    : null;
  quality.status = quality.classifiedCost ? 'CALCULABLE' : 'VIDE';
  return quality;
}

function annotateActionPlanRows_(rows, dimension, coverage) {
  return (rows || []).map(row => Object.assign({}, row, {
    actionPlanStatus: actionPlanStatusForKey_(row.label, dimension, coverage)
  }));
}

function isUsableCostFamily_(label) {
  const normalized = normalizeHeader_(label);
  return Boolean(normalized) && !['FAMILLENONRENSEIGNEE', 'FAMILLEINCONNUE', 'NONRENSEIGNE', 'NONRENSEIGNEE', 'SANSFAMILLE'].includes(normalized);
}

function addCostAggregate_(target, label, cost, source, family) {
  if (!target[label]) target[label] = { label, family: '', NC: 0, ALEA_MES: 0, cost: 0 };
  if (!target[label].family && isUsableCostFamily_(family)) target[label].family = clean_(family);
  const amount = numberOr_(cost, 0);
  target[label][source] = (target[label][source] || 0) + amount;
  target[label].cost += amount;
}

function addMesFamilyCostAggregate_(target, family, cost, source) {
  if (!isUsableCostFamily_(family)) return;
  addCostAggregate_(target, family, cost, source);
}

function topCostAggregates_(values, limit) {
  return Object.values(values)
    .sort((left, right) => right.cost - left.cost || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function emptyQualityCounter_() {
  return { total: 0, identified: 0, masterMatched: 0, familyMatched: 0, commentsPresent: 0, downtimePresent: 0 };
}

function createQualityCounters_() {
  return { ALEA: emptyQualityCounter_(), NC: emptyQualityCounter_(), ALEA_MES: emptyQualityCounter_() };
}

function qualityPercentage_(numerator, denominator) {
  return denominator ? Math.round(numerator * 1000 / denominator) / 10 : 0;
}

function buildQualityAudit_(qualityBySource, mesMatchMethods) {
  const labels = { ALEA: 'Aléas production', NC: 'Non-conformités', ALEA_MES: 'Aléas MES' };
  const sources = ['ALEA', 'NC', 'ALEA_MES'].map(code => {
    const counters = qualityBySource[code] || emptyQualityCounter_();
    return {
      code,
      label: labels[code],
      ...counters,
      identifiedCoverage: qualityPercentage_(counters.identified, counters.total),
      masterCoverage: qualityPercentage_(counters.masterMatched, counters.total),
      familyCoverage: qualityPercentage_(counters.familyMatched, counters.total),
      commentCoverage: qualityPercentage_(counters.commentsPresent, counters.total),
      downtimeCoverage: qualityPercentage_(counters.downtimePresent, counters.total)
    };
  });
  const mes = sources.find(item => item.code === 'ALEA_MES') || { total: 0 };
  return {
    sources,
    mes: {
      total: mes.total,
      commentsPresent: mes.commentsPresent || 0,
      identified: mes.identified || 0,
      masterMatched: mes.masterMatched || 0,
      familyMatched: mes.familyMatched || 0,
      downtimePresent: mes.downtimePresent || 0,
      methods: Object.entries(mesMatchMethods)
        .map(([method, count]) => ({ method, count }))
        .sort((left, right) => right.count - left.count)
    }
  };
}

function buildDashboardDefinitions_(impactWeights) {
  const weights = {};
  ['ALEA', 'NC', 'ALEA_MES'].forEach(source => {
    const configured = Object.keys((impactWeights && impactWeights[source]) || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    weights[source] = configured.length ? configured : [source === 'NC' ? 5 : 1];
  });
  const weightText = source => weights[source].join('/');
  return {
    weights,
    impactFormula: `Production × ${weightText('ALEA')} + NC × ${weightText('NC')} + MES × ${weightText('ALEA_MES')}`,
    impactIndex: `Somme des quantités × poids source : aléa production × ${weightText('ALEA')}, NC × ${weightText('NC')}, MES × ${weightText('ALEA_MES')}. Ce sont des points de priorité, pas des euros ni un pourcentage.`,
    masterCoverage: 'Impacts dont l’IMMO est présent dans BDD_Master_amélio ÷ tous les impacts de la période filtrée. Pour MES, l’ID équipement est d’abord rapproché de la colonne Equipement du master pour retrouver l’IMMO et la famille ; le commentaire initial reste le fallback pour les lignes sans ID exploitable.',
    drillingRate: 'Nombre d’impacts de la période × 1 000 ÷ volume de perçages de la famille. Il s’agit d’un taux pour 1 000, pas d’un pourcentage. Le TCD fourni étant cumulatif et non daté, ce taux n’est pas strictement comparable à une fenêtre de 3 semaines.',
    problemDimension: 'Axe défaut : champ « Aléa » pour la production, « Typologie défaut » pour les NC et « Attribut » pour MES ; la catégorie n’est utilisée qu’en repli si le défaut est vide.',
    mftImpact: 'Un impact machine est une quantité affectée à un IMMO. Une déclaration portant plusieurs IMMO produit un impact par machine ; le nombre de déclarations distinctes reste affiché séparément.'
  };
}

function topAggregates_(values, limit, metric) {
  const sortMetric = metric || 'score';
  const sorted = Object.values(values)
    .sort((left, right) => right[sortMetric] - left[sortMetric] || right.total - left.total || left.label.localeCompare(right.label));
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

function getAnalyticReferences_(filters) {
  let activityMsn = null;
  let drillingByFamily = {};
  try {
    const parameters = getParameters_();
    const planningId = clean_(parameters.ID_FICHIER_PLANNING_MSN) || clean_(APP.parameterDefaults.ID_FICHIER_PLANNING_MSN);
    try {
      activityMsn = getActivityMsn_(planningId, filters);
    } catch (error) {
      activityMsn = null;
    }
    try {
      drillingByFamily = getDrillingByFamily_(parameters.ID_FICHIER_TAUX_PERCAGE);
    } catch (error) {
      drillingByFamily = {};
    }
  } catch (error) {
    return { activityMsn, drillingByFamily };
  }
  return { activityMsn, drillingByFamily };
}

function getActivityMsn_(spreadsheetId, filters) {
  if (!spreadsheetId) return null;
  const values = getCachedReferenceValues_(spreadsheetId, 'planning-msn');
  const header = values.find(row => row.filter(value => /^\d{6}$/.test(clean_(value))).length >= 12);
  const planningRow = values.find(isPlanningScopeRow_);
  if (!header || !planningRow) return null;

  const monthly = {};
  header.forEach((value, index) => {
    const month = clean_(value);
    if (/^\d{6}$/.test(month) && clean_(planningRow[index]) !== '') monthly[month] = numberOr_(planningRow[index], 0);
  });
  const from = filters.from ? parseFilterDate_(filters.from, false) : null;
  const to = filters.to ? parseFilterDate_(filters.to, true) : null;
  if (!from || !to) return Object.values(monthly).reduce((sum, value) => sum + value, 0) || null;

  let total = 0;
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    const overlapStart = from > monthStart ? from : monthStart;
    const overlapEnd = to < monthEnd ? to : monthEnd;
    const monthKey = `${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    if (overlapStart <= overlapEnd && monthly[monthKey] !== undefined) {
      const daysInMonth = monthEnd.getDate();
      const overlapDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
      total += monthly[monthKey] * overlapDays / daysInMonth;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return total || null;
}

function isPlanningScopeRow_(row) {
  return normalizeHeader_(row[0]) === normalizeHeader_(APP.scope.planningLabel)
    && normalizeHeader_(row[3]) === normalizeHeader_(APP.scope.planningCode);
}

function getDrillingByFamily_(spreadsheetId) {
  if (!spreadsheetId) return {};
  const values = getCachedReferenceValues_(spreadsheetId, 'drilling-family');
  const headerIndex = values.findIndex(row => normalizeHeader_(row[0]) === 'FAMILLE');
  if (headerIndex < 0) return {};
  const headers = values[headerIndex].map(normalizeHeader_);
  const totalIndex = headers.indexOf('TOTALGENERAL');
  if (totalIndex < 0) return {};
  const result = {};
  values.slice(headerIndex + 1).forEach(row => {
    const family = clean_(row[0]);
    const total = numberOr_(row[totalIndex], 0);
    if (family && !['-', '/', 'Total général'].includes(family) && total > 0) {
      result[normalizeHeader_(family)] = total;
    }
  });
  return result;
}

function readJsonCache_(cache, key, purpose) {
  let serialized = null;
  try {
    serialized = cache.get(key);
    return serialized ? JSON.parse(serialized) : null;
  } catch (error) {
    if (serialized && cache && typeof cache.remove === 'function') {
      try {
        cache.remove(key);
      } catch (removeError) {
      }
    }
    console.warn(`Entrée de cache ignorée (${purpose || key}) : ${error.message || error}`);
    return null;
  }
}

function writeJsonCache_(cache, key, value, expirationSeconds, purpose) {
  const cacheKey = String(key || '');
  const ttl = Number(expirationSeconds);
  const label = purpose || cacheKey;
  if (!cache || typeof cache.put !== 'function') return false;
  if (!cacheKey || cacheKey.length > 250) {
    console.warn(`Clé de cache invalide (${label}) : ${cacheKey.length} caractères.`);
    return false;
  }
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 21600) {
    console.warn(`Durée de cache invalide (${label}) : ${expirationSeconds}.`);
    return false;
  }

  let serialized;
  let byteLength;
  try {
    serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return false;
    byteLength = Utilities.newBlob(serialized, 'application/json').getBytes().length;
  } catch (error) {
    console.warn(`Sérialisation de cache impossible (${label}) : ${error.message || error}`);
    return false;
  }
  if (byteLength > 95000) {
    console.warn(`Valeur trop volumineuse pour le cache (${byteLength} octets) : ${label}`);
    return false;
  }

  try {
    cache.put(cacheKey, serialized, ttl);
    return true;
  } catch (error) {
    console.warn(`Écriture de cache impossible (${label}) : ${error.message || error}`);
    return false;
  }
}

function getCachedReferenceValues_(spreadsheetId, cachePrefix) {
  const cache = CacheService.getScriptCache();
  const cacheVersion = PropertiesService.getScriptProperties().getProperty('ANALYTICS_CACHE_VERSION') || '0';
  const cacheKey = `${cachePrefix}-${cacheVersion}-${spreadsheetId}`;
  const cached = readJsonCache_(cache, cacheKey, `référentiel ${cachePrefix}`);
  if (cached) return cached;
  const sheets = SpreadsheetApp.openById(spreadsheetId).getSheets();
  let values = null;
  for (const sheet of sheets) {
    const candidate = sheet.getDataRange().getDisplayValues();
    const matchesPlanning = cachePrefix === 'planning-msn' && candidate.some(isPlanningScopeRow_);
    const matchesDrilling = cachePrefix === 'drilling-family' && candidate.some(row =>
      normalizeHeader_(row[0]) === 'FAMILLE' && row.map(normalizeHeader_).includes('TOTALGENERAL')
    );
    if (matchesPlanning || matchesDrilling) {
      values = candidate;
      break;
    }
  }
  if (!values) throw new Error(`Aucune feuille compatible trouvée dans le référentiel ${cachePrefix}.`);
  writeJsonCache_(cache, cacheKey, values, 3600, `référentiel ${cachePrefix}`);
  return values;
}

function analyticsCacheKey_(kind, payload) {
  const version = `v7-mft-latest-family-labels-${PropertiesService.getScriptProperties().getProperty('ANALYTICS_CACHE_VERSION') || '0'}`;
  return `analytics-${kind}-${version}-${digest_(stableStringify_(payload || {}))}`;
}

function stableStringify_(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify_).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify_(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readAnalyticsCache_(key) {
  return readJsonCache_(CacheService.getScriptCache(), key, 'réponse analytique');
}

function cacheAnalyticsResponse_(key, value) {
  writeJsonCache_(CacheService.getScriptCache(), key, value, 3600, `réponse analytique ${key}`);
  return value;
}

function emptyDashboard_(message, publishedOnly) {
  return {
    empty: true, message, refreshedAt: '', controlsCount: 0,
    mes: publishedOnly ? null : getMesStatus_(),
    options: { families: [], sources: [] },
    kpis: { events: 0, declarations: 0, aleas: 0, nc: 0, mes: 0, defects: 0, downtimeHours: 0, downtimeBySource: { ALEA: 0, NC: 0, ALEA_MES: 0 }, averageDowntime: 0, averageMesDowntime: 0, activityMsn: null, impactsPerMsn: null, ncShare: 0, impactScore: 0, masterCoverage: 0, identifiedImpacts: 0, masterMatchedImpacts: 0, unmatchedMasterImpacts: 0, recurrentMachines: 0, topFiveMachineShare: 0, totalCost: 0, costBySource: { ALEA: 0, NC: 0, ALEA_MES: 0 }, costCoverage: 0, machines: 0 },
    definitions: buildDashboardDefinitions_({}),
    trend: [], trendQuality: buildTrendQuality_([]), trendLabel: trendWindow_().trendLabel,
    families: [], problems: [], downtimeProblems: [], machines: [], downtimeMachines: [], downtimeFamilies: [], sources: []
  };
}
