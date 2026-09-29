function importerNouveauxFichiersMes() {
  return withScriptLock_(() => {
    const result = importerNouveauxFichiersMes_(getParameters_());
    SpreadsheetApp.getActive().toast(
      `${result.files} fichier(s), ${result.rows} ligne(s) MES importée(s), ${result.errors} erreur(s).`,
      'Import MES',
      8
    );
    return result;
  });
}

function reconstruireHistoriqueMes() {
  return withScriptLock_(() => {
    const parameters = getParameters_();
    if (!parameters.ID_DOSSIER_MES_ARCHIVES) throw new Error('Le dossier d’archives MES n’est pas configuré.');
    const archiveFolder = DriveApp.getFolderById(parameters.ID_DOSSIER_MES_ARCHIVES);
    const master = readMesMaster_(parameters);
    const files = archiveFolder.getFiles();
    const rows = [];
    const errors = [];
    let fileCount = 0;
    while (files.hasNext()) {
      const file = files.next();
      try {
        rows.push(...tableToMesRecords_(readMesFile_(file), file, master));
        fileCount += 1;
      } catch (error) {
        errors.push(`${file.getName()} : ${error.message || String(error)}`);
      }
    }
    const sheet = ensureSheet_(SpreadsheetApp.getActive(), APP.sheets.mesStaging);
    replaceSheetData_(sheet, [mesStagingHeaders_(), ...rows]);
    writeMesPreNc_(rows);
    sheet.setFrozenRows(1);
    styleHeader_(sheet, mesStagingHeaders_().length);
    if (rows.length) {
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(2, 14, rows.length, 1).setNumberFormat('0.00 "h"');
    }
    actualiserToutUnlocked_();
    SpreadsheetApp.getActive().toast(
      `${fileCount} fichier(s) relu(s), ${rows.length} ligne(s), ${errors.length} erreur(s).`,
      'Historique MES reconstruit',
      10
    );
    return { files: fileCount, rows: rows.length, errors };
  });
}

