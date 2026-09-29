/**
 * Référentiel MFT normalisé.
 *
 * Le classeur officiel conserve trois tables indépendantes :
 * - une ligne par action courante ;
 * - une ligne par mise à jour de suivi ;
 * - une ligne par réunion.
 *
 * Les anciens onglets datés ne sont lus que par la migration initiale. Le
 * dashboard lit et écrit ensuite exclusivement ces tables normalisées.
 */

function mftOfficialActionsHeaders_() {
  return [
    'ID_ACTION', 'REF_MFT', 'DATE_CREATION', 'DEMANDEUR', 'IMMO', 'FAMILLE',
    'RAPPROCHEMENT_IDENTITE', 'CONSTAT', 'ACTION_DECIDEE', 'RESPONSABLES',
    'ECHEANCE_INITIALE', 'STATUT', 'PRIORITE', 'DATE_CLOTURE',
    'DATE_DERNIERE_MAJ', 'SOURCE_CREATION', 'CREE_PAR', 'MODIFIE_PAR'
  ];
}

function mftOfficialFollowUpsHeaders_() {
  return [
    'ID_SUIVI', 'ID_ACTION', 'DATE_SUIVI', 'TYPE_SUIVI', 'COMMENTAIRE',
    'ANCIEN_STATUT', 'NOUVEAU_STATUT', 'NOUVELLE_DATE_PROMESSE',
    'AUTEUR', 'SOURCE'
  ];
}

function mftOfficialMeetingsHeaders_() {
  return [
    'ID_REUNION', 'DATE_REUNION', 'DATE_PROCHAINE_REUNION', 'PARTICIPANTS',
    'NB_DUE', 'NB_OPEN', 'NB_DONE', 'NB_DEFERRED', 'SOURCE_FEUILLE',
    'DATE_IMPORT', 'NOTES'
  ];
}

function initialiserTableMftOfficielle() {
  const summary = initializeOfficialMftRepository_();
  SpreadsheetApp.getActive().toast(
    `Table MFT officielle prête : ${summary.actionsImported} action(s), ${summary.followUpsImported} suivi(s) et ${summary.meetingsImported} réunion(s) importés.`,
    'Dashboard Machine',
    12
  );
  return summary;
}

function initializeOfficialMftRepository_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return initializeOfficialMftRepositoryUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function initializeOfficialMftRepositoryUnlocked_() {
  const repository = ensureOfficialMftRepository_();
  const summary = { actionsImported: 0, followUpsImported: 0, meetingsImported: 0 };
  const existingActionObjects = readSheetObjects_(repository.actions);
  const existingActionIds = new Set(existingActionObjects.map(item => clean_(item.ID_ACTION)).filter(Boolean));
  const existingFollowUpIds = new Set(readSheetObjects_(repository.followUps).map(item => clean_(item.ID_SUIVI)).filter(Boolean));
  const existingMeetingIds = new Set(readSheetObjects_(repository.meetings).map(item => clean_(item.ID_REUNION)).filter(Boolean));
  let nextRef = nextNormalizedMftRef_(existingActionObjects);
  const actionRows = [];
  const followUpRows = [];

  const master = loadMasterForMftMigration_();
  const latestLegacySheet = findLatestMftSheet_(repository.spreadsheet);
  if (latestLegacySheet) {
    parseLegacyMftActions_(latestLegacySheet, master).forEach(item => {
      if (existingActionIds.has(item.id)) return;
      const ref = clean_(item.ref) || String(nextRef++);
      const now = new Date();
      actionRows.push(mftOfficialActionRow_({
        id: item.id,
        refMft: ref,
        dateCreation: item.dateCreation || latestLegacySheet.meetingDate,
        demandeur: item.demandeur,
        immo: item.immo,
        famille: item.famille,
        rapprochementIdentite: item.rapprochementIdentite,
        constat: item.constat,
        decision: item.decision,
        responsable: item.responsable,
        echeanceInitiale: item.echeanceInitiale,
        statut: item.statut,
        priorite: item.priorite,
        dateCloture: null,
        dateDerniereMaj: now,
        sourceCreation: `MIGRATION_${latestLegacySheet.name}`,
        creePar: 'Migration historique',
        modifiePar: 'Migration historique'
      }, mftOfficialActionsHeaders_()));
      existingActionIds.add(item.id);
      summary.actionsImported += 1;

      if (item.commentaire) {
        const followUpId = `SUIVI-IMPORT-${digest_(`${item.id}|${item.commentaire}`)}`;
        if (!existingFollowUpIds.has(followUpId)) {
          followUpRows.push(mftOfficialFollowUpRow_({
            id: followUpId,
            actionId: item.id,
            dateSuivi: latestLegacySheet.meetingDate,
            typeSuivi: 'IMPORT_HISTORIQUE',
            commentaire: item.commentaire,
            ancienStatut: '',
            nouveauStatut: item.statut,
            datePromesse: null,
            auteur: 'Migration historique',
            source: latestLegacySheet.name
          }, mftOfficialFollowUpsHeaders_()));
          existingFollowUpIds.add(followUpId);
          summary.followUpsImported += 1;
        }
      }
    });
  }

  readLegacyLocalMftActions_().forEach(item => {
    if (existingActionIds.has(item.id)) return;
    const now = new Date();
    actionRows.push(mftOfficialActionRow_({
      id: item.id,
      refMft: String(nextRef++),
      dateCreation: item.dateCreation || now,
      demandeur: item.demandeur || 'Dashboard TC',
      immo: item.immo,
      famille: item.famille,
      rapprochementIdentite: item.immo || item.famille ? 'SAISIE_DASHBOARD' : '',
      constat: item.constat,
      decision: item.decision,
      responsable: item.responsable,
      echeanceInitiale: item.echeance,
      statut: normalizeMftStatus_(item.statut),
      priorite: item.priorite,
      dateCloture: item.dateCloture,
      dateDerniereMaj: now,
      sourceCreation: 'MIGRATION_ACTIONS_MFT_LOCAL',
      creePar: 'Migration dashboard',
      modifiePar: 'Migration dashboard'
    }, mftOfficialActionsHeaders_()));
    existingActionIds.add(item.id);
    summary.actionsImported += 1;
  });

  appendRows_(repository.actions, actionRows);
  appendRows_(repository.followUps, followUpRows);

  listLegacyMftSheets_(repository.spreadsheet).forEach(sheetInfo => {
    const meetingId = `REUNION-${toIsoDate_(sheetInfo.meetingDate)}`;
    if (existingMeetingIds.has(meetingId)) return;
    const rawValues = sheetInfo.sheet.getDataRange().getValues();
    const displayValues = sheetInfo.sheet.getDataRange().getDisplayValues();
    const headerRow = findMftHeaderRow_(rawValues);
    if (headerRow < 0) return;
    const metadata = extractMftMetadata_(displayValues, headerRow);
    appendRows_(repository.meetings, [mftOfficialMeetingRow_({
      id: meetingId,
      dateReunion: sheetInfo.meetingDate,
      dateProchaineReunion: parseDateFromMftText_(metadata.nextMeeting),
      participants: metadata.participants,
      due: numberOr_(metadata.statusCounts.due, 0),
      open: numberOr_(metadata.statusCounts.open, 0),
      done: numberOr_(metadata.statusCounts.done, 0),
      deferred: numberOr_(metadata.statusCounts.deferred, 0),
      sourceFeuille: sheetInfo.name,
      dateImport: new Date(),
      notes: 'Import automatique depuis l’ancien onglet daté.'
    }, mftOfficialMeetingsHeaders_())]);
    existingMeetingIds.add(meetingId);
    summary.meetingsImported += 1;
  });

  formatOfficialMftRepository_(repository);
  invalidateOfficialMftCache_(repository.spreadsheetId);
  return summary;
}

