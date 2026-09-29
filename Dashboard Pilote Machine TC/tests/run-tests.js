const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const scriptFiles = ['Config.gs', 'Code.gs', 'MesImport.gs', 'MftRepository.gs'];
const sources = scriptFiles.map(file => fs.readFileSync(path.join(root, 'apps-script', file), 'utf8'));

scriptFiles.forEach((file, index) => {
  new vm.Script(sources[index], { filename: file });
});
assert.match(sources[1], /function getDashboardData\(filters(?:, publishedOnly)?\) \{[\s\S]{0,800}const spreadsheet = SpreadsheetApp\.getActive\(\);/);

const html = fs.readFileSync(path.join(root, 'apps-script', 'Index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `Index.inline.${index + 1}.js` }));

const scriptProperties = {};
const context = vm.createContext({
  console,
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_algorithm, text) => [...crypto.createHash('sha256').update(String(text)).digest()],
    newBlob: value => ({ getBytes: () => [...Buffer.from(String(value), 'utf8')] }),
    formatDate: (value, _timezone, format) => {
      const date = new Date(value);
      if (format === 'yyyy-MM') return date.toISOString().slice(0, 7);
      if (format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
      return date.toISOString().slice(0, 10);
    }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      setProperty: (key, value) => { scriptProperties[key] = value; },
      deleteProperty: key => { delete scriptProperties[key]; },
      getProperty: key => scriptProperties[key] || null,
      getProperties: () => ({ ...scriptProperties })
    })
  }
});
vm.runInContext(sources.join('\n'), context, { filename: 'apps-script.bundle.js' });
// Les objets créés dans le contexte vm ont leurs propres prototypes : on les clone
// dans le contexte courant pour que assert.deepEqual compare seulement les valeurs.
const toLocalRealm = value => {
  try {
    return structuredClone(value);
  } catch (error) {
    return value;
  }
};
const evaluate = expression => toLocalRealm(vm.runInContext(expression, context));

assert.equal(evaluate("isPlausibleImmo_('1710288')"), true);
assert.equal(evaluate("isPlausibleImmo_('DOTATION')"), false);
assert.equal(evaluate("isPlausibleImmo_('A ENQUETER')"), false);
assert.equal(evaluate("isPlausibleImmo_('N/A')"), false);
assert.equal(evaluate("dateKey_(parseDate_(44202))"), '2021-01-06');
assert.equal(evaluate("canonicalizeSourceHeaders_(['1 103 448,00 EUR', 'Année', 'Section'], [['06/01/2021', '2021', 'PA']], APP.sourceSheets.aleas)[0]"), 'Date');
assert.equal(evaluate("extractSpreadsheetId_('https://docs.google.com/spreadsheets/d/1mitHu2DNTdXxTtkLwMeZ1tNXLODQ9-6gldOhEUlTa9o/edit?gid=1725759594#gid=1725759594')"), '1mitHu2DNTdXxTtkLwMeZ1tNXLODQ9-6gldOhEUlTa9o');
assert.equal(evaluate("extractSpreadsheetId_('not-a-spreadsheet-id')"), '');
assert.equal(evaluate("APP.parameterDefaults.ID_FICHIER_PLAN_ACTIONS_TC_370"), '1Ja20mLJJ7qI_xCNBqanOzc4Iu5tgzPdRG74Jjhv_fhU');
assert.equal(evaluate("APP.parameterDefaults.ID_FICHIER_PLAN_ACTIONS_TC_355_360_OSW"), '1Y9wuDfQauZm-mRU8oCIxRPt2hw8nrRJmu3z_BFPbm6M');
const actionPlanCoverage = evaluate(`(() => {
  const actions = [
    { immo: '1712927', family: 'TC-370-A', action: 'Réparer', status: 'En cours' },
    { immo: '1712928', family: 'TC-355-B', action: 'Terminer', status: 'DONE' },
    { immo: '1712929', family: 'TC-360-C', action: 'Statut inconnu', status: '' }
  ];
  const coverage = Object.assign(actionPlanCoverageFromActions_(actions), { available: true, complete: true, sourceCount: 2, sourcesRead: 2 });
  const rows = annotateActionPlanRows_([
    { label: 'TC-370-A' }, { label: 'TC-355-B' }, { label: 'TC-360-C' }
  ], 'family', coverage);
  const costQuality = buildActionPlanCostQuality_([
    { label: 'TC-370-A', cost: 200 }, { label: 'TC-355-B', cost: 800 }
  ], coverage, true);
  return { statuses: rows.map(row => row.actionPlanStatus), costQuality };
})()`);
assert.deepEqual([...actionPlanCoverage.statuses], ['OUI', 'NON', 'INCONNU']);
assert.equal(actionPlanCoverage.costQuality.untreatedPercentage, 80);
assert.equal(evaluate("isAleaStationInScope_('290.0')"), true);
assert.equal(evaluate("isAleaStationInScope_('P280.0')"), true);
assert.equal(evaluate("isAleaStationInScope_('290B')"), true);
assert.equal(evaluate("isAleaStationInScope_('2901')"), true);
assert.equal(evaluate("isAleaStationInScope_('')"), false);
assert.equal(evaluate("canonicalStation_('P355')"), '355');
assert.equal(evaluate("canonicalStation_('355')"), '355');
assert.equal(evaluate("canonicalStation_('P370 A')"), '370A');
assert.equal(evaluate("canonicalStation_('P370 Bleu')"), '370');
assert.equal(evaluate("canonicalStation_('P370_PAT FREIGHTER')"), '370');
assert.equal(evaluate("canonicalStation_('P360_PAT')"), '360');
assert.equal(evaluate("canonicalStation_('P360 B')"), '360B');
assert.equal(evaluate("canonicalStation_('370E')"), '370E');
const canonicalStationOptions = evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = values => APP.factsHeaders.map(header => values[header] || '');
  return collectFilterOptions_([
    row({ POSTE: 'P355' }), row({ POSTE: '355' }), row({ POSTE: 'P370 A' }), row({ POSTE: '370A' }), row({ POSTE: 'P360 B' })
  ], index).stations;
})()`);
assert.deepEqual([...canonicalStationOptions], ['370', '370A', '370B', '370C', '370D', '370E', '360', '360A', '360B', '355']);
assert.equal(evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = APP.factsHeaders.map(header => header === 'POSTE' ? 'P355' : '');
  return matchesFilters_(row, index, { station: '355' });
})()`), true);
assert.equal(evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = APP.factsHeaders.map(header => header === 'POSTE' ? 'P370 B' : '');
  return matchesFilters_(row, index, { station: ['360A', '370B'] });
})()`), true);
assert.equal(evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = APP.factsHeaders.map(header => header === 'POSTE' ? 'P355' : '');
  return matchesFilters_(row, index, { station: ['360A', '370B'] });
})()`), false);
assert.equal(evaluate("isPlanningScopeRow_(['A350 Structure TC', '', 'PTC', 'TC STR'])"), true);
assert.equal(evaluate("isPlanningScopeRow_(['A350 Structure PA', '', 'PPA', 'PA STR'])"), false);
const tcMesIdentityWithoutImmoInference = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '2100001', FAMILLE: '247-V3-193', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '2100002', FAMILLE: '227-V3-071', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '2100003', FAMILLE: '227-V3-071', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  return {
    noIdentity: resolveMesIdentity_('', '', 'Localisation 370E C46 - écran noir', master),
    familyOnly: resolveMesIdentity_('', '', 'ID Machine 247 V3 193 manquante au poste C', master),
    multiImmoFamily: resolveMesIdentity_('', '', 'seule Tete edu 227 V3 071', master)
  };
})()`);
assert.deepEqual([...tcMesIdentityWithoutImmoInference.noIdentity.immos], []);
assert.equal(tcMesIdentityWithoutImmoInference.noIdentity.family, '');
assert.deepEqual([...tcMesIdentityWithoutImmoInference.familyOnly.immos], []);
assert.equal(tcMesIdentityWithoutImmoInference.familyOnly.family, '247-V3-193');
assert.deepEqual([...tcMesIdentityWithoutImmoInference.multiImmoFamily.immos], []);
assert.equal(tcMesIdentityWithoutImmoInference.multiImmoFamily.family, '227-V3-071');
assert.equal(evaluate("isMissingMesImmo_('NaN')"), true);
assert.equal(evaluate("isMissingMesImmo_('N/A')"), true);
assert.equal(evaluate("isMissingMesImmo_('2100001')"), false);
assert.equal(evaluate("shouldIncludeArchivedFacts_({}, new Date('2026-08-28'))"), true);
assert.equal(evaluate("shouldIncludeArchivedFacts_({ from: '2025-08-28' }, new Date('2026-08-28'))"), false);
assert.equal(evaluate("shouldIncludeArchivedFacts_({ from: '2023-08-28' }, new Date('2026-08-28'))"), true);
assert.equal(
  evaluate("stableStringify_({ section: 'PA', from: '2026-01-01', sources: ['ALEA', 'NC'] })"),
  evaluate("stableStringify_({ sources: ['ALEA', 'NC'], from: '2026-01-01', section: 'PA' })")
);
assert.ok(sources[1].includes('const cacheKey =') && sources[1].includes('stableStringify_(payload || {})'));
assert.ok(sources[1].includes('ensureUsageGuide_(SpreadsheetApp.getActive())'));
const usageGuide = evaluate("usageGuideRows_().flat().join(' ')");
assert.ok(usageGuide.includes('MES A DEPOSER'));
assert.ok(usageGuide.includes('Dashboard Machine'));
assert.ok(usageGuide.includes('Importer les extractions MES'));
assert.ok(usageGuide.includes('Actualiser toutes les données'));
assert.ok(usageGuide.includes('Recharger les données publiées'));
assert.match(html, /function refreshSources\(\) \{\s*reloadCurrentView\(true\);/);
assert.match(html, /\.getDashboardData\(readFilters\(\), publishedOnly === true\)/);
assert.match(html, /\.getSourceAnalysisData\(source, readFilters\(\), publishedOnly === true\)/);

const publishedAleaWithoutExternalSource = evaluate(`(() => {
  const originalRead = readFactsForAnalysis_;
  const originalDirect = getProductionAleaAnalysisData_;
  const originalCacheRead = readAnalyticsCache_;
  const originalCacheWrite = cacheAnalyticsResponse_;
  readFactsForAnalysis_ = () => ({ headers: APP.factsHeaders.slice(), values: [] });
  getProductionAleaAnalysisData_ = () => { throw new Error('Source externe ouverte'); };
  readAnalyticsCache_ = () => null;
  cacheAnalyticsResponse_ = (_key, value) => value;
  try {
    const result = getSourceAnalysisData('ALEA', {}, true);
    return [result.empty, result.origin.directSource];
  } finally {
    readFactsForAnalysis_ = originalRead;
    getProductionAleaAnalysisData_ = originalDirect;
    readAnalyticsCache_ = originalCacheRead;
    cacheAnalyticsResponse_ = originalCacheWrite;
  }
})()`);
assert.deepEqual([...publishedAleaWithoutExternalSource], [true, false]);

const sourceIds = evaluate(`(() => {
  const originalLock = withScriptLock_;
  const originalParameters = getParameters_;
  const originalProperties = PropertiesService.getScriptProperties;
  const originalSpreadsheet = globalThis.SpreadsheetApp;
  const stored = { ID_FICHIER_MASTER: 'master-inchange', ID_FICHIER_PLAN_ACTIONS_MFT: 'mft-inchange' };
  const messages = [];
  withScriptLock_ = callback => callback();
  getParameters_ = () => ({ ID_FICHIER_MASTER: stored.ID_FICHIER_MASTER, ID_FICHIER_PLAN_ACTIONS_MFT: stored.ID_FICHIER_PLAN_ACTIONS_MFT });
  PropertiesService.getScriptProperties = () => ({
    setProperties: values => Object.assign(stored, values),
    setProperty: (key, value) => { stored[key] = value; }
  });
  globalThis.SpreadsheetApp = { getActive: () => ({ toast: message => messages.push(message) }) };
  try {
    const result = synchroniserSourcesConnues();
    return {
      aleas: stored.ID_FICHIER_ALEAS,
      nc: stored.ID_FICHIER_NC,
      planning: stored.ID_FICHIER_PLANNING_MSN,
      drilling: stored.ID_FICHIER_TAUX_PERCAGE,
      docMartin: stored.ID_FICHIER_DOC_MARTIN,
      master: stored.ID_FICHIER_MASTER,
      mft: stored.ID_FICHIER_PLAN_ACTIONS_MFT,
      returnedMaster: result.ID_FICHIER_MASTER,
      returnedMft: result.ID_FICHIER_PLAN_ACTIONS_MFT,
      versionChanged: Boolean(stored.ANALYTICS_CACHE_VERSION),
      toast: messages[0]
    };
  } finally {
    withScriptLock_ = originalLock;
    getParameters_ = originalParameters;
    PropertiesService.getScriptProperties = originalProperties;
    globalThis.SpreadsheetApp = originalSpreadsheet;
  }
})()`);
assert.equal(sourceIds.aleas, '1rFeIB7i5cfZNvnx37O-NHi_fKXlp0SDFgOZkMIyk9Ws');
assert.equal(sourceIds.nc, sourceIds.aleas);
assert.equal(sourceIds.planning, '1UFoE2rUJmJy_KM77JRUAAl_ffhgz9rh7JJt3wcUVf_Y');
assert.equal(sourceIds.drilling, '1vlbPl6jxtZOa--C6W7AQLbKRBvjUbGf-JaX2L__fUrk');
assert.equal(sourceIds.docMartin, '1hmoC2X4iQv3fyAuZkUV2j57zWm57uu2O8saXuEaP4lw');
assert.equal(sourceIds.master, 'master-inchange');
assert.equal(sourceIds.mft, 'mft-inchange');
assert.equal(sourceIds.returnedMaster, sourceIds.master);
assert.equal(sourceIds.returnedMft, sourceIds.mft);
assert.equal(sourceIds.versionChanged, true);
assert.ok(sourceIds.toast.includes('master-inchange'.slice(-8)));
assert.ok(sourceIds.toast.includes('mft-inchange'.slice(-8)));

const cacheRules = evaluate(`(() => {
  const values = { broken: '{' };
  const writes = [];
  const removed = [];
  const cache = {
    get: key => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
    put: (key, value, expiration) => writes.push({ key, value, expiration }),
    remove: key => removed.push(key)
  };
  const results = [
    writeJsonCache_(cache, 'valid', { data: 'ok' }, 900, 'test'),
    writeJsonCache_(cache, 'x'.repeat(251), { data: 'ok' }, 900, 'test'),
    writeJsonCache_(cache, 'bad-ttl', {}, 21601, 'test'),
    writeJsonCache_(cache, 'too-large', { data: 'é'.repeat(48000) }, 900, 'test')
  ];
  const malformed = readJsonCache_(cache, 'broken', 'test');
  return { results, malformed, writes: writes.length, removed };
})()`);
assert.deepEqual([...cacheRules.results], [true, false, false, false]);
assert.equal(cacheRules.malformed, null);
assert.equal(cacheRules.writes, 1);
assert.deepEqual([...cacheRules.removed], ['broken']);

const staleFactsCleanup = evaluate(`(() => {
  const definitions = [
    ['faits_immo_139844383', 0],
    ['FAITS_IMMO_139844384', 1],
    ['FAITS_IMMO__PUBLICATION_123', 1],
    ['FAITS_IMMO__PRECEDENT_123', 2],
    ['FAITS_IMMO_139844385', 2],
    ['FAITS_IMMO_ARCHIVES', 0],
    ['FAITS_IMMO', 1],
    ['FAITS_IMMO_139844386', 0]
  ];
  const sheets = definitions.map(([name, lastRow], index) => ({
    getName: () => name,
    getSheetId: () => index + 1,
    getLastRow: () => lastRow,
    isSheetHidden: () => false,
    hideSheet: () => hidden.push(name)
  }));
  const deleted = [];
  const hidden = [];
  cleanupStaleFactsPublicationSheets_({
    getSheets: () => sheets,
    deleteSheet: sheet => deleted.push(sheet.getName())
  }, sheets[7]);
  return { deleted, hidden };
})()`);
assert.deepEqual([...staleFactsCleanup.deleted], ['faits_immo_139844383', 'FAITS_IMMO_139844384', 'FAITS_IMMO__PUBLICATION_123']);
assert.deepEqual([...staleFactsCleanup.hidden], ['FAITS_IMMO__PRECEDENT_123', 'FAITS_IMMO_139844385']);

const interruptedPublication = evaluate(`(() => {
  const pending = { getName: () => 'FAITS_IMMO__PUBLICATION_123', getSheetId: () => 1, getLastRow: () => 12 };
  const published = { getName: () => 'FAITS_IMMO', getSheetId: () => 2, getLastRow: () => 20 };
  PropertiesService.getScriptProperties().setProperty('FACTS_ACTIVE_SHEET_ID', '1');
  const selected = getActiveFactsSheet_({
    getSheetById: id => id === 1 ? pending : published,
    getSheetByName: () => published
  });
  return [selected.getSheetId(), PropertiesService.getScriptProperties().getProperty('FACTS_ACTIVE_SHEET_ID')];
})()`);
assert.deepEqual([...interruptedPublication], [2, '2']);

const directAleaDetails = evaluate(`(() => {
  const original = readProductionAleaFacts_;
  readProductionAleaFacts_ = () => ({
    headers: APP.factsHeaders.slice(),
    values: [APP.factsHeaders.map(header => header === 'SOURCE' ? 'ALEA' : '')]
  });
  try {
    return getDashboardDetails({ source: 'ALEA', station: [] },
      { directSource: true, dimension: 'problem', value: 'Non renseigné' }).total;
  } finally {
    readProductionAleaFacts_ = original;
  }
})()`);
assert.equal(directAleaDetails, 1);

const mergedAnalysisFacts = evaluate(`(() => {
  const row = values => APP.factsHeaders.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return mergeAnalysisFactRows_([
    row({ ID_EVENEMENT: 'ALEA-1', SOURCE: 'ALEA', COMMENTAIRE: 'Actif' })
  ], [
    row({ ID_EVENEMENT: 'ALEA-1', SOURCE: 'ALEA', COMMENTAIRE: 'Archive en double' }),
    row({ ID_EVENEMENT: 'ALEA-2', SOURCE: 'ALEA', COMMENTAIRE: 'Archive historique' }),
    row({ ID_EVENEMENT: 'ALEA-1', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', COMMENTAIRE: 'Autre source' })
  ]).map(item => ({ id: item[0], source: item[3], comment: item[24] }));
})()`);
assert.equal(mergedAnalysisFacts.length, 3);
assert.equal(mergedAnalysisFacts.find(item => item.id === 'ALEA-1' && item.source === 'ALEA').comment, 'Actif');

const masterAudit = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'PA' },
    { IMMO: '2112114', FAMILLE: '403-V3-105-A-P2-3.2', SECTION: 'TC' },
    { IMMO: 'DOTATION', FAMILLE: 'FAUSSE-FAMILLE', SECTION: 'PA' }
  ]);
  return {
    valid: Object.keys(master.byImmo),
    invalid: master.invalidImmos,
    paMatch: resolveMesIdentity_('', '', 'Défaut machine 1710288', master),
    tcMatch: resolveMesIdentity_('', '', 'Défaut machine 2112114', master),
    tcStructured: resolveMesIdentity_('2112114', '', '', master)
  };
})()`);
assert.deepEqual([...masterAudit.valid], ['1710288', '2112114']);
assert.equal(masterAudit.invalid.DOTATION, 1);
// Dashboard TC : un IMMO du master TC est reconnu, un IMMO PA reste hors périmètre.
assert.equal(masterAudit.paMatch.immos.length, 0);
assert.equal(masterAudit.paMatch.method, 'IMMO_COMMENTAIRE_NON_RECONNU');
assert.equal(masterAudit.tcMatch.immos[0], '2112114');
assert.equal(masterAudit.tcMatch.method, 'IMMO_COMMENTAIRE_EXACT');
assert.equal(masterAudit.tcStructured.immos[0], '2112114');
assert.equal(masterAudit.tcStructured.method, 'IMMO_SOURCE_EXACT');

const equipmentIdentity = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1006038', FAMILLE: '107-V3-022', EQUIPEMENT: '10554', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1006039', FAMILLE: '107-V3-023', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  return {
    direct: resolveMesIdentity_('10554', '', 'Défaut machine 1006039', master),
    commentFallback: resolveMesIdentity_('', '', 'Défaut machine 1006039', master),
    equipmentImmo: master.byEquipmentKey && master.byEquipmentKey['10554']
  };
})()`);
assert.deepEqual([...equipmentIdentity.direct.immos], ['1006038']);
assert.equal(equipmentIdentity.direct.family, '107-V3-022');
assert.equal(equipmentIdentity.direct.method, 'IMMO_EQUIPEMENT_EXACT');
assert.deepEqual([...equipmentIdentity.commentFallback.immos], ['1006039']);
assert.equal(equipmentIdentity.equipmentImmo, '1006038');
const docMartinRows = evaluate(`docMartinEquipmentRecords_([
  ['', '', ''], ['Données mises à jour le : 24/08/26', '', ''],
  ['N° IMMO', 'Famille', 'Equipement'],
  ['1006038', '107-V3-022', 10554],
  ['1006039', '107-V3-016', '10555.0']
])`);
assert.deepEqual([...docMartinRows].map(row => [row.immo, row.family, row.equipment]), [
  ['1006038', '107-V3-022', '10554'], ['1006039', '107-V3-016', '10555']
]);

const docMartinIdentity = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1006038', FAMILLE: '', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1006039', FAMILLE: 'Famille master', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1006040', SECTION: 'TC', CATEGORIE: 'Outillage' },
    { IMMO: '1006041', SECTION: 'PA', CATEGORIE: 'Perçage' },
    { IMMO: '1006042', FAMILLE: 'SNZ-V3-065', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  enrichMasterWithDocMartin_(master, [
    { immo: '1006038', family: '107-V3-022', equipment: '10554' },
    { immo: '1006038', family: '107-V3-022', equipment: '10555' },
    { immo: '1006039', family: '107-V3-016', equipment: '10555' },
    { immo: '1006038', family: '107-V3-022', equipment: '10556' },
    { immo: '1006041', family: 'Autre secteur', equipment: '10556' },
    { immo: '1006040', family: 'Outillage', equipment: '10557' },
    { immo: '1006042', family: 'SNZ-V3-065', equipment: '10558' }
  ]);
  return {
    direct: resolveMesIdentity_('10554', '', '', master),
    immoComment: resolveMesIdentity_('', '', 'Défaut machine 1006039', master),
    familyComment: resolveMesIdentity_('', '', 'UPA 065 probleme de clampage', master),
    ambiguous: master.byEquipmentKey['10555'],
    crossScope: master.byEquipmentKey['10556'],
    nonDrilling: master.byEquipmentKey['10557'],
    masterFamily: master.byImmo['1006039'].family
  };
})()`);
assert.deepEqual([...docMartinIdentity.direct.immos], ['1006038']);
assert.equal(docMartinIdentity.direct.family, '107-V3-022');
assert.equal(docMartinIdentity.direct.method, 'IMMO_EQUIPEMENT_EXACT');
assert.deepEqual([...docMartinIdentity.immoComment.immos], ['1006039']);
assert.equal(docMartinIdentity.immoComment.method, 'IMMO_COMMENTAIRE_EXACT');
assert.equal(docMartinIdentity.familyComment.family, 'SNZ-V3-065');
assert.equal(docMartinIdentity.familyComment.method, 'FAMILLE_COMMENTAIRE');
assert.equal(docMartinIdentity.ambiguous, undefined);
assert.equal(docMartinIdentity.crossScope, undefined);
assert.equal(docMartinIdentity.nonDrilling, undefined);
assert.equal(docMartinIdentity.masterFamily, 'Famille master');
assert.equal(evaluate("APP.parameterDefaults.ID_FICHIER_ALEAS"), '1rFeIB7i5cfZNvnx37O-NHi_fKXlp0SDFgOZkMIyk9Ws');

