/* ============================================================
   Enciclopedia del Mundo — Backend (Google Apps Script)  ·  v2
   ------------------------------------------------------------
   Puente entre la página web y tu Hoja de Google.
   Se pega en Extensiones > Apps Script y se publica como "App web".

   >>> IMPORTANTE: cambiá SECRET por su contraseña compartida. <<<

   NOVEDAD v2: agrega las columnas de la capa narrativa (escenas,
   decisiones, variables). Si ya tenías la v1, esta versión detecta
   las columnas que faltan y las agrega sola, sin perder datos.
   ============================================================ */

const SECRET = "CAMBIAR_ESTA_CLAVE"; // ← poné acá su contraseña compartida
const SHEET_NAME = "Entries";

// Columnas. Las 11 primeras son las de siempre; el resto es la capa narrativa.
const HEADERS = [
  "id", "category", "name", "summary", "body", "tags",
  "imageUrl", "relations", "author", "createdAt", "updatedAt",
  // --- narrativa ---
  "sceneType",   // inicio | escena | decision | final
  "chapter",     // capítulo al que pertenece
  "location",    // lugar donde ocurre
  "characters",  // personajes presentes (coma)
  "choices",     // decisiones: "Etiqueta -> Escena destino | efectos | si: condición"
  "effects",     // variables que modifica la escena
  "conditions",  // requisitos para llegar
];

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
    const cols = headerMap(sheet);
    let result;
    switch (action) {
      case "list":   result = { entries: listEntries(sheet, cols), schema: HEADERS, version: 2 }; break;
      case "create": result = { entry: createEntry(sheet, cols, payload.entry) }; break;
      case "update": result = { entry: updateEntry(sheet, cols, payload.entry) }; break;
      case "delete": result = { id: deleteEntry(sheet, cols, payload.id) }; break;
      default:       result = { error: "Acción desconocida: " + action };
    }
    return json(result);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) });
  }
}

/* ============================================================
   Hoja y columnas
   ============================================================ */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const lastCol = sheet.getLastColumn();
  const existing = (sheet.getLastRow() > 0 && lastCol > 0)
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); })
    : [];

  if (!existing.length || !existing[0]) {
    // Hoja nueva o vacía: escribir todos los encabezados.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Migración automática: agregar al final las columnas que falten.
  const missing = HEADERS.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, 1, 1, existing.length + missing.length).setFontWeight("bold");
  }
  return sheet;
}

// Mapa nombre-de-columna → índice (0-based), según el orden REAL de la hoja.
// Así el usuario puede reordenar columnas sin romper nada.
function headerMap(sheet) {
  const lastCol = sheet.getLastColumn();
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let i = 0; i < row.length; i++) {
    const name = String(row[i]).trim();
    if (name) map[name] = i;
  }
  map.__width = lastCol;
  return map;
}

/* ============================================================
   Operaciones
   ============================================================ */
function listEntries(sheet, cols) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, cols.__width).getValues();
  const out = [];
  for (const row of values) {
    const id = cols.id != null ? row[cols.id] : "";
    if (!id) continue; // fila sin id => ignorar
    const obj = {};
    for (const h of HEADERS) {
      const idx = cols[h];
      const v = (idx == null) ? "" : row[idx];
      obj[h] = (v === null || v === undefined) ? "" : String(v);
    }
    out.push(obj);
  }
  return out;
}

function findRowById(sheet, cols, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const idCol = cols.id;
  const ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// Convierte un objeto en una fila respetando el orden real de columnas.
function toRow(entry, cols) {
  const row = new Array(cols.__width).fill("");
  for (const h of HEADERS) {
    const idx = cols[h];
    if (idx != null && entry[h] != null) row[idx] = entry[h];
  }
  return row;
}

function blankEntry() {
  const o = {};
  for (const h of HEADERS) o[h] = "";
  return o;
}

function createEntry(sheet, cols, entry) {
  if (!entry || !String(entry.name || "").trim()) throw new Error("El nombre es obligatorio.");
  const now = new Date().toISOString();
  const full = blankEntry();
  for (const h of HEADERS) if (entry[h] != null) full[h] = String(entry[h]);
  full.id = Utilities.getUuid();
  full.category = entry.category || "notas";
  full.author = entry.author || "Anónimo";
  full.createdAt = now;
  full.updatedAt = now;
  sheet.appendRow(toRow(full, cols));
  return full;
}

function updateEntry(sheet, cols, entry) {
  if (!entry || !entry.id) throw new Error("Falta el id de la entrada.");
  const rowNum = findRowById(sheet, cols, entry.id);
  if (rowNum === -1) throw new Error("Entrada no encontrada.");
  const current = sheet.getRange(rowNum, 1, 1, cols.__width).getValues()[0];

  const full = blankEntry();
  for (const h of HEADERS) {
    const idx = cols[h];
    const prev = (idx == null) ? "" : (current[idx] == null ? "" : String(current[idx]));
    full[h] = (entry[h] != null) ? String(entry[h]) : prev;
  }
  full.id = entry.id;
  full.createdAt = (cols.createdAt != null && current[cols.createdAt]) ? String(current[cols.createdAt]) : new Date().toISOString();
  full.updatedAt = new Date().toISOString();
  if (!full.author) full.author = "Anónimo";

  sheet.getRange(rowNum, 1, 1, cols.__width).setValues([toRow(full, cols)]);
  return full;
}

function deleteEntry(sheet, cols, id) {
  if (!id) throw new Error("Falta el id.");
  const rowNum = findRowById(sheet, cols, id);
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