function getNormalizedMftAgenda_() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 20);
  const dashboard = getDashboardData({ from: toIsoDate_(from), to: toIsoDate_(to) });
  let repository;
  try {
    repository = readOfficialMftRepository_();
  } catch (error) {
    repository = { available: false, message: error.message || String(error), actions: [], meetings: [] };
  }
  const actions = (repository.actions || []).sort(sortMftActions_).map(serializeMftAction_);
  return {
    from: toIsoDate_(from),
    to: toIsoDate_(to),
    topImmos: dashboard.empty ? [] : dashboard.machines.slice(0, 8),
    topFamilies: dashboard.empty ? [] : dashboard.families.slice(0, 8),
    definitions: dashboard.definitions || buildDashboardDefinitions_({ ALEA: { 1: 1 }, NC: { 5: 1 }, ALEA_MES: { 1: 1 } }),
    actions,
    synchronization: repository.available
      ? normalizedMftSynchronization_(actions).summary
      : { enabled: false, status: 'ERREUR', errors: 1, message: repository.message },
    officialPlan: buildNormalizedOfficialMftPlan_(repository)
  };
}

function getNormalizedOfficialMftPlan_() {
  try {
    return buildNormalizedOfficialMftPlan_(readOfficialMftRepository_());
  } catch (error) {
    return { available: false, message: error.message || String(error) };
  }
}

function configurerClasseurMft() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Configurer le classeur MFT TC',
    'Collez l’URL Google Sheets ou l’identifiant du classeur officiel :',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return { cancelled: true };
  const spreadsheetId = extractSpreadsheetId_(response.getResponseText());
  if (!spreadsheetId) throw new Error('URL ou identifiant Google Sheets invalide.');
  const spreadsheet = openMftSpreadsheetWithRetry_(spreadsheetId);
  if (!spreadsheet.getSheets().length) throw new Error('Le classeur MFT ne contient aucun onglet.');
  PropertiesService.getScriptProperties().setProperty('ID_FICHIER_PLAN_ACTIONS_MFT', spreadsheetId);
  invalidateOfficialMftCache_(spreadsheetId);
  ui.alert(`Classeur MFT configuré : ${spreadsheet.getName()}\nID : ${spreadsheetId}`);
  return { configured: true, spreadsheetId, spreadsheetName: spreadsheet.getName() };
}