const drillingCategoryFilter = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700101', FAMILLE: 'FAM-PERCAGE', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1700102', FAMILLE: 'FAM-OUTILLAGE', SECTION: 'TC', CATEGORIE: 'Outillage' }
  ]);
  const facts = [];
  appendFacts_(facts, [
    { DATE: '2026-08-18', SECTION: 'TC', NIMMO: '1700101/1700102', NC: 'NC-DRILL', NBRNC: 2 }
  ], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  return facts.map(row => row[4]);
})()`);
assert.deepEqual([...drillingCategoryFilter], ['1700101']);

const mesIdentityVariants = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: '401-M2-005-A-P2-3.2', SECTION: 'TC' },
    { IMMO: '1700002', FAMILLE: 'SNZ-V3-065', SECTION: 'TC' },
    { IMMO: '1700003', FAMILLE: 'FAMILLE-C', TYPE: 'ST510', SECTION: 'TC' },
    { IMMO: '1700004', FAMILLE: '119-V3-103', SECTION: 'TC' },
    { IMMO: '1700005', FAMILLE: 'AUTRE-V3-065', SECTION: 'PA' },
    { IMMO: 'SNZ-M2-010', FAMILLE: 'FAMILLE-D', SECTION: 'TC' },
    { IMMO: 'SNZ-V3-040', FAMILLE: 'FAMILLE-E', SECTION: 'TC' },
    { IMMO: 'SNZ-V3-121', FAMILLE: 'FAMILLE-F', SECTION: 'TC' },
    { IMMO: 'SNZ-V3-122', FAMILLE: 'FAMILLE-G', SECTION: 'TC' }
  ]);
  return {
    compactFamily: resolveMesIdentity_('401M2005', '', '', master),
    qlikComment: resolveMesIdentity_('', '', 'UPA V3 065 V3 103 non dispo a poste', master),
    shortQlikComment: resolveMesIdentity_('', '', 'UPA 065 probleme de clampage', master),
    machineComment: resolveMesIdentity_('', '', 'Manque ST510 sur les racks', master),
    m2ShortComment: resolveMesIdentity_('', '', 'manque upa SNZ M2 10', master),
    v3ShortComment: resolveMesIdentity_('', '', 'UPA SNZ V 040 non dispo au poste', master),
    twoMachinesComment: resolveMesIdentity_('', '', 'Manque outils de percage references SNZ V3 121 et SNZ V3 122 au niveau 3', master)
  };
})()`);
assert.equal(mesIdentityVariants.compactFamily.immos[0], '1700001');
assert.deepEqual([...mesIdentityVariants.qlikComment.immos], []);
assert.equal(mesIdentityVariants.qlikComment.family, '');
assert.deepEqual([...mesIdentityVariants.shortQlikComment.immos], []);
assert.equal(mesIdentityVariants.shortQlikComment.family, 'SNZ-V3-065');
assert.deepEqual([...mesIdentityVariants.machineComment.immos], []);
assert.equal(mesIdentityVariants.machineComment.family, '');
assert.deepEqual([...mesIdentityVariants.m2ShortComment.immos], []);
assert.equal(mesIdentityVariants.m2ShortComment.family, '');
assert.deepEqual([...mesIdentityVariants.v3ShortComment.immos], []);
assert.equal(mesIdentityVariants.v3ShortComment.family, '');
assert.deepEqual([...mesIdentityVariants.twoMachinesComment.immos], []);
assert.equal(mesIdentityVariants.twoMachinesComment.family, '');

