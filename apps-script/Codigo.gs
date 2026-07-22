/* ============================================================
   Enciclopedia del Mundo — Backend (Google Apps Script)
   ------------------------------------------------------------
   Este script actúa de puente entre la página web y tu Hoja de
   Google. Se pega en Extensiones > Apps Script y se publica como
   "App web". Ver el README del proyecto para el paso a paso.

   >>> IMPORTANTE: cambiá SECRET por una contraseña propia. <<<
   Debe ser EXACTAMENTE la misma que carguen en la página.
   ============================================================ */

const SECRET = "CAMBIAR_ESTA_CLAVE"; // ← poné acá su contraseña compartida
const SHEET_NAME = "Entries";
const HEADERS = ["id", "category", "name", "summary", "body", "tags",
                 "imageUrl", "relations", "author", "createdAt", "updatedAt"];

/* ---------- Puntos de entrada HTTP ---------- */
function doGet(e)  { return handle(e, "GET"); }
function doPost(e) { return handle(e, "POST"); }

function handle(e, method) {
  try {
    let action, payload = {};
    if (method === "POST" && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
      action = payload.action;
    } else {
      payload = (e && e.parameter) ? e.parameter : {};
      action = payload.action || "list";
    }

    // Control de contraseña compartida
    if (String(payload.secret || "") !== String(SECRET)) {
      return json({ error: "unauthorized" });
    }

    const sheet = getSheet();
    let result;
    switch (action) {
      case "list":   result = { entries: listEntries(sheet) }; break;
      case "create": result = { entry: createEntry(sheet, payload.entry) }; break;
      case "update": result = { entry: updateEntry(sheet, payload.entry) }; break;
      case "delete": result = { id: deleteEntry(sheet, payload.id) }; break;
      default:       result = { error: "Acción desconocida: " + action };
    }
    return json(result);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- Utilidades de hoja ---------- */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Asegurar encabezados si la hoja está vacía
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function listEntries(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const out = [];
  for (const row of values) {
    if (!row[0]) continue; // fila sin id => ignorar
    const obj = {};
    HEADERS.forEach((h, i) => { obj[h] = row[i] === null || row[i] === undefined ? "" : String(row[i]); });
    out.push(obj);
  }
  return out;
}

function findRowById(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // fila real (1-indexed + encabezado)
  }
  return -1;
}

function entryToRow(entry) {
  return HEADERS.map((h) => entry[h] == null ? "" : entry[h]);
}

/* ---------- Operaciones ---------- */
function createEntry(sheet, entry) {
  if (!entry || !String(entry.name || "").trim()) throw new Error("El nombre es obligatorio.");
  const now = new Date().toISOString();
  const full = {
    id: Utilities.getUuid(),
    category: entry.category || "notas",
    name: entry.name || "",
    summary: entry.summary || "",
    body: entry.body || "",
    tags: entry.tags || "",
    imageUrl: entry.imageUrl || "",
    relations: entry.relations || "",
    author: entry.author || "Anónimo",
    createdAt: now,
    updatedAt: now,
  };
  sheet.appendRow(entryToRow(full));
  return full;
}

function updateEntry(sheet, entry) {
  if (!entry || !entry.id) throw new Error("Falta el id de la entrada.");
  const rowNum = findRowById(sheet, entry.id);
  if (rowNum === -1) throw new Error("Entrada no encontrada.");
  const current = sheet.getRange(rowNum, 1, 1, HEADERS.length).getValues()[0];
  const full = {
    id: entry.id,
    category: entry.category || current[1],
    name: entry.name || current[2],
    summary: entry.summary != null ? entry.summary : current[3],
    body: entry.body != null ? entry.body : current[4],
    tags: entry.tags != null ? entry.tags : current[5],
    imageUrl: entry.imageUrl != null ? entry.imageUrl : current[6],
    relations: entry.relations != null ? entry.relations : current[7],
    author: entry.author || current[8] || "Anónimo",
    createdAt: current[9] || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sheet.getRange(rowNum, 1, 1, HEADERS.length).setValues([entryToRow(full)]);
  return full;
}

function deleteEntry(sheet, id) {
  if (!id) throw new Error("Falta el id.");
  const rowNum = findRowById(sheet, id);
  if (rowNum === -1) throw new Error("Entrada no encontrada.");
  sheet.deleteRow(rowNum);
  return id;
}

/* ---------- Respuesta JSON ---------- */
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