function diagnostiquerClasseurMft() {
  const parameters = getParameters_();
  const spreadsheetId = clean_(parameters.ID_FICHIER_PLAN_ACTIONS_MFT);
  if (!spreadsheetId) throw new Error('Classeur de plan d’actions MFT non configuré.');
  const spreadsheet = openMftSpreadsheetWithRetry_(spreadsheetId);
  const sheets = spreadsheet.getSheets().map(sheet => ({
    name: sheet.getName(),
    rows: sheet.getLastRow(),
    columns: sheet.getLastColumn()
  }));
  const latestLegacy = findLatestMftSheet_(spreadsheet);
  const normalized = {
    actions: spreadsheet.getSheetByName(APP.sheets.mftOfficialActions),
    followUps: spreadsheet.getSheetByName(APP.sheets.mftOfficialFollowUps),
    meetings: spreadsheet.getSheetByName(APP.sheets.mftOfficialMeetings)
  };
  const result = {
    spreadsheetId,
    spreadsheetName: spreadsheet.getName(),
    sheets,
    latestLegacySheet: latestLegacy ? latestLegacy.name : '',
    normalizedRows: Object.fromEntries(Object.entries(normalized).map(([key, sheet]) => [key, sheet ? sheet.getLastRow() : 0]))
  };
  Logger.log(JSON.stringify(result));
  SpreadsheetApp.getActive().toast(
    latestLegacy
      ? `Onglet MFT trouvé : ${latestLegacy.name}. Consultez les journaux pour le détail.`
      : 'Aucun onglet MFT historique reconnu. Consultez les journaux.',
    'Diagnostic MFT',
    10
  );
  return result;
}

function extractSpreadsheetId_(value) {
  const text = clean_(value);
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(text) ? text : '';
}

function buildNormalizedOfficialMftPlan_(repository) {
  if (!repository || !repository.available) {
    return {
      available: false,
      message: (repository && repository.message) || 'Initialisez la table MFT officielle depuis le menu Dashboard Machine.'
    };
  }
  const actions = (repository.actions || []).slice().sort(sortMftActions_);
  const latestMeeting = (repository.meetings || [])[0] || {};
  const statusCounts = { open: 0, due: 0, done: 0, deferred: 0 };
  actions.forEach(item => {
    const status = item.statutAffiche || item.statut;
    if (status === 'Fait') statusCounts.done += 1;
    else if (status === 'En retard') statusCounts.due += 1;
    else if (status === 'Reporté' || status === 'Abandonné') statusCounts.deferred += 1;
    else statusCounts.open += 1;
  });
  return {
    available: true,
    normalized: true,
    sheetName: APP.sheets.mftOfficialActions,
    meetingDate: transportMftDate_(latestMeeting.dateReunion),
    metadata: {
      participants: latestMeeting.participants || '',
      nextMeeting: latestMeeting.dateProchaineReunion
        ? `Prochaine réunion le ${Utilities.formatDate(parseDate_(latestMeeting.dateProchaineReunion), Session.getScriptTimeZone(), 'dd/MM/yyyy')}`
        : '',
      statusCounts
    },
    actions: actions.map(item => ({
      id: item.id,
      ref: item.refMft,
      whoRaise: item.demandeur,
      issue: [item.immo ? `IMMO ${item.immo}` : '', item.famille ? `Famille ${item.famille}` : '', item.constat].filter(Boolean).join(' · '),
      action: item.decision,
      responsable: item.responsable,
      due: transportMftDate_(item.echeanceEffective || item.echeanceInitiale),
      statut: item.statutAffiche || item.statut,
      priorite: item.priorite,
      comment: item.dernierCommentaire || ''
    }))
  };
}

function saveOfficialMftAction_(action) {
  if (!action) throw new Error('Action MFT manquante.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const repository = ensureOfficialMftRepository_();
    const current = readOfficialMftRepositoryFromSheets_(repository);
    const id = clean_(action.id);
    const existing = id ? current.actions.find(item => item.id === id) : null;
    const now = new Date();
    const user = currentMftUser_();
    const built = buildOfficialMftRecord_(action, existing, {
      id: id || Utilities.getUuid(),
      nextRef: nextNormalizedMftRef_(readSheetObjects_(repository.actions)),
      now,
      user
    });
    const record = built.record;
    upsertOfficialMftAction_(repository.actions, record);

    appendOfficialMftFollowUp_(repository.followUps, {
      id: Utilities.getUuid(),
      actionId: record.id,
      dateSuivi: now,
      typeSuivi: built.typeSuivi,
      commentaire: clean_(action.commentaireSuivi) || (!existing ? 'Action créée depuis le dashboard.' : 'Fiche mise à jour depuis le dashboard.'),
      ancienStatut: existing ? existing.statut : '',
      nouveauStatut: record.statut,
      datePromesse: built.datePromesse,
      auteur: user,
      source: 'DASHBOARD_TC'
    });
    formatOfficialMftRepository_(repository);
    invalidateOfficialMftCache_(repository.spreadsheetId);
    const refreshed = readOfficialMftRepositoryFromSheets_(repository);
    return {
      actions: refreshed.actions.sort(sortMftActions_).map(serializeMftAction_),
      synchronization: normalizedMftSynchronization_(refreshed.actions).summary,
      officialPlan: buildNormalizedOfficialMftPlan_(refreshed)
    };
  } finally {
    lock.releaseLock();
  }
}