const mesCommentIdentity = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1606272', FAMILLE: '104-M2-008-A-P2-3.2', SECTION: 'TC' },
    { IMMO: '1907052', FAMILLE: '403-V3-105-A-P2-3.2', SECTION: 'TC' }
  ]);
  return {
    first: resolveMesIdentity_('', '', 'outil casse 104 M2 008 1606272 P290 000 111', master),
    second: resolveMesIdentity_('', '', 'Ce de percage HS possibilite de reappro d un nouveau ce svp 403 V3 105 1907052', master),
    unknown: resolveMesIdentity_('', '', 'Foret UPA 403 V3 105 A P2 HS numero 9999999', master)
  };
})()`);
assert.deepEqual([...mesCommentIdentity.first.immos], ['1606272']);
assert.equal(mesCommentIdentity.first.family, '104-M2-008-A-P2-3.2');
assert.deepEqual([...mesCommentIdentity.second.immos], ['1907052']);
assert.equal(mesCommentIdentity.second.family, '403-V3-105-A-P2-3.2');
assert.deepEqual([...mesCommentIdentity.unknown.immos], []);
assert.equal(mesCommentIdentity.unknown.method, 'IMMO_COMMENTAIRE_NON_RECONNU');

const tcCommentIdentityRefinements = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1606347', FAMILLE: '107-V3-122-E', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1606348', FAMILLE: '107-V3-122-E', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1606349', FAMILLE: '107-V3-122', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1509370', FAMILLE: '208-V3-021-E', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1509371', FAMILLE: '208-V3-021-E', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '2200001', FAMILLE: '226-V3-021', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  return {
    corrected: resolveMesIdentity_('', '', 'edu 107v3122 16066347 renvoyer a poste sans outil dedans A350 TC A350 STR P370 A', master),
    oneKnownFamily: resolveMesIdentity_('', '', 'bonjour besoin d une 226v3 021 et 225v3 071 poste B CDT G A350 TC A350 STR P370 B', master),
    suffixFamily: resolveMesIdentity_('', '', 'Manque la machine 208 V3 021 A350 TC A350 STR P370 B', master),
    suffixFamilyWithoutImmo: resolveMesIdentity_('', '', 'Manque la machine 208 V3 021', master),
    familyTokens: commentFamilyTokens_(tokenizeComment_('208 V3 021 A350 TC A350 STR P370 B'))
  };
})()`);
assert.deepEqual([...tcCommentIdentityRefinements.corrected.immos], ['1606347']);
assert.equal(tcCommentIdentityRefinements.corrected.family, '107-V3-122-E');
assert.equal(tcCommentIdentityRefinements.corrected.method, 'IMMO_COMMENTAIRE_CORRIGE');
assert.deepEqual([...tcCommentIdentityRefinements.oneKnownFamily.immos], []);
assert.equal(tcCommentIdentityRefinements.oneKnownFamily.family, '226-V3-021');
assert.deepEqual([...tcCommentIdentityRefinements.suffixFamily.immos], []);
assert.equal(tcCommentIdentityRefinements.suffixFamily.family, '208-V3-021-E');
assert.deepEqual([...tcCommentIdentityRefinements.suffixFamilyWithoutImmo.immos], []);
assert.equal(tcCommentIdentityRefinements.suffixFamilyWithoutImmo.family, '208-V3-021-E');
assert.ok(!tcCommentIdentityRefinements.familyTokens.includes('A350'));
assert.ok(!tcCommentIdentityRefinements.familyTokens.includes('A350TC'));
assert.ok(!tcCommentIdentityRefinements.familyTokens.includes('A350STR'));
assert.ok(!tcCommentIdentityRefinements.familyTokens.includes('P370'));

const familyCommentMultipleImmos = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1607025', FAMILLE: 'SNZ-M2-224', SECTION: 'TC' },
    { IMMO: '1607026', FAMILLE: 'SNZ-M2-224', SECTION: 'TC' }
  ]);
  return {
    family: resolveMesIdentity_('', '', 'Aléa sur famille SNZ M2 224', master),
    explicit: resolveMesIdentity_('', '', 'Deux machines concernées : 1607025 et 1607026', master)
  };
})()`);
assert.deepEqual([...familyCommentMultipleImmos.family.immos], []);
assert.equal(familyCommentMultipleImmos.family.family, 'SNZ-M2-224');
assert.deepEqual([...familyCommentMultipleImmos.explicit.immos], []);
assert.equal(familyCommentMultipleImmos.explicit.method, 'IMMO_COMMENTAIRE_A_VERIFIER');

const strictMesCommentIdentity = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'SNZ-V3-040', SECTION: 'TC' },
    { IMMO: '1700002', FAMILLE: '107-V3-014', SECTION: 'TC' }
  ]);
  return {
    familyOnly: resolveMesIdentity_('', '', 'UPA SNZ V 040 non dispo au poste', master),
    measurements: resolveMesIdentity_('', '', 'je constate 3 desafleurements negatif mesure a 0 20 0 14 0 14 cadre 19 gauche 2 desafleurement negatif mesure a 0 12 0 13 cadre 17 gauche 1 desafleurement negatif mesure a 0 23 cadre 14 Gauche fixations montees Hilite', master),
    drilling: resolveMesIdentity_('', '', 'pNC generee Suite percages UPA presence de deux ovalisation 5 6M2 du aux pre percages de la virole non centre par rapport a la grille de percage', master)
  };
})()`);
assert.deepEqual([...strictMesCommentIdentity.familyOnly.immos], []);
assert.equal(strictMesCommentIdentity.familyOnly.family, 'SNZ-V3-040');
assert.deepEqual([...strictMesCommentIdentity.measurements.immos], []);
assert.equal(strictMesCommentIdentity.measurements.family, '');
assert.deepEqual([...strictMesCommentIdentity.drilling.immos], []);
assert.equal(strictMesCommentIdentity.drilling.family, '');

const ranking = evaluate(`topAggregates_({
  A: { label: 'A', total: 1, score: 1 },
  B: { label: 'B', total: 3, score: 3 },
  C: { label: 'C', total: 2, score: 2 }
}, 0, 'total')`);
assert.deepEqual([...ranking.map(item => item.label)], ['B', 'C', 'A']);

const reviewCosts = evaluate(`(() => {
  const target = {};
  addCostAggregate_(target, 'FAM-A', 600, 'NC');
  addCostAggregate_(target, 'FAM-A', 150, 'ALEA_MES');
  addCostAggregate_(target, 'FAM-B', 300, 'NC');
  return topCostAggregates_(target, 10);
})()`);
assert.equal(reviewCosts[0].label, 'FAM-A');
assert.equal(reviewCosts[0].cost, 750);
assert.equal(reviewCosts[0].NC, 600);
assert.equal(reviewCosts[0].ALEA_MES, 150);

const msnFilter = evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = APP.factsHeaders.map(header => header === 'MSN' ? '806' : '');
  return {
    exact: matchesFilters_(row, index, { msn: '806' }),
    other: matchesFilters_(row, index, { msn: '807' })
  };
})()`);
assert.deepEqual({ ...msnFilter }, { exact: true, other: false });

assert.ok(html.includes('data-view="overview"'));
assert.ok(html.includes('data-view="dashboard"'));
assert.ok(!html.includes('data-view="quality"'));
assert.ok(!html.includes('data-view="combinedAlea"'));
assert.ok(html.includes('NC selon les données disponibles · MES à 116 €/h d’indisponibilité'));
assert.ok(html.includes('id="msn"'));
assert.ok(html.includes('id="reviewSourceSwitch"'));
assert.ok(html.includes('data-review-source="NC"'));
assert.ok(html.includes('data-review-source="ALEA_MES"'));
assert.ok(html.includes('data-review-source="COMBINED"'));
assert.ok(html.includes('id="reviewFamilyCostChart"'));
assert.ok(html.includes('id="reviewImmoCostChart"'));
assert.ok(html.includes('id="reviewAvailabilityFamilyChart"'));
assert.ok(html.includes('class="station-picker" id="stationPicker"'));
assert.ok(!html.includes('id="stationSuggestions"'));
assert.ok(!html.includes('id="reviewMonthlyCostPerAircraftChart"'));
assert.ok(html.includes('IMMO cité dans MES'));
assert.ok(html.includes('BDD Immo et Famille'));
assert.ok(html.includes('Waterspiders'));
assert.ok(html.includes('BDD Aléas MES'));
assert.ok(html.includes('class="detail-sort"'));
assert.ok(html.includes('function sortDetailRows_'));

const audit = evaluate(`buildQualityAudit_({
  ALEA: { total: 10, identified: 9, masterMatched: 8, familyMatched: 8, commentsPresent: 4, downtimePresent: 0 },
  NC: emptyQualityCounter_(),
  ALEA_MES: { total: 4, identified: 2, masterMatched: 2, familyMatched: 3, commentsPresent: 4, downtimePresent: 1 }
}, { IMMO_COMMENTAIRE: 2, NON_TROUVE: 2 })`);
assert.equal(audit.sources[0].masterCoverage, 80);
assert.equal(audit.sources[2].familyCoverage, 75);
assert.equal(audit.mes.methods[0].count, 2);

const sourceQualityAudit = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' }
  ]);
  return buildRawSourceQualityAudit_('ALEA', 'Aléas production', 'Remontées aléas production', [
    { DATE: '2026-08-18', IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', POSTE: 'P280', QUANTITE: 2, HYPOTHESECAUSE: 'Cause' },
    { DATE: '2026-08-19', IMMO: '9999999', FAMILLE: '', SECTION: 'TC', POSTE: 'P280', QUANTITE: 1 },
    { DATE: '2026-08-20', IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'PA', POSTE: 'P280', QUANTITE: 1 },
    { DATE: '2026-08-21', IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', POSTE: 'P300', QUANTITE: 1 },
    { DATE: '', IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', POSTE: 'P280', QUANTITE: 'inconnu' }
  ], master, {}, APP.aliases.aleas);
})()`);
assert.equal(sourceQualityAudit.rawRows, 5);
assert.equal(sourceQualityAudit.rawQuantity, 6);
// TC ne filtre pas les postes des aléas production (APP.scope.stations vide) : seule la ligne PA est exclue.
assert.equal(sourceQualityAudit.retainedRows, 4);
assert.equal(sourceQualityAudit.retainedFacts, 4);
assert.equal(sourceQualityAudit.excludedRows, 1);
assert.equal(sourceQualityAudit.rates.retainedRows.percentage, 80);
assert.equal(sourceQualityAudit.immoProvided, 5);
assert.equal(sourceQualityAudit.immoMissing, 0);
assert.equal(sourceQualityAudit.immoUnrecognized, 1);
assert.equal(sourceQualityAudit.rates.dateComplete.percentage, 80);
assert.equal(sourceQualityAudit.quantityInvalid, 1);
assert.ok(!sourceQualityAudit.exclusions.some(item => item.code === 'IMMO_NON_RECONNU'));
assert.ok(sourceQualityAudit.exclusions.some(item => item.code === 'SECTION_HORS_PERIMETRE'));
assert.ok(!sourceQualityAudit.exclusions.some(item => item.code === 'POSTE_HORS_PERIMETRE'));

const unknownProductionImmo = evaluate(`(() => {
  const master = buildMasterIndex_([]);
  const target = [];
  appendFacts_(target, [{ DATE: '2026-08-19', IMMO: '9999999', SECTION: 'TC', POSTE: 'P280', ALEA: 'Incident' }], 'ALEA', APP.aliases.aleas, master, {}, 'Remontées aléas production');
  return { count: target.length, immo: target[0][4], inMaster: target[0][18] };
})()`);
assert.deepEqual({ ...unknownProductionImmo }, { count: 1, immo: '9999999', inMaster: false });