function importerNouveauxFichiersMes_(parameters, masterIndex) {
  const inputFolder = findMesInputFolder_(parameters);
  if (!inputFolder) return { files: 0, rows: 0, errors: 0 };

  const archiveFolder = parameters.ID_DOSSIER_MES_ARCHIVES
    ? DriveApp.getFolderById(parameters.ID_DOSSIER_MES_ARCHIVES)
    : getOrCreateArchiveFolder_(inputFolder);
  const importedIds = successfulImportIds_();
  const master = masterIndex || readMesMaster_(parameters);
  const files = inputFolder.getFiles();
  const stagingRows = [];
  const readyImports = [];
  let importedFiles = 0;
  let errors = 0;

  while (files.hasNext()) {
    const file = files.next();
    if (importedIds.has(file.getId())) continue;
    try {
      const table = readMesFile_(file);
      const records = tableToMesRecords_(table, file, master);
      stagingRows.push(...records);
      readyImports.push({ file, rows: records.length });
    } catch (error) {
      appendImportLog_(file, 'ERREUR', 0, error.message || String(error));
      errors += 1;
    }
  }

  if (stagingRows.length) {
    const sheet = ensureSheet_(SpreadsheetApp.getActive(), APP.sheets.mesStaging);
    ensureMesStagingSchema_(sheet);
    setSheetValues_(sheet.getRange(sheet.getLastRow() + 1, 1, stagingRows.length, stagingRows[0].length), stagingRows);
    sheet.getRange(2, 2, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(2, 14, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat('0.00 "h"');
  }
  writeMesPreNc_(readStagedMes_());
  readyImports.forEach(item => {
    try {
      item.file.moveTo(archiveFolder);
      appendImportLog_(item.file, 'SUCCES', item.rows, '');
      importedFiles += 1;
    } catch (error) {
      appendImportLog_(item.file, 'ERREUR', item.rows, error.message || String(error));
      errors += 1;
    }
  });
  return { files: importedFiles, rows: stagingRows.length, errors };
}

function mesStagingHeaders_() {
  return [
    'ID_EVENEMENT', 'DATE', 'IMMO', 'FAMILLE', 'TYPE_MACHINE', 'SECTION',
    'POSTE', 'CATEGORIE', 'PROBLEME', 'QUANTITE', 'FICHIER_ID',
    'FICHIER_NOM', 'DATE_IMPORT', 'TEMPS_PERDU_HEURES', 'COMMENTAIRE_INITIAL',
    'METHODE_RAPPROCHEMENT', 'SOURCE', 'NC_NUMERO', 'NB_NC', 'MSN', 'INTITULE_MES', 'STATUT_MES',
    'IMMO_SOURCE', 'FAMILLE_SOURCE'
  ];
}

function readStagedMes_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.mesStaging);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(row => row.some(value => clean_(value) !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function hasAuthoritativeManualNc_(rows) {
  return (rows || []).some(row => clean_(row.SOURCE) === 'NC');
}

function readMesFile_(file) {
  const mimeType = file.getMimeType();
  if (mimeType === MimeType.CSV || /csv|text\/plain/i.test(mimeType)) {
    const text = file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    return Utilities.parseCsv(text, separator);
  }
  if (mimeType === MimeType.GOOGLE_SHEETS) {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  if (/spreadsheetml|ms-excel|excel/i.test(mimeType) || /\.xlsx?$/i.test(file.getName())) {
    return convertExcelAndRead_(file);
  }
  throw new Error(`Format non pris en charge : ${file.getName()} (${mimeType}). Utilisez CSV ou XLSX.`);
}

function convertExcelAndRead_(file) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('Le service avancé Drive doit être activé pour importer un fichier XLSX. Consultez le guide INSTALLATION.md.');
  }
  const converted = Drive.Files.create(
    { name: `TEMP_${file.getName()}`, mimeType: MimeType.GOOGLE_SHEETS },
    file.getBlob(),
    { fields: 'id' }
  );
  try {
    return SpreadsheetApp.openById(converted.id).getSheets()[0].getDataRange().getDisplayValues();
  } finally {
    DriveApp.getFileById(converted.id).setTrashed(true);
  }
}

function tableToMesRecords_(table, file, master) {
  if (!table || !table.length) return [];
  const headerIndex = detectMesHeaderRow_(table);
  const headers = table[headerIndex].map(normalizeHeader_);
  if (!headers.some(Boolean)) throw new Error('Aucun en-tête détecté dans le fichier MES.');
  const dateHeaders = new Set(APP.aliases.mes.date.map(normalizeHeader_));
  if (!headers.some(header => dateHeaders.has(header))) {
    throw new Error('Colonne de date MES introuvable. Le fichier doit contenir « Date ouverture » ou une variante reconnue.');
  }
  const isNewMesExport = headers.includes(normalizeHeader_('ID ticket'))
    && headers.includes(normalizeHeader_('Unité'))
    && headers.includes(normalizeHeader_('5M'))
    && headers.includes(normalizeHeader_('Objet'));
  const isQlikExport = !isNewMesExport
    && headers.includes(normalizeHeader_('Disruption ID'))
    && headers.includes(normalizeHeader_('Objet'));

  return table.slice(headerIndex + 1)
    .filter(row => row.some(value => clean_(value) !== ''))
    .map((row, index) => {
      const record = Object.fromEntries(headers.map((header, column) => [header, row[column]]));
      const classification = classifyMesRecord_(record, { isNewMesExport, isQlikExport });
      if (!classification) return null;
      const status = normalizeHeader_(pick_(record, APP.aliases.mes.status));
      if (['SUPPRIME', 'REJETE'].includes(status)) return null;
      const date = parseDate_(pick_(record, APP.aliases.mes.date));
      const comment = clean_(pick_(record, APP.aliases.mes.initialComment));
      const sourceImmoValue = pick_(record, APP.aliases.mes.immo);
      const sourceImmo = isMissingMesImmo_(sourceImmoValue) ? '' : clean_(sourceImmoValue);
      const sourceFamily = clean_(pick_(record, APP.aliases.mes.family));
      const identity = resolveMesIdentity_(
        sourceImmo,
        sourceFamily,
        comment,
        master
      );
      const immo = isMesIdentityImmoMethod_(identity.method) ? identity.immos.join(' / ') : '';
      const object = clean_(pick_(record, APP.aliases.mes.object));
      const section = clean_(pick_(record, APP.aliases.mes.section));
      const attribute = clean_(pick_(record, APP.aliases.mes.attribute));
      const problem = isQlikExport || isNewMesExport
        ? attribute || clean_(pick_(record, APP.aliases.mes.problem))
        : [object, attribute].filter(Boolean).join(' · ') || clean_(pick_(record, APP.aliases.mes.problem));
      const explicitId = clean_(pick_(record, APP.aliases.mes.eventId));
      const quantity = Math.max(1, numberOr_(pick_(record, APP.aliases.mes.quantity), 1));
      const ncNumber = clean_(pick_(record, APP.aliases.mes.ncNumber));
      const msn = clean_(pick_(record, APP.aliases.mes.msn));
      const title = clean_(pick_(record, APP.aliases.mes.title));
      return [
        explicitId || digest_([file.getId(), dateKey_(date), immo, problem, index + headerIndex + 2].join('|')),
        date || '', immo, identity.family,
        identity.masterData.machineType || clean_(pick_(record, APP.aliases.mes.machineType)),
        section || identity.masterData.section || '',
        clean_(pick_(record, APP.aliases.mes.station)) || identity.masterData.station || '',
        clean_(pick_(record, APP.aliases.mes.category)), problem,
        quantity,
        file.getId(), file.getName(), new Date(),
        parseDurationHours_(pick_(record, APP.aliases.mes.durationHours), { spreadsheetDays: isNewMesExport }),
        comment, identity.method, classification.source,
        ncNumber, classification.source === 'NC' ? quantity : '', msn, title, clean_(pick_(record, APP.aliases.mes.status)),
        sourceImmo, sourceFamily
      ];
    })
    .filter(Boolean);
}

function mesPreNcHeaders_() {
  return [
    'ID_EVENEMENT', 'DATE', 'NC_NUMERO', 'IMMO', 'FAMILLE', 'POSTE', 'CATEGORIE',
    'PROBLEME', 'INTITULE_MES', 'STATUT_MES', 'QUANTITE', 'TEMPS_PERDU_HEURES',
    'COMMENTAIRE_INITIAL', 'MSN', 'FICHIER_NOM', 'METHODE_RAPPROCHEMENT',
    'IMMO_SAISI', 'FAMILLE_SAISIE', 'COMMENTAIRE_ENORA', 'STATUT_WORKFLOW',
    'DATE_SOUMISSION', 'SOUMIS_PAR', 'DECISION_QUALITE', 'COMMENTAIRE_QUALITE',
    'DATE_VALIDATION', 'VALIDE_PAR'
  ];
}

function mesPreNcWorkflowFields_() {
  return [
    'IMMO_SAISI', 'FAMILLE_SAISIE', 'COMMENTAIRE_ENORA', 'STATUT_WORKFLOW',
    'DATE_SOUMISSION', 'SOUMIS_PAR', 'DECISION_QUALITE', 'COMMENTAIRE_QUALITE',
    'DATE_VALIDATION', 'VALIDE_PAR'
  ];
}

function mesPreNcWorkflowStatuses_() {
  return ['A_COMPLETER', 'SOUMIS', 'A_CORRIGER', 'VALIDEE', 'REJETEE'];
}

function isMesPreNcRow_(row) {
  if (clean_(row.SOURCE) !== 'NC') return false;
  const title = normalizeHeader_(row.INTITULE_MES);
  return !['RETOUCHESAPOSTESANSNC', 'ALLERRETOURCDU'].includes(title);
}

function ensureMesPreNcSchema_(sheet) {
  const expected = mesPreNcHeaders_();
  if (sheet.getLastRow() === 0) {
    replaceSheetData_(sheet, [expected]);
    styleMesPreNcSheet_(sheet, expected);
    return;
  }
  const values = sheet.getDataRange().getValues();
  const existingHeaders = values.shift().map(clean_);
  const sameSchema = existingHeaders.length === expected.length
    && expected.every((header, index) => existingHeaders[index] === header);
  if (!sameSchema) {
    const positions = Object.fromEntries(existingHeaders.map((header, index) => [header, index]));
    const normalizedRows = values.map(row => expected.map(header => {
      const position = positions[header];
      return position === undefined ? '' : row[position];
    }));
    replaceSheetData_(sheet, [expected, ...normalizedRows]);
  }
  styleMesPreNcSheet_(sheet, expected);
}

function readMesPreNc_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.mesPreNc);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(row => row.some(value => clean_(value) !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function mergeMesPreNcWorkflowFields_(row, existing) {
  const merged = Object.assign({}, row);
  mesPreNcWorkflowFields_().forEach(field => {
    if (field === 'STATUT_WORKFLOW') merged[field] = existing && clean_(existing[field]) ? existing[field] : 'A_COMPLETER';
    else if (existing && existing[field] !== undefined) merged[field] = existing[field];
    else merged[field] = '';
  });
  return merged;
}

function compareNcNumeroDescending_(left, right) {
  const leftText = clean_(left);
  const rightText = clean_(right);
  if (!leftText) return rightText ? 1 : 0;
  if (!rightText) return -1;
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return rightNumber - leftNumber;
  }
  return rightText.localeCompare(leftText, 'fr', { numeric: true, sensitivity: 'base' });
}

function sortNcRowsDescending_(rows) {
  return (rows || []).slice().sort((left, right) =>
    compareNcNumeroDescending_(left.NC_NUMERO, right.NC_NUMERO)
    || clean_(left.ID_EVENEMENT).localeCompare(clean_(right.ID_EVENEMENT), 'fr', { numeric: true, sensitivity: 'base' })
  );
}

function sortMesPreNcSheet_(sheet, headers) {
  const rowCount = sheet.getLastRow() - 1;
  const ncNumberColumn = headers.indexOf('NC_NUMERO');
  if (rowCount < 2 || ncNumberColumn < 0) return;
  const values = sheet.getRange(2, 1, rowCount, headers.length).getValues();
  values.sort((left, right) => compareNcNumeroDescending_(left[ncNumberColumn], right[ncNumberColumn]));
  sheet.getRange(2, 1, rowCount, headers.length).setValues(values);
}

function mesPreNcHiddenWorkflowStatuses_(statuses) {
  const visible = new Set(statuses || []);
  return mesPreNcWorkflowStatuses_().filter(status => !visible.has(status));
}

function writeMesPreNc_(rows) {
  const sheet = ensureSheet_(SpreadsheetApp.getActive(), APP.sheets.mesPreNc);
  ensureMesPreNcSchema_(sheet);
  const headers = mesPreNcHeaders_();
  const existingById = Object.fromEntries(readMesPreNc_().map(row => [clean_(row.ID_EVENEMENT), row]));
  const workflowRows = sortNcRowsDescending_((rows || [])
    .filter(isMesPreNcRow_)
    .map(row => mergeMesPreNcWorkflowFields_(row, existingById[clean_(row.ID_EVENEMENT)])));
  const values = workflowRows.map(row => [
    row.ID_EVENEMENT, row.DATE, row.NC_NUMERO, row.IMMO, row.FAMILLE, row.POSTE, row.CATEGORIE,
    row.PROBLEME, row.INTITULE_MES, row.STATUT_MES, row.QUANTITE,
    row.TEMPS_PERDU_HEURES, row.COMMENTAIRE_INITIAL, row.MSN, row.FICHIER_NOM,
    row.METHODE_RAPPROCHEMENT, row.IMMO_SAISI, row.FAMILLE_SAISIE,
    row.COMMENTAIRE_ENORA, row.STATUT_WORKFLOW, row.DATE_SOUMISSION,
    row.SOUMIS_PAR, row.DECISION_QUALITE, row.COMMENTAIRE_QUALITE,
    row.DATE_VALIDATION, row.VALIDE_PAR
  ]);
  replaceSheetData_(sheet, [headers, ...values]);
  styleMesPreNcSheet_(sheet, headers);
  applyMesPreNcWorkflowValidation_(sheet, headers);
  if (values.length) {
    const dateColumn = headers.indexOf('DATE') + 1;
    const durationColumn = headers.indexOf('TEMPS_PERDU_HEURES') + 1;
    if (dateColumn) sheet.getRange(2, dateColumn, values.length, 1).setNumberFormat('dd/mm/yyyy');
    if (durationColumn) sheet.getRange(2, durationColumn, values.length, 1).setNumberFormat('0.00 "h"');
  }
  return workflowRows;
}

function styleMesPreNcSheet_(sheet, headers) {
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const bodyRows = Math.max(1, sheet.getLastRow() - 1);
  const columnGroups = [
    {
      headers: ['ID_EVENEMENT', 'DATE', 'IMMO', 'FAMILLE', 'POSTE', 'CATEGORIE', 'PROBLEME', 'INTITULE_MES', 'STATUT_MES', 'QUANTITE', 'TEMPS_PERDU_HEURES', 'COMMENTAIRE_INITIAL', 'MSN', 'FICHIER_NOM', 'METHODE_RAPPROCHEMENT'],
      headerColor: '#1f5f75',
      bodyColor: '#eef6f8'
    },
    {
      headers: ['NC_NUMERO', 'IMMO_SAISI', 'FAMILLE_SAISIE', 'COMMENTAIRE_ENORA'],
      headerColor: '#b8610a',
      bodyColor: '#fff4df'
    },
    {
      headers: ['STATUT_WORKFLOW', 'DATE_SOUMISSION', 'SOUMIS_PAR', 'DECISION_QUALITE', 'COMMENTAIRE_QUALITE', 'DATE_VALIDATION', 'VALIDE_PAR'],
      headerColor: '#27734b',
      bodyColor: '#edf7ee'
    }
  ];

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setTabColor('#e69138');
  headerRange
    .setBackground('#173f46')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 40);

  columnGroups.forEach(group => {
    group.headers.forEach(header => {
      const column = headers.indexOf(header) + 1;
      if (!column) return;
      sheet.getRange(1, column).setBackground(group.headerColor);
      sheet.getRange(2, column, bodyRows, 1).setBackground(group.bodyColor);
    });
  });

  sheet.getRange(2, 1, bodyRows, headers.length)
    .setWrap(true)
    .setVerticalAlignment('middle');
  const ncNumberColumn = headers.indexOf('NC_NUMERO') + 1;
  if (ncNumberColumn) {
    sheet.getRange(2, ncNumberColumn, bodyRows, 1).setNumberFormat('@');
    sheet.getRange(1, ncNumberColumn).setNote('Numéro de NC à copier-coller dans SAP pour retrouver l’IMMO ou la famille.');
  }

  const widths = {
    ID_EVENEMENT: 150, DATE: 95, NC_NUMERO: 105, IMMO: 105, FAMILLE: 175, POSTE: 120,
    CATEGORIE: 155, PROBLEME: 250, INTITULE_MES: 210, STATUT_MES: 115, QUANTITE: 80,
    TEMPS_PERDU_HEURES: 125, COMMENTAIRE_INITIAL: 260, MSN: 90, FICHIER_NOM: 180,
    METHODE_RAPPROCHEMENT: 175, IMMO_SAISI: 110, FAMILLE_SAISIE: 175,
    COMMENTAIRE_ENORA: 250, STATUT_WORKFLOW: 130, DATE_SOUMISSION: 130, SOUMIS_PAR: 180,
    DECISION_QUALITE: 135, COMMENTAIRE_QUALITE: 250, DATE_VALIDATION: 130, VALIDE_PAR: 180
  };
  Object.entries(widths).forEach(([header, width]) => {
    const column = headers.indexOf(header) + 1;
    if (column) sheet.setColumnWidth(column, width);
  });

  const statusColumn = headers.indexOf('STATUT_WORKFLOW') + 1;
  if (statusColumn) {
    const statusRange = sheet.getRange(2, statusColumn, Math.max(1, sheet.getMaxRows() - 1), 1);
    sheet.setConditionalFormatRules([
      ['A_COMPLETER', '#fff2cc', '#7f6000'],
      ['SOUMIS', '#d9eaf7', '#1f4e79'],
      ['A_CORRIGER', '#f4cccc', '#990000'],
      ['VALIDEE', '#d9ead3', '#274e13'],
      ['REJETEE', '#ead1dc', '#741b47']
    ].map(([status, background, font]) => SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(background)
      .setFontColor(font)
      .setRanges([statusRange])
      .build()));
  }
}

function validatedMesPreNcRows_(rows) {
  return (rows || [])
    .filter(row => clean_(row.STATUT_WORKFLOW) === 'VALIDEE')
    .map(row => Object.assign({}, row, {
      IMMO: clean_(row.IMMO_SAISI) || row.IMMO,
      FAMILLE: clean_(row.FAMILLE_SAISIE) || row.FAMILLE,
      COMMENTAIRE_INITIAL: [row.COMMENTAIRE_INITIAL, row.COMMENTAIRE_ENORA].map(clean_).filter(Boolean).join(' | '),
      METHODE_RAPPROCHEMENT: [row.METHODE_RAPPROCHEMENT, 'NC_QUALITE_VALIDEE'].map(clean_).filter(Boolean).join(' + '),
      SOURCE: 'NC',
      NB_NC: clean_(row.NB_NC) || row.QUANTITE
    }));
}

function applyMesPreNcWorkflowValidation_(sheet, headers) {
  const statusColumn = headers.indexOf('STATUT_WORKFLOW') + 1;
  const decisionColumn = headers.indexOf('DECISION_QUALITE') + 1;
  const rowCount = Math.max(0, sheet.getMaxRows() - 1);
  if (!rowCount) return;
  if (statusColumn) {
    const statusValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(mesPreNcWorkflowStatuses_(), true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, statusColumn, rowCount, 1).setDataValidation(statusValidation);
  }
  if (decisionColumn) {
    const decisionValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['VALIDEE', 'A_CORRIGER', 'REJETEE'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, decisionColumn, rowCount, 1).setDataValidation(decisionValidation);
  }
}

function classifyMesRecord_(record, flags) {
  const options = flags || {};
  const object = normalizeHeader_(pick_(record, APP.aliases.mes.object));
  const category = normalizeHeader_(pick_(record, APP.aliases.mes.category));
  const section = normalizeHeader_(pick_(record, APP.aliases.mes.section));

  if (options.isNewMesExport) {
    if (section !== 'STRUCTUREPAA350') return null;
    if (category === '03MOYENS' && object === '0328UPAMEDU') return { source: 'ALEA_MES' };
    if (category === '01MATIERE' && object === '0111ARTICLESCOMPOSANTSPIECES') return { source: 'NC' };
    return null;
  }

  if (options.isQlikExport) {
    if (object !== 'UPAMEDU' || !section.startsWith('PAA350STR')) return null;
    return { source: 'ALEA_MES' };
  }

  return { source: 'ALEA_MES' };
}

function parseDurationHours_(value, options) {
  const settings = options || {};
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.max(0, value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600);
  }
  // Une durée Sheets est une fraction de jour : arrondie à la seconde pour éviter 0,4999999 h.
  const toHours = number => settings.spreadsheetDays
    ? Math.round(Math.max(0, number) * 86400) / 3600
    : Math.max(0, number);
  if (typeof value === 'number' && Number.isFinite(value)) return toHours(value);
  const text = clean_(value);
  if (!text) return 0;
  const duration = text.match(/^(?:(\d+)\s*[-.]\s*)?(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (duration) {
    const days = Number(duration[1] || 0);
    const hours = Number(duration[2] || 0);
    const minutes = Number(duration[3] || 0);
    const seconds = Number(duration[4] || 0);
    return Math.max(0, days * 24 + hours + minutes / 60 + seconds / 3600);
  }
  const numericText = text.replace(/\s/g, '').replace(',', '.');
  const numeric = Number(numericText);
  if (Number.isFinite(numeric)) return toHours(numeric);
  return 0;
}

function detectMesHeaderRow_(table) {
  const knownHeaders = new Set(Object.values(APP.aliases.mes).flat().map(normalizeHeader_));
  let bestIndex = 0;
  let bestScore = -1;
  table.slice(0, 12).forEach((row, index) => {
    const score = row.reduce((total, value) => total + (knownHeaders.has(normalizeHeader_(value)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestScore < 2) throw new Error('En-têtes MES non reconnus : les colonnes Date et IMMO sont au minimum attendues.');
  return bestIndex;
}

function successfulImportIds_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.importLog);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  return new Set(sheet.getDataRange().getDisplayValues().slice(1)
    .filter(row => row[3] === 'SUCCES')
    .map(row => row[1]));
}

function appendImportLog_(file, status, rows, message) {
  const sheet = ensureSheet_(SpreadsheetApp.getActive(), APP.sheets.importLog);
  if (sheet.getLastRow() === 0) setSheetValues_(sheet.getRange(1, 1, 1, 6), [['DATE_IMPORT', 'ID_FICHIER', 'NOM_FICHIER', 'STATUT', 'LIGNES', 'MESSAGE']]);
  setSheetValues_(sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6), [[new Date(), file.getId(), file.getName(), status, rows, message]]);
}

// Dossier Drive où l'on dépose les extractions MES (aléas UPA / MEDU et NC).
// L'ID enregistré dans PARAMETRES est prioritaire ; à défaut, le dossier nommé
// « MES A DEPOSER PA » (ou « MES A DEPOSER ») est retrouvé une seule fois puis son
// ID est mémorisé, afin de ne pas relancer une recherche Drive à chaque ouverture du dashboard.
const MES_INPUT_FOLDER_NAMES = Object.freeze(['MES A DEPOSER PA', 'MES A DEPOSER']);

function findMesInputFolderByName_() {
  for (const name of MES_INPUT_FOLDER_NAMES) {
    const folders = DriveApp.getFoldersByName(name);
    if (folders.hasNext()) return folders.next();
  }
  return null;
}

function findMesInputFolder_(parameters) {
  const configuredId = clean_((parameters || {}).ID_DOSSIER_MES_A_DEPOSER);
  if (configuredId) return DriveApp.getFolderById(configuredId);
  const folder = findMesInputFolderByName_();
  if (!folder) return null;
  try {
    setParameterValue_('ID_DOSSIER_MES_A_DEPOSER', folder.getId());
  } catch (error) {
    console.warn(`ID du dossier « ${folder.getName()} » non mémorisé : ${error.message || error}`);
  }
  return folder;
}

function getOrCreateArchiveFolder_(inputFolder) {
  const folders = inputFolder.getFoldersByName('Archives');
  return folders.hasNext() ? folders.next() : inputFolder.createFolder('Archives');
}

function getMesStatus_() {
  try {
    const parameters = getParameters_();
    const folder = findMesInputFolder_(parameters);
    if (!folder) {
      return { configured: false, folderUrl: '', folderName: '', pendingFiles: 0, message: 'Cliquez sur le bouton à droite pour créer le dépôt Drive.' };
    }
    const files = folder.getFiles();
    let pendingFiles = 0;
    while (files.hasNext()) {
      files.next();
      pendingFiles += 1;
    }
    return {
      configured: true,
      folderUrl: folder.getUrl(),
      folderName: folder.getName(),
      pendingFiles,
      message: pendingFiles ? `${pendingFiles} fichier(s) en attente` : 'Dossier prêt, aucun fichier en attente'
    };
  } catch (error) {
    return { configured: false, folderUrl: '', folderName: '', pendingFiles: 0, message: error.message || String(error) };
  }
}

function configurerDossierMes() {
  return withScriptLock_(() => {
    const parameters = getParameters_();
    if (parameters.ID_DOSSIER_MES_A_DEPOSER) {
      try {
        const existing = DriveApp.getFolderById(parameters.ID_DOSSIER_MES_A_DEPOSER);
        const status = getMesStatus_();
        SpreadsheetApp.getActive().toast(`Dossier MES déjà configuré : ${existing.getName()}`, 'Dashboard Machine', 8);
        return status;
      } catch (error) {
      }
    }

    const inputFolder = findMesInputFolderByName_() || DriveApp.createFolder(MES_INPUT_FOLDER_NAMES[0]);
    const archiveFolder = getOrCreateArchiveFolder_(inputFolder);
    setParameterValue_('ID_DOSSIER_MES_A_DEPOSER', inputFolder.getId());
    setParameterValue_('ID_DOSSIER_MES_ARCHIVES', archiveFolder.getId());
    SpreadsheetApp.getActive().toast(`Dossier de dépôt MES configuré : ${inputFolder.getName()}`, 'Dashboard Machine', 8);
    return getMesStatus_();
  });
}

function setParameterValue_(key, value) {
  if (isSecureParameter_(key)) {
    PropertiesService.getScriptProperties().setProperty(key, value);
    return;
  }
  const sheet = SpreadsheetApp.getActive().getSheetByName(APP.sheets.parameters);
  if (!sheet) throw new Error('Lancez d’abord « Initialiser ».');
  const keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().flat();
  const rowIndex = keys.indexOf(key);
  if (rowIndex < 0) throw new Error(`Paramètre introuvable : ${key}`);
  sheet.getRange(rowIndex + 1, 2).setValue(value);
}

function ensureMesStagingSchema_(sheet) {
  const expected = mesStagingHeaders_();
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