function buildOfficialMftRecord_(action, existing, context) {
  const merged = Object.assign({}, existing || {}, action || {});
  if (!clean_(merged.immo) && !clean_(merged.famille) && !clean_(merged.constat)) {
    throw new Error('Renseignez au moins un IMMO, une famille ou un constat.');
  }
  if (!clean_(merged.decision)) throw new Error('L’action décidée est obligatoire.');
  const now = context.now;
  const user = context.user || 'Dashboard TC';
  const statut = normalizeMftStatus_(merged.statut || 'En cours');
  const isClosed = statut === 'Fait' || statut === 'Abandonné';
  const datePromesse = action && action.datePromesse ? parseDate_(action.datePromesse) : null;
  const record = {
    id: context.id,
    refMft: existing ? existing.refMft : String(context.nextRef),
    dateCreation: existing ? existing.dateCreation : now,
    demandeur: clean_(merged.demandeur) || (existing && existing.demandeur) || user,
    immo: normalizeMftImmoList_(merged.immo),
    famille: clean_(merged.famille),
    rapprochementIdentite: clean_(merged.immo) || clean_(merged.famille) ? 'SAISIE_DASHBOARD' : clean_(merged.rapprochementIdentite),
    constat: clean_(merged.constat),
    decision: clean_(merged.decision),
    responsable: clean_(merged.responsable),
    echeanceInitiale: existing && existing.echeanceInitiale
      ? existing.echeanceInitiale
      : (merged.echeance ? parseDate_(merged.echeance) : null),
    statut,
    priorite: ['1', '2', '3'].includes(clean_(merged.priorite)) ? clean_(merged.priorite) : '2',
    dateCloture: isClosed ? ((existing && existing.dateCloture) || now) : null,
    dateDerniereMaj: now,
    sourceCreation: (existing && existing.sourceCreation) || 'DASHBOARD_TC',
    creePar: (existing && existing.creePar) || user,
    modifiePar: user
  };
  return {
    record,
    datePromesse,
    typeSuivi: !existing
      ? 'CREATION'
      : datePromesse
        ? 'REPORT_ECHEANCE'
        : normalizeMftStatus_(existing.statut) !== statut
          ? 'CHANGEMENT_STATUT'
          : 'MISE_A_JOUR'
  };
}

function abandonOfficialMftAction_(id) {
  return saveOfficialMftAction_({
    id: clean_(id),
    statut: 'Abandonné',
    commentaireSuivi: 'Action abandonnée depuis le dashboard.'
  });
}

function readNormalizedMftActions_() {
  return readOfficialMftRepository_().actions;
}

function normalizedMftSynchronization_(actions) {
  return {
    actions: actions || [],
    summary: {
      enabled: true,
      status: 'TABLE_OFFICIELLE',
      synced: 0,
      errors: 0,
      sheetName: APP.sheets.mftOfficialActions,
      message: `Source unique : « ${APP.sheets.mftOfficialActions} ». Aucune copie de feuille MFT n’est utilisée.`
    }
  };
}

function readOfficialMftRepository_() {
  const parameters = getParameters_();
  const spreadsheetId = clean_(parameters.ID_FICHIER_PLAN_ACTIONS_MFT);
  if (!spreadsheetId) throw new Error('Classeur de plan d’actions MFT non configuré.');
  const cacheKey = mftRepositoryCacheKey_(spreadsheetId);
  const cached = readMftRepositoryCache_(cacheKey);
  if (cached) return cached;
  const spreadsheet = openMftSpreadsheetWithRetry_(spreadsheetId);
  const actions = spreadsheet.getSheetByName(APP.sheets.mftOfficialActions);
  const followUps = spreadsheet.getSheetByName(APP.sheets.mftOfficialFollowUps);
  const meetings = spreadsheet.getSheetByName(APP.sheets.mftOfficialMeetings);
  if (!actions || !followUps || !meetings) {
    throw new Error('Table MFT normalisée absente. Lancez « Initialiser / migrer la table MFT officielle » depuis le menu Dashboard Machine.');
  }
  const repository = readOfficialMftRepositoryFromSheets_({ spreadsheet, spreadsheetId, actions, followUps, meetings });
  cacheMftRepository_(cacheKey, repository);
  return repository;
}