const productionSourceScope = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-PA', SECTION: 'PA', CATEGORIE: 'Outillage', JEU: 'P300' }
  ]);
  const target = [];
  appendFacts_(target, [
    { DATE: '2026-08-18', IMMO: '', SECTION: 'TC', POSTE: 280, ALEA: 'Sans IMMO' },
    { DATE: '2026-08-19', IMMO: '1700001', SECTION: 'TC', POSTE: 290.0, ALEA: 'Master hors périmètre' },
    { DATE: '2026-08-20', IMMO: '9999999', SECTION: 'TC', POSTE: '', ALEA: 'Poste absent' },
    { DATE: '2026-08-21', IMMO: '9999998', SECTION: '', POSTE: 280, ALEA: 'Section absente' },
    { DATE: '2026-08-22', IMMO: '9999997', SECTION: 'PA', POSTE: 280, ALEA: 'Section PA' }
  ], 'ALEA', APP.aliases.aleas, master, {}, 'Remontées aléas production');
  return target.map(row => ({ immo: row[4], section: row[9], station: row[10], problem: row[12] }));
})()`);
assert.equal(productionSourceScope.length, 2);
assert.deepEqual([...productionSourceScope.map(row => row.problem)], ['Sans IMMO', 'Master hors périmètre']);
assert.equal(evaluate("isAleaProductionSourceRowInScope_('TC', 280)"), true);
assert.equal(evaluate("isAleaProductionSourceRowInScope_('TC', 290.0)"), true);
assert.equal(evaluate("isAleaProductionSourceRowInScope_('TC', '')"), false);
assert.equal(evaluate("isAleaProductionSourceRowInScope_('', 280)"), false);
assert.equal(evaluate("assertAleaConsolidation_([{}], [APP.factsHeaders.map(header => header === 'SOURCE' ? 'ALEA' : '')])"), 1);
assert.throws(() => evaluate('assertAleaConsolidation_([{}], [])'), /préserver FAITS_IMMO/);
assert.throws(() => evaluate('assertAleaConsolidation_([], [])'), /ne contient aucune ligne/);

const ncWithoutImmoMachine = evaluate(`(() => {
  const master = buildMasterIndex_([]);
  const target = [];
  appendFacts_(target, [{ DATENC: '2026-08-18', NIMMO: '', MACHINE: 'P280 A', INDICATIONFAMILLE: 'FAM-SANS-IMMO', NC: 'NC-42', NBRNC: 2, QTE: 2, TYPOLOGIEDEFAUT: 'R1', CLENC: '46122' }], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const noMachine = [];
  appendFacts_(noMachine, [{ DATENC: '2026-08-18', NIMMO: '', NC: 'NC-43', NBRNC: 1, QTE: 1, CLENC: '46123' }], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const quality = buildRawSourceQualityAudit_('NC', 'NC historiques', 'Données NC PA', [
    { DATENC: '2026-08-18', NIMMO: '', MACHINE: 'P280 A', INDICATIONFAMILLE: 'FAM-SANS-IMMO', NC: 'NC-42', NBRNC: 2, QTE: 2 }
  ], master, {}, APP.aliases.nc);
  return {
    fact: target[0],
    noMachineFacts: noMachine.length,
    analysis: buildSourceAnalysis_(target, index, 'NC', {}, { activityMsn: null, drillingByFamily: {} }),
    quality
  };
})()`);
assert.equal(ncWithoutImmoMachine.fact[4], '');
assert.equal(ncWithoutImmoMachine.fact[5], 'FAM-SANS-IMMO');
assert.equal(ncWithoutImmoMachine.fact[10], 'P280 A');
assert.equal(ncWithoutImmoMachine.fact[26], 2);
assert.equal(ncWithoutImmoMachine.noMachineFacts, 0);
assert.equal(ncWithoutImmoMachine.analysis.kpis.total, 2);
assert.equal(ncWithoutImmoMachine.analysis.kpis.withoutImmoQuantity, 2);
assert.equal(ncWithoutImmoMachine.analysis.stations[0].label, 'P280 A');
assert.equal(ncWithoutImmoMachine.quality.retainedRows, 1);
assert.equal(ncWithoutImmoMachine.quality.retainedWithoutImmo, 1);
assert.equal(ncWithoutImmoMachine.quality.immoMissing, 1);
assert.equal(ncWithoutImmoMachine.quality.excludedRows, 0);

const ncWithoutImmoFamily = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-FAMILLE-SEULE', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' },
    { IMMO: '1700002', FAMILLE: 'FAM-FAMILLE-SEULE', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' }
  ]);
  const target = [];
  appendFacts_(target, [{ DATENC: '2026-08-18', NIMMO: '', INDICATIONFAMILLE: 'FAM-FAMILLE-SEULE', NC: 'NC-44', NBRNC: 1, QTE: 1, TYPOLOGIEDEFAUT: 'Délaminage', CLENC: '46124' }], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const quality = buildRawSourceQualityAudit_('NC', 'NC historiques', 'Données NC PA', [
    { DATENC: '2026-08-18', NIMMO: '', INDICATIONFAMILLE: 'FAM-FAMILLE-SEULE', NC: 'NC-44', NBRNC: 1, QTE: 1 }
  ], master, {}, APP.aliases.nc);
  return { fact: target[0], analysis: buildSourceAnalysis_(target, index, 'NC', {}, { activityMsn: null, drillingByFamily: {} }), quality };
})()`);
assert.equal(ncWithoutImmoFamily.fact[4], '');
assert.equal(ncWithoutImmoFamily.fact[5], 'FAM-FAMILLE-SEULE');
assert.equal(ncWithoutImmoFamily.fact[26], 1);
assert.equal(ncWithoutImmoFamily.analysis.kpis.total, 1);
assert.equal(ncWithoutImmoFamily.analysis.kpis.withoutImmoQuantity, 1);
assert.equal(ncWithoutImmoFamily.analysis.kpis.masterCoverage, 0);
assert.equal(ncWithoutImmoFamily.analysis.machines.length, 0);
assert.ok(ncWithoutImmoFamily.analysis.families.some(item => item.label === 'FAM-FAMILLE-SEULE'));
assert.equal(ncWithoutImmoFamily.quality.retainedRows, 1);
assert.equal(ncWithoutImmoFamily.quality.immoMissing, 1);
assert.equal(ncWithoutImmoFamily.quality.retainedWithoutImmo, 1);

const ncWithUnknownImmo = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-KNOWN', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' }
  ]);
  const record = { DATENC: '2026-04-30', SECTION: 'TC', NIMMO: '9999999', INDICATIONFAMILLE: 'FAM-UNKNOWN', NC: 'NC-S18', NBRNC: 1 };
  const target = [];
  appendFacts_(target, [record], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const quality = buildRawSourceQualityAudit_('NC', 'NC historiques', 'Données NC PA', [record], master, {}, APP.aliases.nc);
  return { fact: target[0], analysis: buildSourceAnalysis_(target, index, 'NC', {}, { activityMsn: null, drillingByFamily: {} }), quality };
})()`);
assert.equal(ncWithUnknownImmo.fact[4], '9999999');
assert.equal(ncWithUnknownImmo.fact[5], 'FAM-UNKNOWN');
assert.equal(ncWithUnknownImmo.fact[18], false);
assert.equal(ncWithUnknownImmo.fact[26], 1);
assert.equal(ncWithUnknownImmo.analysis.kpis.total, 1);
assert.equal(ncWithUnknownImmo.analysis.kpis.withoutImmoQuantity, 0);
assert.equal(ncWithUnknownImmo.analysis.kpis.masterCoverage, 0);
assert.ok(ncWithUnknownImmo.analysis.machines.some(item => item.label === '9999999'));
assert.equal(ncWithUnknownImmo.quality.retainedRows, 1);
assert.equal(ncWithUnknownImmo.quality.retainedFacts, 1);
assert.equal(ncWithUnknownImmo.quality.immoProvided, 1);
assert.equal(ncWithUnknownImmo.quality.immoUnrecognized, 1);
assert.equal(ncWithUnknownImmo.quality.excludedRows, 0);

const ncWeekS18 = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-KNOWN', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' }
  ]);
  const records = [];
  for (let position = 0; position < 9; position += 1) {
    const immo = position < 7 ? '1700001' : (position === 7 ? '9999998' : '9999999');
    const family = position < 7 ? 'FAM-KNOWN' : 'FAM-UNKNOWN';
    records.push({
      DATENC: '2026-04-27', SECTION: 'TC',
      NIMMO: immo,
      INDICATIONFAMILLE: family,
      NC: 'NC-S18-' + (position + 1), NBRNC: 1
    });
  }
  const target = [];
  appendFacts_(target, records, 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const consolidated = deduplicateFacts_(target);
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const quality = buildRawSourceQualityAudit_('NC', 'NC historiques', 'Données NC PA', records, master, {}, APP.aliases.nc);
  return { target: consolidated, analysis: buildSourceAnalysis_(consolidated, index, 'NC', {}, { activityMsn: null, drillingByFamily: {} }), quality };
})()`);
assert.equal(ncWeekS18.target.length, 9);
assert.equal(ncWeekS18.analysis.kpis.total, 9);
assert.deepEqual(ncWeekS18.analysis.trend.find(item => item[0] === '2026-S18'), ['2026-S18', 9]);
assert.equal(ncWeekS18.analysis.kpis.masterCoverage, 78);
assert.equal(ncWeekS18.quality.retainedRows, 9);
assert.equal(ncWeekS18.quality.retainedFacts, 9);
assert.equal(ncWeekS18.quality.immoUnrecognized, 2);
assert.equal(ncWeekS18.quality.excludedRows, 0);

const rawIdentityQuality = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', CATEGORIE: 'Perçage', JEU: 'P280' },
    { IMMO: '1700002', FAMILLE: 'FAM-PA', SECTION: 'PA', CATEGORIE: 'Perçage', JEU: 'P280' },
    { IMMO: '1700003', FAMILLE: 'FAM-OUTIL', SECTION: 'TC', CATEGORIE: 'Outillage', JEU: 'P280' }
  ]);
  return [
    evaluateRawSourceRecord_('ALEA', { IMMO: '1700001', FAMILLE: '', SECTION: 'TC', POSTE: 'P280' }, master, APP.aliases.aleas),
    evaluateRawSourceRecord_('ALEA', { IMMO: '', FAMILLE: '', SECTION: 'TC', POSTE: 'P280' }, master, APP.aliases.aleas),
    evaluateRawSourceRecord_('ALEA', { IMMO: '9999999', FAMILLE: '', SECTION: 'TC', POSTE: 'P280' }, master, APP.aliases.aleas),
    evaluateRawSourceRecord_('ALEA', { IMMO: '1700002', FAMILLE: '', SECTION: 'TC', POSTE: 'P280' }, master, APP.aliases.aleas),
    rawRecordMatchesQualityFilters_({ IMMO: '1700001', FAMILLE: '', SECTION: 'TC', POSTE: 'P280' }, APP.aliases.aleas, { family: 'FAM-A' }, master, 'ALEA')
  ];
})()`);
assert.equal(rawIdentityQuality[0].exclusionCode, '');
assert.equal(rawIdentityQuality[0].familyResolved, true);
assert.equal(rawIdentityQuality[1].exclusionCode, '');
assert.equal(rawIdentityQuality[1].retainedWithoutImmo, true);
assert.equal(rawIdentityQuality[2].exclusionCode, '');
assert.equal(rawIdentityQuality[3].exclusionCode, '');
assert.equal(rawIdentityQuality[4], true);

const mesIdentityQuality = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1700001', FAMILLE: 'FAM-A', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  return buildMesSourceQualityAudit_([
    { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '', IMMO_SOURCE: '', FAMILLE: '', SECTION: 'TC', QUANTITE: 1, COMMENTAIRE_INITIAL: '', METHODE_RAPPROCHEMENT: 'NON_TROUVE' },
    { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '9999999', IMMO_SOURCE: '9999999', FAMILLE: '', SECTION: 'TC', QUANTITE: 1, COMMENTAIRE_INITIAL: '', METHODE_RAPPROCHEMENT: 'IMMO_NON_RECONNU' },
    { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '1700001', IMMO_SOURCE: '1700001', FAMILLE: '', SECTION: 'TC', QUANTITE: 1, COMMENTAIRE_INITIAL: '', METHODE_RAPPROCHEMENT: 'IMMO_EXACT' }
  ], master, {}).bySource[0];
})()`);
assert.equal(mesIdentityQuality.rawRows, 3);
assert.equal(mesIdentityQuality.immoMissing, 1);
assert.equal(mesIdentityQuality.immoProvided, 2);
assert.equal(mesIdentityQuality.immoUnrecognized, 1);

const missingFamilyAggregate = evaluate(`(() => {
  const target = {};
  addAggregate_(target, missingFamilyLabel_(), 'ALEA_MES', 4, 4, 1.5);
  return target[missingFamilyLabel_()];
})()`);
assert.equal(missingFamilyAggregate.label, 'Famille non renseignée');
assert.equal(missingFamilyAggregate.ALEA_MES, 4);
assert.equal(missingFamilyAggregate.downtime, 1.5);

const mesFamilyCosts = evaluate(`(() => {
  const target = {};
  addMesFamilyCostAggregate_(target, '', 100, 'ALEA_MES');
  addMesFamilyCostAggregate_(target, 'FAM-A', 116, 'ALEA_MES');
  return Object.values(target);
})()`);
assert.deepEqual([...mesFamilyCosts], [{ label: 'FAM-A', family: '', NC: 0, ALEA_MES: 116, cost: 116 }]);