function readOfficialMftRepositoryFromSheets_(repository) {
  const followUpObjects = readSheetObjects_(repository.followUps)
    .filter(item => clean_(item.ID_ACTION));
  const followUpsByAction = {};
  followUpObjects.sort((left, right) => dateSortValue_(left.DATE_SUIVI) - dateSortValue_(right.DATE_SUIVI));
  followUpObjects.forEach(item => {
    const actionId = clean_(item.ID_ACTION);
    const current = followUpsByAction[actionId] || { datePromesse: null, dernierCommentaire: '', dateDernierSuivi: null };
    if (item.NOUVELLE_DATE_PROMESSE) current.datePromesse = item.NOUVELLE_DATE_PROMESSE;
    if (clean_(item.COMMENTAIRE)) current.dernierCommentaire = clean_(item.COMMENTAIRE);
    current.dateDernierSuivi = item.DATE_SUIVI || current.dateDernierSuivi;
    followUpsByAction[actionId] = current;
  });

  const actions = readSheetObjects_(repository.actions)
    .filter(item => clean_(item.ID_ACTION))
    .map(item => {
      const id = clean_(item.ID_ACTION);
      const followUp = followUpsByAction[id] || {};
      const action = {
        id,
        refMft: clean_(item.REF_MFT),
        dateCreation: item.DATE_CREATION || null,
        demandeur: clean_(item.DEMANDEUR),
        immo: clean_(item.IMMO),
        famille: clean_(item.FAMILLE),
        rapprochementIdentite: clean_(item.RAPPROCHEMENT_IDENTITE),
        constat: clean_(item.CONSTAT),
        decision: clean_(item.ACTION_DECIDEE),
        responsable: clean_(item.RESPONSABLES).replace(/\n+/g, ', '),
        echeanceInitiale: item.ECHEANCE_INITIALE || null,
        echeance: followUp.datePromesse || item.ECHEANCE_INITIALE || null,
        echeanceEffective: followUp.datePromesse || item.ECHEANCE_INITIALE || null,
        statut: normalizeMftStatus_(item.STATUT),
        priorite: clean_(item.PRIORITE) || '2',
        dateCloture: item.DATE_CLOTURE || null,
        dateDerniereMaj: item.DATE_DERNIERE_MAJ || null,
        sourceCreation: clean_(item.SOURCE_CREATION),
        creePar: clean_(item.CREE_PAR),
        modifiePar: clean_(item.MODIFIE_PAR),
        datePromesse: followUp.datePromesse || null,
        dernierCommentaire: followUp.dernierCommentaire || '',
        dateDernierSuivi: followUp.dateDernierSuivi || null,
        syncMftFeuille: APP.sheets.mftOfficialActions,
        syncMftLigne: '',
        syncMftStatut: 'TABLE_OFFICIELLE'
      };
      action.statutAffiche = displayedMftStatus_(action);
      return action;
    });

  const meetings = readSheetObjects_(repository.meetings)
    .filter(item => item.DATE_REUNION)
    .map(item => ({
      id: clean_(item.ID_REUNION),
      dateReunion: item.DATE_REUNION,
      dateProchaineReunion: item.DATE_PROCHAINE_REUNION || null,
      participants: clean_(item.PARTICIPANTS),
      sourceFeuille: clean_(item.SOURCE_FEUILLE)
    }))
    .sort((left, right) => dateSortValue_(right.dateReunion) - dateSortValue_(left.dateReunion));

  return {
    available: true,
    spreadsheet: repository.spreadsheet,
    actionsSheet: repository.actions,
    followUpsSheet: repository.followUps,
    meetingsSheet: repository.meetings,
    actions,
    meetings
  };
}

function ensureOfficialMftRepository_() {
  const parameters = getParameters_();
  const spreadsheetId = clean_(parameters.ID_FICHIER_PLAN_ACTIONS_MFT);
  if (!spreadsheetId) throw new Error('Paramètre ID_FICHIER_PLAN_ACTIONS_MFT non renseigné.');
  const spreadsheet = openMftSpreadsheetWithRetry_(spreadsheetId);
  const repository = {
    spreadsheet,
    spreadsheetId,
    actions: ensureSheet_(spreadsheet, APP.sheets.mftOfficialActions),
    followUps: ensureSheet_(spreadsheet, APP.sheets.mftOfficialFollowUps),
    meetings: ensureSheet_(spreadsheet, APP.sheets.mftOfficialMeetings)
  };
  ensureMftTableSchema_(repository.actions, mftOfficialActionsHeaders_());
  ensureMftTableSchema_(repository.followUps, mftOfficialFollowUpsHeaders_());
  ensureMftTableSchema_(repository.meetings, mftOfficialMeetingsHeaders_());
  formatOfficialMftRepository_(repository);
  return repository;
}

function openMftSpreadsheetWithRetry_(spreadsheetId) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      lastError = error;
      const message = error && (error.message || String(error));
      if (!/délai|expiration|timeout|temporar|service/i.test(message) || attempt === 2) break;
      Utilities.sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`Accès au classeur MFT impossible (${spreadsheetId}) après 3 tentatives. Vérifiez la propriété du script ID_FICHIER_PLAN_ACTIONS_MFT et les droits du compte de déploiement. Détail : ${lastError && (lastError.message || String(lastError))}`);
}

function mftRepositoryCacheKey_(spreadsheetId) {
  const version = PropertiesService.getScriptProperties().getProperty('MFT_CACHE_VERSION') || '0';
  return `mft-official-${version}-${spreadsheetId}`;
}

function readMftRepositoryCache_(cacheKey) {
  const cached = readJsonCache_(CacheService.getScriptCache(), cacheKey, 'référentiel MFT');
  return cached ? { available: true, actions: cached.actions || [], meetings: cached.meetings || [] } : null;
}

function cacheMftRepository_(cacheKey, repository) {
  writeJsonCache_(CacheService.getScriptCache(), cacheKey, {
    actions: repository.actions || [],
    meetings: repository.meetings || []
  }, 120, 'référentiel MFT');
}

function invalidateOfficialMftCache_(spreadsheetId) {
  if (!spreadsheetId) return;
  const properties = PropertiesService.getScriptProperties();
  const version = Number(properties.getProperty('MFT_CACHE_VERSION') || 0) + 1;
  properties.setProperty('MFT_CACHE_VERSION', String(version));
}

function ensureMftTableSchema_(sheet, expectedHeaders) {
  if (sheet.getLastRow() === 0) {
    setSheetValues_(sheet.getRange(1, 1, 1, expectedHeaders.length), [expectedHeaders]);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0];
  expectedHeaders.forEach(header => {
    if (!existing.some(value => normalizeHeader_(value) === normalizeHeader_(header))) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });
}

function formatOfficialMftRepository_(repository) {
  [repository.actions, repository.followUps, repository.meetings].forEach(sheet => {
    const columns = sheet.getLastColumn();
    if (!columns) return;
    sheet.setFrozenRows(1);
    sheet.setHiddenGridlines(true);
    sheet.getRange(1, 1, 1, columns)
      .setBackground('#246BFF')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setWrap(true);
    if (sheet.getLastRow() > 1) {
      const filter = sheet.getFilter();
      if (filter && filter.getRange().getNumRows() !== sheet.getLastRow()) filter.remove();
      if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getLastRow(), columns).createFilter();
    }
  });

  const actionColumns = headerIndexMap_(repository.actions);
  setMftDateFormat_(repository.actions, actionColumns, ['DATE_CREATION', 'ECHEANCE_INITIALE', 'DATE_CLOTURE', 'DATE_DERNIERE_MAJ']);
  setMftDateFormat_(repository.followUps, headerIndexMap_(repository.followUps), ['DATE_SUIVI', 'NOUVELLE_DATE_PROMESSE']);
  setMftDateFormat_(repository.meetings, headerIndexMap_(repository.meetings), ['DATE_REUNION', 'DATE_PROCHAINE_REUNION', 'DATE_IMPORT']);

  setMftColumnWidths_(repository.actions, actionColumns, {
    ID_ACTION: 180, REF_MFT: 80, DATE_CREATION: 105, DEMANDEUR: 140, IMMO: 120,
    FAMILLE: 150, RAPPROCHEMENT_IDENTITE: 160, CONSTAT: 280, ACTION_DECIDEE: 300,
    RESPONSABLES: 170, ECHEANCE_INITIALE: 115, STATUT: 100, PRIORITE: 75,
    DATE_CLOTURE: 105, DATE_DERNIERE_MAJ: 130, SOURCE_CREATION: 180,
    CREE_PAR: 160, MODIFIE_PAR: 160
  });
  setMftColumnWidths_(repository.followUps, headerIndexMap_(repository.followUps), {
    ID_SUIVI: 180, ID_ACTION: 180, DATE_SUIVI: 130, TYPE_SUIVI: 150,
    COMMENTAIRE: 420, ANCIEN_STATUT: 110, NOUVEAU_STATUT: 110,
    NOUVELLE_DATE_PROMESSE: 150, AUTEUR: 160, SOURCE: 160
  });
  setMftColumnWidths_(repository.meetings, headerIndexMap_(repository.meetings), {
    ID_REUNION: 130, DATE_REUNION: 110, DATE_PROCHAINE_REUNION: 150,
    PARTICIPANTS: 420, NB_DUE: 75, NB_OPEN: 75, NB_DONE: 75, NB_DEFERRED: 95,
    SOURCE_FEUILLE: 250, DATE_IMPORT: 130, NOTES: 260
  });

  applyMftValidations_(repository.actions, actionColumns);
}

function applyMftValidations_(sheet, columns) {
  const availableRows = Math.max(0, sheet.getMaxRows() - 1);
  const rowCount = Math.min(availableRows, Math.max(200, sheet.getLastRow() + 100));
  if (!rowCount) return;
  if (columns.STATUT) {
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['En cours', 'Fait', 'Reporté', 'Abandonné'], true)
      .setAllowInvalid(false)
      .setHelpText('En retard est calculé automatiquement à partir de l’échéance ; ne pas le saisir manuellement.')
      .build();
    sheet.getRange(2, columns.STATUT, rowCount, 1).setDataValidation(validation);
  }
  if (columns.PRIORITE) {
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['1', '2', '3'], true)
      .setAllowInvalid(false)
      .setHelpText('1 = élevée, 2 = modérée, 3 = basse.')
      .build();
    sheet.getRange(2, columns.PRIORITE, rowCount, 1).setDataValidation(validation);
  }
}

function setMftDateFormat_(sheet, columns, headers) {
  const rowCount = Math.max(1, sheet.getLastRow() - 1);
  headers.forEach(header => {
    const column = columns[normalizeHeader_(header)];
    if (column) sheet.getRange(2, column, rowCount, 1).setNumberFormat('dd/mm/yyyy');
  });
}

function setMftColumnWidths_(sheet, columns, widths) {
  Object.entries(widths).forEach(([header, width]) => {
    const column = columns[normalizeHeader_(header)];
    if (column) sheet.setColumnWidth(column, width);
  });
}

function headerIndexMap_(sheet) {
  if (!sheet.getLastColumn()) return {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return Object.fromEntries(headers.map((header, index) => [normalizeHeader_(header), index + 1]));
}

function readSheetObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(clean_);
  return values
    .filter(row => row.some(value => clean_(value) !== ''))
    .map(row => headers.reduce((record, header, index) => {
      record[header] = row[index];
      record[mftObjectHeaderKey_(header)] = row[index];
      return record;
    }, {}));
}

function mftObjectHeaderKey_(value) {
  return clean_(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  setSheetValues_(sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length), rows);
}

function upsertOfficialMftAction_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idColumn = headers.findIndex(header => normalizeHeader_(header) === 'IDACTION');
  if (idColumn < 0) throw new Error('Colonne ID_ACTION absente de la table MFT officielle.');
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const existingIndex = rows.findIndex(row => clean_(row[idColumn]) === record.id);
  const row = mftOfficialActionRow_(record, headers, existingIndex >= 0 ? rows[existingIndex] : null);
  const targetRow = existingIndex >= 0 ? existingIndex + 2 : sheet.getLastRow() + 1;
  setSheetValues_(sheet.getRange(targetRow, 1, 1, headers.length), [row]);
  return targetRow;
}

function appendOfficialMftFollowUp_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  appendRows_(sheet, [mftOfficialFollowUpRow_(record, headers)]);
}