const availabilityAggregates = evaluate(`(() => {
  const target = {};
  addAvailabilityAggregate_(target, 'FAM-A', '0911 Manquant Absent Non Disponible', 'ALEA_MES', 2, 2, 1.5);
  addAvailabilityAggregate_(target, 'FAM-A', '0915 Casse Endommage Inutilisable', 'ALEA_MES', 3, 3, 2);
  addAvailabilityAggregate_(target, '', '0912', 'ALEA_MES', 4, 4, 2);
  return Object.values(target);
})()`);
assert.deepEqual([...availabilityAggregates], [{
  label: 'FAM-A', ALEA: 0, NC: 0, ALEA_MES: 2,
  total: 2, score: 2, downtime: 1.5, family: 'FAM-A',
  problems: ['0911 Manquant Absent Non Disponible']
}]);
assert.equal(evaluate("isAvailabilityMesProblem_('0911 Manquant Absent Non Disponible')"), true);
assert.equal(evaluate("isAvailabilityMesProblem_('0915 Casse Endommage Inutilisable')"), false);
assert.equal(evaluate("isAvailabilityMesProblem_('0956 NOK Performance')"), false);
const availabilityEvidence = evaluate(`buildMesEvidenceQuality_([
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', PROBLEME: '0911 Manquant Absent Non Disponible', FAMILLE: 'FAM-A', IMMO: '1700001', IMMO_SOURCE: '1700001', METHODE_RAPPROCHEMENT: 'IMMO_EXACT' },
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', PROBLEME: '0915 Casse Endommage Inutilisable', FAMILLE: 'FAM-A', IMMO: '1700001', IMMO_SOURCE: '1700001', METHODE_RAPPROCHEMENT: 'IMMO_EXACT' }
], {}, isAvailabilityMesProblem_)`);
assert.equal(availabilityEvidence.events, 1);
assert.equal(availabilityEvidence.immoCited, 1);
const availabilityDetailSelection = evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = values => APP.factsHeaders.map(header => values[header] || '');
  const matching = row({ FAMILLE: 'FAM-A', PROBLEME: '0911 Manquant Absent Non Disponible' });
  const otherFamily = row({ FAMILLE: 'FAM-B', PROBLEME: '0911 Manquant Absent Non Disponible' });
  const otherProblem = row({ SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', FAMILLE: 'FAM-A', PROBLEME: '0915 Casse Endommage Inutilisable' });
  matching[index.SOURCE] = 'ALEA_MES';
  otherFamily[index.SOURCE] = 'ALEA_MES';
  const selection = {
    dimension: 'availability', value: 'FAM-A', family: 'FAM-A'
  };
  return [matchesDetailSelection_(matching, index, selection), matchesDetailSelection_(otherFamily, index, selection), matchesDetailSelection_(otherProblem, index, selection)];
})()`);
assert.deepEqual([...availabilityDetailSelection], [true, false, false]);

const missingDetailLabels = evaluate(`(() => {
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  const row = APP.factsHeaders.map(() => '');
  return ['station:Poste inconnu', 'machineType:Type non renseigné', 'category:Catégorie non renseignée', 'problem:Non renseigné']
    .map(entry => {
      const [dimension, value] = entry.split(':');
      return matchesDetailSelection_(row, index, { dimension, value });
    });
})()`);
assert.deepEqual([...missingDetailLabels], [true, true, true, true]);

const trendQuality = evaluate(`buildTrendQuality_([
  ['2026-S01', 2, 1, 8],
  ['2026-S02', 3, 1, 10],
  ['2026-S03', 2, 1, 424],
  ['2026-S04', 2, 1, 9]
])`);
assert.equal(trendQuality.mes.peak.week, '2026-S03');
assert.equal(trendQuality.mes.peak.value, 424);
assert.equal(trendQuality.mes.alerts[0].ratio, 44.6);
assert.equal(trendQuality.mes.alerts[0].week, '2026-S03');
const rawTrendQuality = evaluate(`buildTrendQuality_([
  ['2026-S03', 3, 1, 2]
], { byWeek: [{ label: '2026-S01', quantity: 8 }, { label: '2026-S02', quantity: 10 }, { label: '2026-S03', quantity: 424 }] })`);
assert.equal(rawTrendQuality.mes.peak.value, 424);
assert.equal(rawTrendQuality.mes.rawQuantity, true);
assert.equal(rawTrendQuality.mes.alerts[0].week, '2026-S03');

const mesPeakDiagnostic = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildMesPeakDiagnostics_([
    row({ ID_EVENEMENT: 'ALEA_MES-MES-1', DATE: new Date('2026-01-13'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1700001', FAMILLE: 'FAM-A', QUANTITE: 424, FICHIER_SOURCE: 'mes.xlsx', RAPPROCHEMENT_MES: 'IMMO_EXACT' }),
    row({ ID_EVENEMENT: 'ALEA_MES-MES-2', DATE: new Date('2026-01-14'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1700002', FAMILLE: '', QUANTITE: 2, FICHIER_SOURCE: 'mes.xlsx', RAPPROCHEMENT_MES: 'FAMILLE_COMMENTAIRE' })
  ], index, [
    { ID_EVENEMENT: 'MES-1', FICHIER_ID: 'file-1', FICHIER_NOM: 'mes.xlsx', IMMO: '1700001', FAMILLE: 'FAM-A', METHODE_RAPPROCHEMENT: 'IMMO_EXACT' },
    { ID_EVENEMENT: 'MES-2', FICHIER_ID: 'file-1', FICHIER_NOM: 'mes.xlsx', IMMO: '1700002', FAMILLE: 'FAM-B', METHODE_RAPPROCHEMENT: 'FAMILLE_COMMENTAIRE' }
  ]);
})()`);
assert.equal(mesPeakDiagnostic.peak.week, '2026-S03');
assert.equal(mesPeakDiagnostic.peak.quantity, 426);
assert.equal(mesPeakDiagnostic.byFile[0].label, 'mes.xlsx');
assert.equal(mesPeakDiagnostic.byFileId[0].label, 'file-1');
assert.equal(mesPeakDiagnostic.byMethod[0].label, 'IMMO_EXACT');
assert.equal(mesPeakDiagnostic.records[0].quantity, 424);
const mesImpactQuantity = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  const mes = row({ SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', QUANTITE: 424 });
  const production = row({ SOURCE: 'ALEA', QUANTITE: 3 });
  return {
    mesImpact: factQuantity_(mes, index),
    mesRaw: rawMesQuantity_(mes, index),
    productionImpact: factQuantity_(production, index)
  };
})()`);
assert.equal(mesImpactQuantity.mesImpact, 1);
assert.equal(mesImpactQuantity.mesRaw, 424);
assert.equal(mesImpactQuantity.productionImpact, 3);
assert.equal(evaluate(`(() => {
  const exact = { ID_EVENEMENT: 'MES-1', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', FICHIER_NOM: 'exact.xlsx' };
  const prefix = { ID_EVENEMENT: 'MES-10', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', FICHIER_NOM: 'prefix.xlsx' };
  return findMesStagingRowForFact_('ALEA_MES-MES-1', [prefix, exact]).FICHIER_NOM;
})()`), 'exact.xlsx');
assert.equal(evaluate("findMesStagingRowForFact_('ALEA_MES-MES-1-abcdef12', [{ ID_EVENEMENT: 'MES-10', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', FICHIER_NOM: 'wrong.xlsx' }]).FICHIER_NOM"), undefined);

assert.equal(evaluate("parseDurationHours_('0-01:30:00')"), 1.5);
assert.equal(evaluate("parseDurationHours_('00:30:00')"), 0.5);
assert.equal(evaluate("parseDurationHours_('0,02083333333333333', { spreadsheetDays: true })"), 0.5);
assert.equal(evaluate("parseDurationHours_('2-01:15:00')"), 49.25);
assert.equal(evaluate('parseDurationHours_(154.6833333333)'), 154.6833333333);
assert.ok(Math.abs(evaluate('parseDurationHours_(0.0208333333333, { spreadsheetDays: true })') - 0.5) < 1e-9);
assert.equal(evaluate('parseDurationHours_(new Date(2026, 0, 1, 0, 30, 0))'), 0.5);
assert.equal(evaluate("parseDurationHours_(pick_({ TEMPASALEAS: '1:30:00' }, APP.aliases.mes.durationHours))"), 1.5);

const newMesExport = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC' }
  ]);
  const table = [
    ['ID ticket', "Date d'ouverture", '5M', 'Objet', 'Unité', 'Attribut', 'Poste / MFT', 'Temps aléas', 'Commentaire MES', 'N° NC', 'MSN_MES'],
    ['DZ-MES-1', '2026-08-18 10:00:00', '03-Moyens', '0328 UPA MEDU', 'Structure TC A350', '0911 Manquant', 'P290', '00:30:00', 'UPA 1710288', '', '700'],
    ['DZ-NC-1', '2026-08-18 11:00:00', '01-Matière', '0111 Articles Composants Pieces', 'Structure TC A350', '0914 Non Conforme', 'P280', 0.0208333333333, 'NC 1710288', 'NC-42', '701'],
    ['DZ-OTHER', '2026-08-18 12:00:00', '03-Moyens', '0337 IHM', 'Structure TC A350', '0911 Manquant', 'P290', '0:30:00', 'autre', '', '702'],
    ['DZ-TC', '2026-08-18 13:00:00', '03-Moyens', '0328 UPA MEDU', 'Structure PA A350', '0911 Manquant', 'P290', '0:30:00', 'UPA 1710288', '', '703']
  ];
  return tableToMesRecords_(table, { getId: () => 'file-new', getName: () => 'nouvelle-base.xlsx' }, master);
})()`);
assert.equal(newMesExport.length, 2);
assert.equal(newMesExport[0][16], 'ALEA_MES');
assert.equal(newMesExport[0][13], 0.5);
assert.equal(newMesExport[0][6], 'P290');
assert.equal(newMesExport[1][16], 'NC');
assert.equal(newMesExport[1][17], 'NC-42');
assert.equal(newMesExport[1][18], 1);
assert.ok(Math.abs(newMesExport[1][13] - 0.5) < 1e-9);
const mesFamilyStaging = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  return tableToMesRecords_([
    ['ID ticket', "Date d'ouverture", '5M', 'Objet', 'Unité', 'Attribut', 'Temps aléas', 'Commentaire MES', 'MSN_MES'],
    ['DZ-FAMILY', '2026-08-18', '03-Moyens', '0328 UPA MEDU', 'Structure TC A350', '0913 En panne', '00:30:00', 'Famille 401 M2 008', '700']
  ], { getId: () => 'file-family', getName: () => 'family.xlsx' }, master)[0];
})()`);
assert.equal(mesFamilyStaging[2], '');
assert.equal(mesFamilyStaging[3], '401-M2-008-A-P2-3.2');
assert.equal(mesFamilyStaging[15], 'FAMILLE_COMMENTAIRE');
assert.equal(mesFamilyStaging[22], '');

const mesEvidenceQuality = evaluate(`buildMesEvidenceQuality_([
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '', FAMILLE: 'FAM-A', MSN: '700', METHODE_RAPPROCHEMENT: 'FAMILLE_COMMENTAIRE', IMMO_SOURCE: '', FAMILLE_SOURCE: '' },
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '1710288', FAMILLE: 'FAM-A', MSN: '701', METHODE_RAPPROCHEMENT: 'IMMO_COMMENTAIRE_EXACT', IMMO_SOURCE: '', FAMILLE_SOURCE: '' },
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '', FAMILLE: '', MSN: '702', METHODE_RAPPROCHEMENT: 'NON_TROUVE', IMMO_SOURCE: '', FAMILLE_SOURCE: '' }
], {})`);
assert.deepEqual({ ...mesEvidenceQuality }, {
  events: 3, immoCited: 1, immoMissing: 2, familyCited: 1, msnCited: 3,
  immoCoverage: 33.3, familyCoverage: 33.3, msnCoverage: 100
});
assert.equal(evaluate(`buildMesEvidenceQuality_([
  { SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', MSN: '700', METHODE_RAPPROCHEMENT: 'IMMO_COMMENTAIRE' }
], { source: 'NC' }).events`), 0);
assert.equal(evaluate('APP.parameterDefaults.ID_FICHIER_PLANNING_MSN'), '1UFoE2rUJmJy_KM77JRUAAl_ffhgz9rh7JJt3wcUVf_Y');

const mesStatusFilter = evaluate(`(() => {
  const master = buildMasterIndex_([]);
  const table = [
    ['ID ticket', "Date d'ouverture", '5M', 'Objet', 'Unité', 'Attribut', 'Station physique MES', 'Temps aléas', 'Commentaire MES', 'N° NC', 'Statut'],
    ['DZ-ACTIVE', '2026-08-18 10:00:00', '01-Matière', '0111 Articles Composants Pieces', 'Structure TC A350', '0914 Non Conforme', 'P280 A', '00:30:00', 'NC active', 'NC-1', 'Clôturé'],
    ['DZ-DELETED', '2026-08-18 11:00:00', '01-Matière', '0111 Articles Composants Pieces', 'Structure TC A350', '0914 Non Conforme', 'P280 A', '00:30:00', 'NC supprimée', 'NC-2', 'Supprimé'],
    ['DZ-REJECTED', '2026-08-18 12:00:00', '03-Moyens', '0328 UPA MEDU', 'Structure TC A350', '0911 Manquant', 'P290 A', '00:30:00', 'Aléa rejeté', '', 'Rejeté']
  ];
  return tableToMesRecords_(table, { getId: () => 'file-status', getName: () => 'status.xlsx' }, master);
})()`);
assert.equal(mesStatusFilter.length, 1);
assert.equal(evaluate("isMesPreNcRow_({ SOURCE: 'NC', NC_NUMERO: '', INTITULE_MES: 'NC : Elements ou pieces fournisseurs', STATUT_MES: 'En attente' })"), true);
assert.equal(evaluate("isMesPreNcRow_({ SOURCE: 'NC', NC_NUMERO: 'NC-42', INTITULE_MES: 'NC : Elements ou pieces fournisseurs', STATUT_MES: 'En attente' })"), true);
assert.equal(evaluate("isMesPreNcRow_({ SOURCE: 'NC', NC_NUMERO: '', INTITULE_MES: 'Retouches à poste (sans NC)', STATUT_MES: 'En attente' })"), false);
assert.equal(evaluate("mesPreNcHeaders_()[2]"), 'NC_NUMERO');
const ncWorkflowOrder = evaluate(`sortNcRowsDescending_([
  { NC_NUMERO: '2161', ID_EVENEMENT: 'a' },
  { NC_NUMERO: '', ID_EVENEMENT: 'b' },
  { NC_NUMERO: '216649357', ID_EVENEMENT: 'c' },
  { NC_NUMERO: '2162', ID_EVENEMENT: 'd' }
]).map(row => row.NC_NUMERO)`);
assert.deepEqual([...ncWorkflowOrder], ['216649357', '2162', '2161', '']);
assert.deepEqual([...evaluate("mesPreNcHiddenWorkflowStatuses_(['A_COMPLETER', 'A_CORRIGER'])")], ['SOUMIS', 'VALIDEE', 'REJETEE']);

const businessDeduplication = evaluate(`(() => {
  const row = values => APP.factsHeaders.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  const rows = deduplicateFacts_([
    row({ ID_EVENEMENT: 'NC-PA-1', SOURCE: 'NC', NC_NUMERO: '2161', IMMO: '1710288', FAMILLE: 'FAM-NC-PA', POSTE: 'P280', COMMENTAIRE: 'Source NC PA', FICHIER_SOURCE: 'Données NC PA' }),
    row({ ID_EVENEMENT: 'NC-MES-1', SOURCE: 'NC', NC_NUMERO: '2161', DATE: '2026-08-18', RAPPROCHEMENT_MES: 'NC_MES_NUMERO', COMMENTAIRE: 'Source MES', FICHIER_SOURCE: 'mes.xlsx' }),
    row({ ID_EVENEMENT: 'ALEA-1', SOURCE: 'ALEA', DATE: '2026-08-18', IMMO: '1710288', COMMENTAIRE: 'Incident commun' }),
    row({ ID_EVENEMENT: 'MES-1', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', DATE: '2026-08-18', IMMO: '1710288', COMMENTAIRE: 'Incident commun' })
  ]);
  return rows.map(item => ({ id: item[0], source: item[3], nc: item[25], immo: item[4], family: item[5], station: item[10], files: item[19] }));
})()`);
assert.equal(businessDeduplication.length, 3);
const mergedNc = businessDeduplication.find(item => item.nc === '2161');
assert.equal(mergedNc.files, 'Données NC PA + mes.xlsx');
assert.equal(mergedNc.immo, '1710288');
assert.equal(mergedNc.family, 'FAM-NC-PA');
assert.equal(mergedNc.station, 'P280');
assert.equal(businessDeduplication.find(item => item.source === 'ALEA').id, 'ALEA-1');
assert.equal(businessDeduplication.find(item => item.source === 'ALEA_MES').id, 'MES-1');

const distinctProductionEvents = evaluate(`(() => {
  const row = values => APP.factsHeaders.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return deduplicateFacts_([
    row({ ID_EVENEMENT: 'ALEA-1', SOURCE: 'ALEA', DATE: '2026-08-18', IMMO: '1710288', COMMENTAIRE: 'Incident commun', NC_NUMERO: '217001065' }),
    row({ ID_EVENEMENT: 'ALEA-2', SOURCE: 'ALEA', DATE: '2026-08-18', IMMO: '1710288', COMMENTAIRE: 'Incident commun', NC_NUMERO: '217001065' })
  ]).map(item => item[0]);
})()`);
assert.deepEqual([...distinctProductionEvents], ['ALEA-1', 'ALEA-2']);

const crossSourceNcDeduplication = evaluate(`(() => {
  const row = values => APP.factsHeaders.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return deduplicateFacts_([
    row({ ID_EVENEMENT: 'NC-source-1', SOURCE: 'NC', NC_NUMERO: '2170', IMMO: '1700001', FAMILLE: 'FAM-NC', POSTE: 'P280' }),
    row({ ID_EVENEMENT: 'ALEA-source-1', SOURCE: 'ALEA', NC_NUMERO: '2170', IMMO: '1700002', FAMILLE: 'FAM-ALEA', POSTE: 'P290' })
  ]).map(item => ({ id: item[0], source: item[3], nc: item[25], immo: item[4] }));
})()`);
assert.equal(crossSourceNcDeduplication.length, 2);
assert.deepEqual([...crossSourceNcDeduplication.map(item => item.source)].sort(), ['ALEA', 'NC']);
assert.deepEqual([...crossSourceNcDeduplication.map(item => item.immo)].sort(), ['1700001', '1700002']);

const multiImmoNcDeduplication = evaluate(`(() => {
  const row = values => APP.factsHeaders.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  const rows = deduplicateFacts_([
    row({ ID_EVENEMENT: 'NC-duplicate-a', SOURCE: 'NC', NC_NUMERO: '2162', IMMO: '1700001', QUANTITE: 1, NB_NC: 1 }),
    row({ ID_EVENEMENT: 'NC-duplicate-b', SOURCE: 'NC', NC_NUMERO: '2162', IMMO: '1700002', QUANTITE: 1, NB_NC: 1 }),
    row({ ID_EVENEMENT: 'NC-split-a1b2c3d4', SOURCE: 'NC', NC_NUMERO: '2163', IMMO: '1700003', QUANTITE: 0.5, NB_NC: 0.5 }),
    row({ ID_EVENEMENT: 'NC-split-b1c2d3e4', SOURCE: 'NC', NC_NUMERO: '2163', IMMO: '1700004', QUANTITE: 0.5, NB_NC: 0.5 })
  ]);
  return {
    duplicate: rows.filter(item => item[25] === '2162'),
    split: rows.filter(item => item[25] === '2163')
  };
})()`);
assert.equal(multiImmoNcDeduplication.duplicate.length, 2);
assert.equal(multiImmoNcDeduplication.duplicate.reduce((sum, row) => sum + row[26], 0), 1);
assert.equal(multiImmoNcDeduplication.split.length, 2);
assert.equal(multiImmoNcDeduplication.split.reduce((sum, row) => sum + row[26], 0), 1);
assert.equal(evaluate("sourceAnalysisOrigin_('NC').sourceSheet"), 'Données NC TC');
assert.equal(evaluate("sourceAnalysisOrigin_('ALEA').sourceSheet"), 'Remontées aléas production');

const legacyNcEnrichment = evaluate(`(() => {
  const target = [];
  // readRecords_ normalise les en-têtes avant appendFacts_ : on reproduit ce format.
  const normalizedRecord = record => Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeHeader_(key), value]));
  appendFacts_(target, [
    normalizedRecord({
      'Date NC': '2026-08-18', 'N° Immo': '1799999', Machine: 'P290 C', EAP: 'TC',
      'Indication Famille': 'FAM-ANCIENNE', NC: '2161', 'Nbr NC': 1, 'Qté': 1620,
      'Typologie défaut': 'Défaut source', Commentaire: 'R1', 'Commentaires Qualité': 'upa revenant de maintenance avec 1620 unites'
    })
  ], 'NC', APP.aliases.nc, buildMasterIndex_([
    { IMMO: '1799999', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]), { POIDS_NC: '5' }, 'Données NC PA');
  return target[0];
})()`);
assert.equal(legacyNcEnrichment[4], '1799999');
assert.equal(legacyNcEnrichment[5], 'FAM-ANCIENNE');
assert.equal(legacyNcEnrichment[10], 'P290 C');
assert.equal(legacyNcEnrichment[13], 1620);
assert.equal(legacyNcEnrichment[24], 'R1');
assert.equal(legacyNcEnrichment[28], 'upa revenant de maintenance avec 1620 unites');
assert.equal(legacyNcEnrichment[18], true);

const preservedNcWorkflow = evaluate(`mergeMesPreNcWorkflowFields_(
  { ID_EVENEMENT: 'MES-1', NC_NUMERO: '216649357', IMMO: '', FAMILLE: 'FAM-MES' },
  { ID_EVENEMENT: 'MES-1', NC_NUMERO: 'NC-2026-42', IMMO_SAISI: '1799999', FAMILLE_SAISIE: '', COMMENTAIRE_PREPARATION: 'Contrôle effectué', STATUT_WORKFLOW: 'SOUMIS', SOUMIS_PAR: 'qualite@example.com' }
)`);
assert.equal(preservedNcWorkflow.NC_NUMERO, '216649357');
assert.equal(preservedNcWorkflow.IMMO_SAISI, '1799999');
assert.equal(preservedNcWorkflow.STATUT_WORKFLOW, 'SOUMIS');
assert.equal(preservedNcWorkflow.SOUMIS_PAR, 'qualite@example.com');

const validatedNcWithoutNumber = evaluate(`(() => {
  const target = [];
  const rows = validatedMesPreNcRows_([{
    ID_EVENEMENT: 'MES-NC-1', DATE: '2026-08-18', IMMO: '', FAMILLE: '',
    IMMO_SAISI: '1799999', FAMILLE_SAISIE: '', POSTE: 'P290 C',
    SECTION: 'Structure TC A350', CATEGORIE: '01-Matière', PROBLEME: 'Défaut contrôlé',
    QUANTITE: 1, TEMPS_PERDU_HEURES: 0.5, COMMENTAIRE_INITIAL: 'Pièce vérifiée',
    COMMENTAIRE_PREPARATION: 'Validé par contrôle', FICHIER_NOM: 'mes.xlsx',
    METHODE_RAPPROCHEMENT: 'IMMO_NON_RECONNU', SOURCE: 'NC', NC_NUMERO: '',
    NB_NC: '', MSN: '701', STATUT_WORKFLOW: 'VALIDEE'
  }]);
  appendStagedMesFacts_(target, rows, buildMasterIndex_([]), { POIDS_NC: '5', COUT_HEURE_PERDUE_EUR: '100' });
  return target[0];
})()`);
assert.equal(validatedNcWithoutNumber[3], 'NC');
assert.equal(validatedNcWithoutNumber[4], '1799999');
assert.equal(validatedNcWithoutNumber[22], 'IMMO_NON_RECONNU + NC_QUALITE_VALIDEE');
assert.equal(validatedNcWithoutNumber[21], 0.5);

const qlikMesExport = evaluate(`(() => {
  const master = buildMasterIndex_([]);
  const table = [
    ['ID ticket', "Date d'ouverture", 'MSN_MES', 'Temps aléas', 'Groupe de résolution', 'Intitulés', 'Sévérité', 'Statut', 'Station physique MES', 'Commentaire MES'],
    ['DZ2154194', '2026-08-19 20:55:15', '859', '00:30:00', '350 Coord Technique 280AB', 'NC : Eléments ou pièces fournisseurs', 'Perturbé', 'Clôturé', 'P280 A', '1 R1 sur le pelle titane lisse 8 GS']
  ];
  return tableToMesRecords_(table, { getId: () => 'file-qlik', getName: () => 'qlik.xlsx' }, master);
})()`);
assert.equal(qlikMesExport.length, 1);
assert.equal(qlikMesExport[0][6], 'P280 A');
assert.equal(qlikMesExport[0][16], 'ALEA_MES');
assert.equal(qlikMesExport[0][13], 0.5);
assert.equal(evaluate("hasAuthoritativeManualNc_([{ SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens' }, { SOURCE: 'NC' }])"), true);
assert.equal(evaluate("hasAuthoritativeManualNc_([{ SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens' }])"), false);

const consolidatedMesSources = evaluate(`(() => {
  const target = [];
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC' }
  ]);
  appendStagedMesFacts_(target, [
    {
      ID_EVENEMENT: 'MES-1', DATE: '2026-08-18', IMMO: '1710288', FAMILLE: '',
      TYPE_MACHINE: '0328 UPA MEDU', SECTION: 'Structure TC A350', POSTE: 'P290',
      CATEGORIE: '03-Moyens', PROBLEME: '0911', QUANTITE: 1,
      FICHIER_NOM: 'nouvelle-base.xlsx', TEMPS_PERDU_HEURES: 1,
      COMMENTAIRE_INITIAL: '', METHODE_RAPPROCHEMENT: 'IMMO_EXACT',
      NC_NUMERO: '', NB_NC: '', MSN: '700', SOURCE: 'ALEA_MES'
    },
    {
      ID_EVENEMENT: 'MES-BOX', DATE: '2026-08-18', IMMO: '1710288', FAMILLE: '',
      TYPE_MACHINE: '0328 UPA MEDU', SECTION: 'Structure TC A350', POSTE: 'P290',
      CATEGORIE: '03-Moyens', PROBLEME: '0912', QUANTITE: 1,
      FICHIER_NOM: 'nouvelle-base.xlsx', TEMPS_PERDU_HEURES: 1,
      COMMENTAIRE_INITIAL: 'Incident Box EDU', METHODE_RAPPROCHEMENT: 'IMMO_EXACT',
      NC_NUMERO: '', NB_NC: '', MSN: '700', SOURCE: 'ALEA_MES'
    },
    {
      ID_EVENEMENT: 'MES-VPC', DATE: '2026-08-18', IMMO: '1710288', FAMILLE: '',
      TYPE_MACHINE: '0328 UPA MEDU', SECTION: 'Structure TC A350', POSTE: 'P290',
      CATEGORIE: '03-Moyens', PROBLEME: '0913', QUANTITE: 1,
      FICHIER_NOM: 'nouvelle-base.xlsx', TEMPS_PERDU_HEURES: 1,
      COMMENTAIRE_INITIAL: 'VPC13 affichage bloque', METHODE_RAPPROCHEMENT: 'IMMO_EXACT',
      NC_NUMERO: '', NB_NC: '', MSN: '700', SOURCE: 'ALEA_MES'
    },
    {
      ID_EVENEMENT: 'NC-1', DATE: '2026-08-18', IMMO: '1710288', FAMILLE: '',
      TYPE_MACHINE: '0111 Articles Composants Pieces', SECTION: 'Structure TC A350', POSTE: 'P280',
      CATEGORIE: '01-Matière', PROBLEME: '0914', QUANTITE: 1,
      FICHIER_NOM: 'nouvelle-base.xlsx', TEMPS_PERDU_HEURES: 1.5,
      COMMENTAIRE_INITIAL: '', METHODE_RAPPROCHEMENT: 'IMMO_EXACT',
      NC_NUMERO: 'NC-42', NB_NC: 3, MSN: '701', SOURCE: 'NC', STATUT_WORKFLOW: 'VALIDEE'
    }
  ], master, { POIDS_NC: '5', POIDS_ALEA_MES: '1', COUT_HEURE_PERDUE_EUR: '100' });
  return target.map(row => [row[3], row[13], row[17], row[25], row[26], row[27], row[15], row[16], row[21]]);
})()`);
assert.equal(JSON.stringify(consolidatedMesSources), JSON.stringify([
  ['ALEA_MES', 1, 1, '', '', '700', 100, true, 1],
  ['NC', 3, 5, 'NC-42', 3, '701', 150, true, 1.5]
]));
assert.equal(evaluate("isMesTimeAnalysisRow_({ DATE: '2026-08-18', CATEGORIE: '03-Moyens' }, new Date('2026-09-01'))"), true);
assert.equal(evaluate("isMesTimeAnalysisRow_({ DATE: '2026-08-18', CATEGORIE: '01-Matière' }, new Date('2026-09-01'))"), false);
assert.equal(evaluate("isMesTimeAnalysisRow_({ DATE: '2024-08-31', CATEGORIE: '03-Moyens' }, new Date('2026-09-01'))"), false);

const mesFamilyWithoutImmo = evaluate(`(() => {
  const target = [];
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC', CATEGORIE: 'Perçage' },
    { IMMO: '1710289', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC', CATEGORIE: 'Perçage' }
  ]);
  appendStagedMesFacts_(target, [{
    ID_EVENEMENT: 'MES-FAMILY', DATE: '2026-08-18', IMMO: '', FAMILLE: '401-M2-008-A-P2-3.2',
    TYPE_MACHINE: '0328 UPA MEDU', SECTION: 'Structure TC A350', POSTE: 'P290',
    QUANTITE: 1, TEMPS_PERDU_HEURES: 1, COMMENTAIRE_INITIAL: '', SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens'
  }], master, { POIDS_ALEA_MES: '1', COUT_HEURE_PERDUE_EUR: '100' });
  return target.map(row => ({ immo: row[4], family: row[5], cost: row[15], method: row[22] }));
})()`);
assert.deepEqual([...mesFamilyWithoutImmo], [{ immo: '', family: '401-M2-008-A-P2-3.2', cost: 100, method: 'FAMILLE_EXACTE' }]);

const unvalidatedNcMes = evaluate(`(() => {
  const target = [];
  appendStagedMesFacts_(target, [{
    ID_EVENEMENT: 'NC-SOUMIS', DATE: '2026-08-18', IMMO: '1710288', SECTION: 'Structure TC A350',
    QUANTITE: 1, NB_NC: 1, NC_NUMERO: 'NC-43', SOURCE: 'NC', STATUT_WORKFLOW: 'SOUMIS'
  }], buildMasterIndex_([]), { POIDS_NC: '5' });
  return target.length;
})()`);
assert.equal(unvalidatedNcMes, 0);

const legacyMigration = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1710288', FAMILLE: '401-M2-008-A-P2-3.2', SECTION: 'TC' }
  ]);
  const rows = [
    ['Ref', 'Who raise', 'When', 'Issue', 'Action', 'Resp.', 'Due', 'Status', 'Priorité', 'Comment'],
    [283, 'MFT', new Date('2026-08-01'), 'IMMO 1710288 – récurrence', 'Analyser', 'Pilote', new Date('2026-08-31'), 'Open', 1, '[DASHBOARD:abc] Historique']
  ];
  const range = {
    getValues: () => rows.map(row => row.slice()),
    getDisplayValues: () => rows.map(row => row.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '')))
  };
  return parseLegacyMftActions_({
    name: 'MFT ALEAS MACHINES PA 23072026',
    meetingDate: new Date('2026-07-23'),
    sheet: { getDataRange: () => range }
  }, master)[0];
})()`);
assert.equal(legacyMigration.id, 'abc');
assert.equal(legacyMigration.immo, '1710288');
assert.equal(legacyMigration.famille, '401-M2-008-A-P2-3.2');
assert.equal(legacyMigration.rapprochementIdentite, 'IMMO_MASTER_EXACT');
assert.equal(legacyMigration.statut, 'En cours');

const normalizedMft = evaluate(`(() => {
  const existing = {
    id: 'a1', refMft: '283', dateCreation: new Date('2026-08-01'), demandeur: 'MFT',
    immo: '1710288', famille: 'F1', constat: 'C', decision: 'D', responsable: 'R',
    echeanceInitiale: new Date('2026-08-31'), statut: 'En cours', priorite: '2',
    sourceCreation: 'DASHBOARD_PA', creePar: 'Pilote'
  };
  const built = buildOfficialMftRecord_({ id: 'a1', statut: 'Fait' }, existing, {
    id: 'a1', nextRef: 999, now: new Date('2026-08-20'), user: 'Auditeur'
  });
  return {
    record: built.record,
    typeSuivi: built.typeSuivi,
    displayedLate: displayedMftStatus_({ statut: 'En cours', echeanceEffective: '2000-01-01' }),
    displayedYearOnly: displayedMftStatus_({ statut: 'En cours', echeanceEffective: '2025' }),
    deferred: normalizeMftStatus_('Deferred'),
    headers: mftOfficialActionsHeaders_()
  };
})()`);
assert.equal(normalizedMft.record.statut, 'Fait');
assert.equal(normalizedMft.record.immo, '1710288');
assert.equal(normalizedMft.record.decision, 'D');
assert.equal(normalizedMft.record.refMft, '283');
assert.equal(new Date(normalizedMft.record.echeanceInitiale).toISOString().slice(0, 10), '2026-08-31');
assert.equal(normalizedMft.typeSuivi, 'CHANGEMENT_STATUT');
assert.equal(normalizedMft.displayedLate, 'En retard');
assert.equal(normalizedMft.displayedYearOnly, 'En cours');
assert.equal(normalizedMft.deferred, 'Reporté');
assert.ok(normalizedMft.headers.includes('ECHEANCE_INITIALE'));
assert.ok(normalizedMft.headers.includes('RAPPROCHEMENT_IDENTITE'));