function mftOfficialActionRow_(record, headers, existingRow) {
  const values = {
    IDACTION: record.id || '', REFMFT: record.refMft || '', DATECREATION: record.dateCreation || '',
    DEMANDEUR: record.demandeur || '', IMMO: record.immo || '', FAMILLE: record.famille || '',
    RAPPROCHEMENTIDENTITE: record.rapprochementIdentite || '', CONSTAT: record.constat || '',
    ACTIONDECIDEE: record.decision || '', RESPONSABLES: record.responsable || '',
    ECHEANCEINITIALE: record.echeanceInitiale || '', STATUT: record.statut || 'En cours',
    PRIORITE: record.priorite || '2', DATECLOTURE: record.dateCloture || '',
    DATEDERNIEREMAJ: record.dateDerniereMaj || '', SOURCECREATION: record.sourceCreation || '',
    CREEPAR: record.creePar || '', MODIFIEPAR: record.modifiePar || ''
  };
  return headers.map((header, index) => {
    const key = normalizeHeader_(header);
    return values[key] === undefined
      ? (existingRow && existingRow[index] !== undefined ? existingRow[index] : '')
      : values[key];
  });
}

function mftOfficialFollowUpRow_(record, headers) {
  const values = {
    IDSUIVI: record.id || '', IDACTION: record.actionId || '', DATESUIVI: record.dateSuivi || '',
    TYPESUIVI: record.typeSuivi || '', COMMENTAIRE: record.commentaire || '',
    ANCIENSTATUT: record.ancienStatut || '', NOUVEAUSTATUT: record.nouveauStatut || '',
    NOUVELLEDATEPROMESSE: record.datePromesse || '', AUTEUR: record.auteur || '', SOURCE: record.source || ''
  };
  return headers.map(header => values[normalizeHeader_(header)] === undefined ? '' : values[normalizeHeader_(header)]);
}

function mftOfficialMeetingRow_(record, headers) {
  const values = {
    IDREUNION: record.id || '', DATEREUNION: record.dateReunion || '',
    DATEPROCHAINEREUNION: record.dateProchaineReunion || '', PARTICIPANTS: record.participants || '',
    NBDUE: record.due || 0, NBOPEN: record.open || 0, NBDONE: record.done || 0,
    NBDEFERRED: record.deferred || 0, SOURCEFEUILLE: record.sourceFeuille || '',
    DATEIMPORT: record.dateImport || '', NOTES: record.notes || ''
  };
  return headers.map(header => values[normalizeHeader_(header)] === undefined ? '' : values[normalizeHeader_(header)]);
}

function parseLegacyMftActions_(sheetInfo, master) {
  const rawValues = sheetInfo.sheet.getDataRange().getValues();
  const displayValues = sheetInfo.sheet.getDataRange().getDisplayValues();
  const headerRow = findMftHeaderRow_(rawValues);
  if (headerRow < 0) return [];
  const columns = mapMftColumns_(rawValues[headerRow]);
  const actions = [];
  for (let rowIndex = headerRow + 1; rowIndex < rawValues.length; rowIndex += 1) {
    const row = rawValues[rowIndex];
    const displayRow = displayValues[rowIndex] || [];
    const ref = clean_(row[columns.ref]);
    const issue = clean_(row[columns.issue]);
    const decision = clean_(row[columns.action]);
    if (!ref && !issue && !decision) continue;
    const identity = resolveLegacyMftIdentity_(issue, master);
    const commentaire = clean_(row[columns.comment]);
    const dashboardMarker = commentaire.match(/\[DASHBOARD:([^\]]+)\]/i);
    actions.push({
      id: dashboardMarker
        ? clean_(dashboardMarker[1])
        : ref
          ? `MFT-${normalizeHeader_(ref)}`
          : `MFT-LEGACY-${digest_(`${sheetInfo.name}|${rowIndex + 1}|${issue}|${decision}`)}`,
      ref,
      dateCreation: parseDate_(row[columns.when]) || sheetInfo.meetingDate,
      demandeur: clean_(row[columns.whoRaise]),
      immo: identity.immo,
      famille: identity.famille,
      rapprochementIdentite: identity.method,
      constat: issue,
      decision,
      responsable: clean_(row[columns.responsable]).replace(/\n+/g, ', '),
      echeanceInitiale: formatMftDue_(row[columns.due], displayRow[columns.due]),
      statut: normalizeMftStatus_(row[columns.status]),
      priorite: ['1', '2', '3'].includes(clean_(row[columns.priority]).replace(/\.0$/, ''))
        ? clean_(row[columns.priority]).replace(/\.0$/, '')
        : '2',
      commentaire
    });
  }
  return actions;
}

function resolveLegacyMftIdentity_(text, master) {
  if (!master) return { immo: '', famille: '', method: 'NON_RAPPROCHE' };
  const tokens = tokenizeComment_(text);
  const immos = [...new Set(tokens.map(token => master.byImmoKey[token]).filter(immo => {
    const data = immo ? master.byImmo[immo] : null;
    return data && isInScope_(data.section);
  }))];
  if (immos.length) {
    const families = [...new Set(immos.map(immo => clean_((master.byImmo[immo] || {}).family)).filter(Boolean))];
    return {
      immo: immos.join(' ; '),
      famille: families.join(' ; '),
      method: immos.length === 1 ? 'IMMO_MASTER_EXACT' : 'PLUSIEURS_IMMO_MASTER'
    };
  }
  const textKey = normalizeHeader_(text);
  const familyMatches = Object.entries(master.byFamilyKey || {})
    .filter(([key]) => key.length >= 5 && textKey.includes(key))
    .sort((left, right) => right[0].length - left[0].length);
  if (familyMatches.length && (!familyMatches[1] || familyMatches[0][0].length > familyMatches[1][0].length)) {
    return { immo: '', famille: familyMatches[0][1].family, method: 'FAMILLE_MASTER_EXACTE' };
  }
  return { immo: '', famille: '', method: 'NON_RAPPROCHE' };
}