const normalizedUpsert = evaluate(`(() => {
  const rows = [mftOfficialActionsHeaders_().slice()];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (row, column, rowCount, columnCount) => ({
      getDisplayValues: () => rows.slice(row - 1, row - 1 + rowCount).map(line => line.slice(column - 1, column - 1 + columnCount)),
      getValues: () => rows.slice(row - 1, row - 1 + rowCount).map(line => line.slice(column - 1, column - 1 + columnCount)),
      setValues: values => values.forEach((line, rowOffset) => {
        const target = row - 1 + rowOffset;
        rows[target] = rows[target] || new Array(rows[0].length).fill('');
        line.forEach((value, columnOffset) => { rows[target][column - 1 + columnOffset] = value; });
      })
    })
  };
  const base = {
    id: 'a1', refMft: '283', dateCreation: new Date('2026-08-01'), demandeur: 'MFT',
    immo: '1710288', famille: 'F1', constat: 'C', decision: 'Décision 1', responsable: 'R',
    echeanceInitiale: new Date('2026-08-31'), statut: 'En cours', priorite: '1'
  };
  const firstRow = upsertOfficialMftAction_(sheet, base);
  const secondRow = upsertOfficialMftAction_(sheet, { ...base, decision: 'Décision 2' });
  return { firstRow, secondRow, rows };
})()`);
assert.equal(normalizedUpsert.firstRow, 2);
assert.equal(normalizedUpsert.secondRow, 2);
assert.equal(normalizedUpsert.rows.length, 2);
assert.equal(normalizedUpsert.rows[1][8], 'Décision 2');

const sourceAnalysis = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildSourceAnalysis_([
    row({ ID_EVENEMENT: 'a-1', DATE: new Date('2026-08-03'), SOURCE: 'ALEA', IMMO: '1607001', FAMILLE: 'FAM-A', POSTE: 'P280', CATEGORIE: 'Outil', PROBLEME: 'Casse outil', COMMENTAIRE: 'Casse foret a confirmer', QUANTITE: 2, POIDS_IMPACT: 1, IMMO_DANS_MASTER: true }),
    row({ ID_EVENEMENT: 'a-2', DATE: new Date('2026-08-05'), SOURCE: 'ALEA', IMMO: '1607001', FAMILLE: 'FAM-A', POSTE: 'P280', CATEGORIE: 'Outil', PROBLEME: 'Casse outil', QUANTITE: 1, POIDS_IMPACT: 1, IMMO_DANS_MASTER: true }),
    row({ ID_EVENEMENT: 'a-3', DATE: new Date('2026-08-07'), SOURCE: 'ALEA', IMMO: '1607002', FAMILLE: 'FAM-B', POSTE: 'P290', CATEGORIE: 'Machine', PROBLEME: 'Affichage HS', QUANTITE: 4, POIDS_IMPACT: 1, IMMO_DANS_MASTER: true }),
    row({ ID_EVENEMENT: 'n-1', DATE: new Date('2026-08-07'), SOURCE: 'NC', IMMO: '1607003', FAMILLE: 'FAM-C', POSTE: 'P290', PROBLEME: 'NC à exclure', QUANTITE: 9, POIDS_IMPACT: 5 })
  ], index, 'ALEA', {}, { activityMsn: 20, drillingByFamily: { FAMA: 1000, FAMB: 500 } });
})()`);
assert.equal(sourceAnalysis.kpis.total, 7);
assert.equal(sourceAnalysis.kpis.declarations, 3);
assert.equal(sourceAnalysis.kpis.recurrentMachines, 2);
assert.equal(sourceAnalysis.kpis.topFiveShare, 100);
assert.equal(sourceAnalysis.kpis.impactsPerMsn, 0.35);
assert.deepEqual([...sourceAnalysis.machines.map(item => item.label)], ['1607002', '1607001']);
assert.equal(sourceAnalysis.families[0].label, 'FAM-B');
assert.equal(sourceAnalysis.families[0].impactsPer1000Drillings, 8);
assert.deepEqual([...sourceAnalysis.stations.map(item => [item.label, item.total])], [['P290', 4], ['P280', 3]]);
assert.deepEqual(JSON.parse(JSON.stringify(sourceAnalysis.trend)), [['2026-S32', 7]]);
assert.equal(sourceAnalysis.details[2].hypothesisCause, 'Casse foret a confirmer');

const sourceNcKeepsUnmatchedImmo = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildSourceAnalysis_([
    row({ ID_EVENEMENT: 'nc-1', DATE: new Date('2026-08-07'), SOURCE: 'NC', IMMO: '1799999', FAMILLE: 'FAM-ANCIENNE', POSTE: 'P280', QUANTITE: 1, POIDS_IMPACT: 5, IMMO_DANS_MASTER: false })
  ], index, 'NC', {}, {});
})()`);
assert.equal(sourceNcKeepsUnmatchedImmo.machines[0].label, '1799999');
assert.equal(sourceNcKeepsUnmatchedImmo.details[0].immo, '1799999');

const combinedAleaAnalysis = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildCombinedAleaAnalysis_([
    row({ ID_EVENEMENT: 'prod-strong', DATE: new Date('2026-08-18'), SOURCE: 'ALEA', IMMO: '1607001', POSTE: 'P290', PROBLEME: 'Casse outil', COMMENTAIRE: 'Foret casse', TEMPS_PERDU_HEURES: 1 }),
    row({ ID_EVENEMENT: 'mes-strong', DATE: new Date('2026-08-18'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1607001', POSTE: 'P290 A', PROBLEME: 'Manquant', COMMENTAIRE: 'Outil casse', TEMPS_PERDU_HEURES: 0.5 }),
    row({ ID_EVENEMENT: 'prod-probable', DATE: new Date('2026-08-21'), SOURCE: 'ALEA', IMMO: '1607002', POSTE: 'P280', PROBLEME: 'Défaut mécanique', TEMPS_PERDU_HEURES: 0.25 }),
    row({ ID_EVENEMENT: 'mes-probable', DATE: new Date('2026-08-22'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1607002', POSTE: 'P280 A', PROBLEME: 'Autre incident', TEMPS_PERDU_HEURES: 0.75 }),
    row({ ID_EVENEMENT: 'prod-unmatched', DATE: new Date('2026-08-30'), SOURCE: 'ALEA', IMMO: '1607003', POSTE: 'P280', PROBLEME: 'Affichage HS' }),
    row({ ID_EVENEMENT: 'mes-unmatched', DATE: new Date('2026-08-30'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1607004', POSTE: 'P290', PROBLEME: 'Autre incident' }),
    row({ ID_EVENEMENT: 'mes-grid', DATE: new Date('2026-08-30'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1607005', POSTE: 'P290', COMMENTAIRE: 'Grille de percage' }),
    row({ ID_EVENEMENT: 'mes-box-edu', DATE: new Date('2026-08-30'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', IMMO: '1607006', POSTE: 'P290', COMMENTAIRE: 'Incident Box EDU' })
  ], index, { source: 'ALEA' });
})()`);
assert.equal(combinedAleaAnalysis.kpis.productionEvents, 3);
assert.equal(combinedAleaAnalysis.kpis.mesEvents, 3);
assert.equal(combinedAleaAnalysis.kpis.matchedEvents, 2);
assert.equal(combinedAleaAnalysis.kpis.strongMatches, 1);
assert.equal(combinedAleaAnalysis.kpis.probableMatches, 1);
assert.equal(combinedAleaAnalysis.kpis.unmatchedProduction, 1);
assert.equal(combinedAleaAnalysis.kpis.unmatchedMes, 1);
assert.equal(combinedAleaAnalysis.detailsTotal, 4);
assert.equal(combinedAleaAnalysis.rows[0].correspondence.label, 'Forte');
assert.equal(combinedAleaAnalysis.rows[1].correspondence.label, 'Probable');
assert.ok(combinedAleaAnalysis.rows[0].correspondence.reasons.includes('IMMO identique'));
assert.equal(combinedAleaAnalysis.rows.filter(row => !row.production || !row.mes).length, 2);

const familyCombinedMatch = evaluate(`combinedAleaMatch_(
  { date: '2026-08-18', immo: '', station: '', family: 'SNZ-M2-224', keywords: [] },
  { date: '2026-08-18', immo: '', station: '', family: 'SNZ-M2-224', keywords: [] }
)`);
assert.equal(familyCombinedMatch.label, 'Probable');
assert.ok(familyCombinedMatch.reasons.includes('famille machine identique'));

const combinedCommentMatch = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1607025', FAMILLE: 'SNZ-M2-224', SECTION: 'TC' },
    { IMMO: '1607026', FAMILLE: 'SNZ-M2-224', SECTION: 'TC' }
  ]);
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildCombinedAleaAnalysis_([
    row({ ID_EVENEMENT: 'prod-comment', DATE: new Date('2026-08-18'), SOURCE: 'ALEA', IMMO: '1607026', POSTE: 'P290' }),
    row({ ID_EVENEMENT: 'mes-comment', DATE: new Date('2026-08-18'), SOURCE: 'ALEA_MES', CATEGORIE: '03-Moyens', COMMENTAIRE: 'Aléa famille SNZ M2 224' })
  ], index, {}, master);
})()`);
assert.equal(combinedCommentMatch.kpis.matchedEvents, 1);
assert.equal(combinedCommentMatch.rows[0].immo, '1607026');
assert.ok(combinedCommentMatch.rows[0].correspondence.reasons.includes('famille machine identique'));

const sourceConsolidation = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1607001', FAMILLE: 'FAM-MASTER-1', SECTION: 'TC', JEU: 'P280 - Vert' },
    { IMMO: '1607002', FAMILLE: 'FAM-MASTER-2', SECTION: 'TC', JEU: 'P290 - Rouge' }
  ]);
  const facts = [];
  appendFacts_(facts, [
    { DATE: new Date('2026-08-10'), SECTION: 'TC', POSTE: 'P280', TYPEDEMACHINE: 'Perceuse', FAMILLE: 'FAM-ALEA', ALEA: 'Casse outil' },
    { DATE: new Date('2026-08-10'), SECTION: 'TC', POSTE: 'P300', TYPEDEMACHINE: 'Perceuse', FAMILLE: 'FAM-ALEA', ALEA: 'À exclure' }
  ], 'ALEA', APP.aliases.aleas, master, {}, 'Remontées aléas production');
  appendFacts_(facts, [
    { DATENC: new Date('2026-08-11'), SECTION: 'TC', NIMMO: '1607001/1607002', INDICATIONFAMILLE: 'FAM-NC-SOURCE', NBRNC: 6, NC: 'NC-1' },
    { DATENC: new Date('2026-08-12'), SECTION: 'TC', NIMMO: '', INDICATIONFAMILLE: 'FAM-NC-SEULE', NBRNC: 2, NC: 'NC-2' }
  ], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  return { facts, index, analysis: buildSourceAnalysis_(facts, index, 'NC', {}, { activityMsn: null, drillingByFamily: {} }) };
})()`);
// TC n'a pas de liste de postes : la ligne P300 est aussi retenue.
assert.equal(sourceConsolidation.facts.filter(row => row[sourceConsolidation.index.SOURCE] === 'ALEA').length, 2);
assert.equal(sourceConsolidation.facts.find(row => row[sourceConsolidation.index.SOURCE] === 'ALEA')[sourceConsolidation.index.TYPE_MACHINE], 'Perceuse');
assert.equal(sourceConsolidation.facts.filter(row => row[sourceConsolidation.index.SOURCE] === 'NC').length, 3);
assert.deepEqual([...sourceConsolidation.facts.filter(row => row[sourceConsolidation.index.SOURCE] === 'NC').slice(0, 2).map(row => row[sourceConsolidation.index.POSTE])], ['P280 - Vert', 'P290 - Rouge']);
assert.deepEqual([...sourceConsolidation.facts.filter(row => row[sourceConsolidation.index.SOURCE] === 'NC').map(row => row[sourceConsolidation.index.IMMO])], ['1607001', '1607002', '']);
assert.equal(sourceConsolidation.analysis.kpis.total, 8);
assert.ok(sourceConsolidation.analysis.families.some(item => item.label === 'FAM-NC-SEULE'));
assert.equal(sourceConsolidation.analysis.machineTypes.length, 0);
assert.equal(sourceConsolidation.analysis.detailsTotal, 2);
assert.equal(sourceConsolidation.analysis.details[0].ncNumber, 'NC-2');
assert.equal(sourceConsolidation.analysis.details[0].immo, '');
assert.equal(sourceConsolidation.analysis.details[0].family, 'FAM-NC-SEULE');
assert.equal(sourceConsolidation.analysis.details[0].ncCount, 2);
assert.equal(sourceConsolidation.analysis.details[1].ncNumber, 'NC-1');
assert.equal(sourceConsolidation.analysis.details[1].immo, '1607001 / 1607002');
assert.equal(sourceConsolidation.analysis.details[1].family, 'FAM-NC-SOURCE');
assert.equal(sourceConsolidation.analysis.details[1].ncCount, 6);

const ncScopeAllocation = evaluate(`(() => {
  const master = buildMasterIndex_([
    { IMMO: '1607010', FAMILLE: 'FAM-PA', SECTION: 'TC', JEU: 'P280 - Vert' },
    { IMMO: '2607011', FAMILLE: 'FAM-PA', SECTION: 'PA', JEU: 'P900 - Gris' }
  ]);
  const facts = [];
  appendFacts_(facts, [{ DATENC: new Date('2026-08-13'), SECTION: 'TC', NIMMO: '1607010/2607011', INDICATIONFAMILLE: 'FAM-NC', NBRNC: 8, NC: 'NC-PA-TC' }], 'NC', APP.aliases.nc, master, {}, 'Données NC PA');
  const index = Object.fromEntries(APP.factsHeaders.map((header, position) => [header, position]));
  return { facts, index, quantity: factQuantity_(facts[0], index) };
})()`);
assert.equal(ncScopeAllocation.facts.length, 1);
assert.equal(ncScopeAllocation.facts[0][ncScopeAllocation.index.IMMO], '1607010');
assert.equal(ncScopeAllocation.facts[0][ncScopeAllocation.index.NB_NC], 8);
assert.equal(ncScopeAllocation.quantity, 8);

const qualifiedPareto = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildSourceAnalysis_([
    row({ ID_EVENEMENT: 'qualified', DATE: new Date('2026-08-08'), SOURCE: 'ALEA', IMMO: '1608001', FAMILLE: 'FAM-QUALIFIEE', QUANTITE: 2, IMMO_DANS_MASTER: true }),
    row({ ID_EVENEMENT: 'unqualified', DATE: new Date('2026-08-08'), SOURCE: 'ALEA', IMMO: '', FAMILLE: '', QUANTITE: 9, IMMO_DANS_MASTER: false })
  ], index, 'ALEA', {}, { activityMsn: null, drillingByFamily: {} });
})()`);
assert.deepEqual([...qualifiedPareto.machines.map(item => item.label)], ['1608001']);
assert.deepEqual([...qualifiedPareto.families.map(item => item.label)], ['FAM-QUALIFIEE']);
assert.equal(qualifiedPareto.kpis.total, 11);
assert.equal(qualifiedPareto.detailsTotal, 2);

assert.equal(evaluate("protectSpreadsheetValue_('=IMPORTXML(\"https://example.test\")')"), "'=IMPORTXML(\"https://example.test\")");
assert.equal(evaluate("protectSpreadsheetValue_('+1+1')"), "'+1+1");
assert.equal(evaluate("protectSpreadsheetValue_('Texte normal')"), 'Texte normal');
assert.equal(evaluate("protectSpreadsheetValue_(42)"), 42);
const trendWindow = evaluate('trendWindow_()');
assert.equal(trendWindow.from, `${new Date().getFullYear()}-01-01`);
assert.equal(trendWindow.trendLabel, `Année ${new Date().getFullYear()}`);

const ncSourceAnalysis = evaluate(`(() => {
  const headers = APP.factsHeaders;
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = values => headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
  return buildSourceAnalysis_([
    row({ ID_EVENEMENT: 'nc-1', DATE: new Date('2026-08-08'), SOURCE: 'NC', IMMO: '1608001', FAMILLE: 'FAM-NC', POSTE: 'P290', PROBLEME: 'Typologie A', QUANTITE: 1, NB_NC: 5, MSN: '216000111', POIDS_IMPACT: 5 }),
    row({ ID_EVENEMENT: 'nc-2', DATE: new Date('2026-08-09'), SOURCE: 'NC', IMMO: '1608002', FAMILLE: 'FAM-NC', POSTE: 'P280', PROBLEME: 'Typologie B', QUANTITE: 2, NB_NC: 3, MSN: '216000111', POIDS_IMPACT: 5 })
  ], index, 'NC', {}, { activityMsn: null, drillingByFamily: {} });
})()`);
assert.equal(ncSourceAnalysis.kpis.total, 8);
assert.equal(ncSourceAnalysis.kpis.ncCount, 8);
assert.equal(ncSourceAnalysis.msns[0].label, '216000111');
assert.equal(ncSourceAnalysis.msns[0].total, 8);

const legacyFactsSchema = evaluate(`factsSchemaStatus_(APP.factsHeaders.slice(0, -1))`);
assert.equal(legacyFactsSchema.needsRefresh, true);
assert.deepEqual([...legacyFactsSchema.missing], [evaluate('APP.factsHeaders[APP.factsHeaders.length - 1]')]);
assert.equal(evaluate(`factsSchemaStatus_(APP.factsHeaders).needsRefresh`), false);
evaluate(`preserveFactsRebuildFlag_({ needsRefresh: true })`);
assert.equal(scriptProperties.FACTS_SCHEMA_REBUILD_REQUIRED, 'OUI');

const factRetention = evaluate(`partitionFactsByRetention_([
  ['old', new Date('2024-08-22')],
  ['boundary', new Date('2024-08-23')],
  ['recent', new Date('2026-08-23')],
  ['undated', '']
], new Date('2026-08-23'), 1)`);
assert.deepEqual([...factRetention.active.map(row => row[0])], ['boundary', 'recent', 'undated']);
assert.deepEqual([...factRetention.archived.map(row => row[0])], ['old']);

const archiveKeyWithoutId = evaluate(`archiveFactKey_(['', new Date('2024-08-22'), 'ALEA', '1607001'])`);
assert.match(archiveKeyWithoutId, /^SANS_ID-/);
assert.equal(archiveKeyWithoutId, evaluate(`archiveFactKey_(['', new Date('2024-08-22'), 'ALEA', '1607001'])`));
assert.equal(evaluate(`archiveFactKey_(['ALEA-42', new Date('2024-08-22')])`), 'ID-ALEA-42');
assert.equal(evaluate(`sameArchiveFact_(['ALEA-42', new Date('2024-08-22')], ['ALEA-42', new Date('2024-08-22')])`), true);
assert.equal(evaluate(`sameArchiveFact_(['ALEA-42', new Date('2024-08-22'), 'ancienne quantité'], ['ALEA-42', new Date('2024-08-22'), 'nouvelle quantité'])`), false);

const normalizedLegacyFacts = evaluate(`normalizeFactRowsToCurrentSchema_([
  'ID_EVENEMENT', 'DATE', 'SOURCE', 'IMMO'
], [['ALEA-1', new Date('2024-08-22'), 'ALEA', '1607001']])`);
assert.equal(normalizedLegacyFacts.headers.length, evaluate(`APP.factsHeaders.length`));
assert.equal(normalizedLegacyFacts.rows[0][0], 'ALEA-1');
assert.equal(normalizedLegacyFacts.rows[0][3], 'ALEA');
assert.equal(normalizedLegacyFacts.rows[0][27], '');

console.log('OK — syntaxe Apps Script/HTML et règles critiques validées.');