function readLegacyLocalMftActions_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.mftActions);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(normalizeHeader_);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const value = (row, header) => index[normalizeHeader_(header)] === undefined ? '' : row[index[normalizeHeader_(header)]];
  return values
    .filter(row => clean_(value(row, 'ID')))
    .map(row => ({
      id: clean_(value(row, 'ID')),
      dateCreation: value(row, 'DATE_CREATION') || null,
      demandeur: clean_(value(row, 'DEMANDEUR')),
      immo: clean_(value(row, 'IMMO')),
      famille: clean_(value(row, 'FAMILLE')),
      constat: clean_(value(row, 'CONSTAT')),
      decision: clean_(value(row, 'DECISION')),
      responsable: clean_(value(row, 'RESPONSABLE')),
      echeance: value(row, 'ECHEANCE') || null,
      statut: clean_(value(row, 'STATUT')) || 'En cours',
      dateCloture: value(row, 'DATE_CLOTURE') || null,
      priorite: clean_(value(row, 'PRIORITE')) || '2'
    }));
}

function listLegacyMftSheets_(spreadsheet) {
  const datePattern = /(\d{2})[ _./-]?(\d{2})[ _./-]?(\d{4})/;
  return spreadsheet.getSheets().map(sheet => {
    const name = sheet.getName();
    const normalized = normalizeHeader_(name);
    if (!normalized.includes('MFT') || !normalized.includes('MACHINES') || !normalized.includes('TC')) return null;
    if (!/ALEAS|ALEA/.test(normalized)) return null;
    const match = name.match(datePattern);
    if (!match) return null;
    const meetingDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(meetingDate.getTime()) ? null : { sheet, name, meetingDate };
  }).filter(Boolean).sort((left, right) => right.meetingDate.getTime() - left.meetingDate.getTime());
}

function loadMasterForMftMigration_() {
  try {
    const parameters = getParameters_();
    return buildMasterIndex_(readRecords_(parameters.ID_FICHIER_MASTER, APP.sourceSheets.master));
  } catch (error) {
    return null;
  }
}

function parseDateFromMftText_(value) {
  const match = clean_(value).match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (!match) return null;
  const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextNormalizedMftRef_(objects) {
  const maximum = (objects || []).reduce((current, item) => {
    const value = Number(clean_(item.REF_MFT || item.refMft).replace(',', '.'));
    return Number.isFinite(value) ? Math.max(current, value) : current;
  }, 0);
  return maximum + 1;
}

function normalizeMftStatus_(value) {
  const normalized = normalizeHeader_(value);
  if (['DONE', 'FAIT', 'CLOTURE', 'CLOTUREE'].includes(normalized)) return 'Fait';
  if (['DEFERRED', 'REPORTE', 'REPORTEE'].includes(normalized)) return 'Reporté';
  if (['ABANDONNE', 'ABANDONNEE', 'ANNULE', 'ANNULEE'].includes(normalized)) return 'Abandonné';
  return 'En cours';
}

function displayedMftStatus_(action) {
  if (action.statut !== 'En cours') return action.statut;
  const rawDue = action.echeanceEffective || action.echeanceInitiale;
  if (!(rawDue instanceof Date) && !/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(clean_(rawDue))) {
    return action.statut;
  }
  const parsedDue = parseDate_(rawDue);
  const due = parsedDue ? new Date(parsedDue.getTime()) : null;
  if (!due) return action.statut;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'En retard' : 'En cours';
}

function normalizeMftImmoList_(value) {
  return clean_(value)
    .split(/[;,/\r\n]+/)
    .map(normalizeImmo_)
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .join(' ; ');
}

function currentMftUser_() {
  try {
    return clean_(Session.getActiveUser().getEmail()) || clean_(Session.getEffectiveUser().getEmail()) || 'Dashboard TC';
  } catch (error) {
    return 'Dashboard TC';
  }
}

function serializeMftAction_(action) {
  return Object.assign({}, action, {
    dateCreation: transportMftDate_(action.dateCreation),
    echeanceInitiale: transportMftDate_(action.echeanceInitiale),
    echeance: transportMftDate_(action.echeance),
    echeanceEffective: transportMftDate_(action.echeanceEffective),
    dateCloture: transportMftDate_(action.dateCloture),
    dateDerniereMaj: transportMftDate_(action.dateDerniereMaj),
    datePromesse: transportMftDate_(action.datePromesse),
    dateDernierSuivi: transportMftDate_(action.dateDernierSuivi)
  });
}

function transportMftDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate_(value);
  if (typeof value === 'number' && value > 20000) {
    const parsedNumeric = parseDate_(value);
    return parsedNumeric ? toIsoDate_(parsedNumeric) : clean_(value);
  }
  const text = clean_(value);
  if (!/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(text)) return text;
  const parsed = parseDate_(text);
  return parsed ? toIsoDate_(parsed) : text;
}
