/**
 * Code.gs — Apps Script para Mundial Pibardos
 * ============================================================
 * Esto permite que la web AÑADA apuestas y las marque como GANADA/PERDIDA
 * directamente en tu Google Sheet, sin que tengas que abrirlo a mano.
 *
 * CÓMO INSTALARLO (o actualizarlo si ya lo tenías):
 * 1. Abre tu Google Sheet.
 * 2. Menú "Extensiones" → "Apps Script".
 * 3. Borra el contenido de Code.gs que aparece y pega TODO este archivo.
 * 4. Pulsa el icono de guardar (💾).
 * 5. Arriba a la derecha, botón azul "Implementar":
 *      - Si es la primera vez: "Nueva implementación" → tipo "Aplicación web"
 *        → Ejecutar como "Yo", Quién tiene acceso "Cualquier usuario" → Implementar.
 *      - Si ya tenías una implementación: "Gestionar implementaciones" → lápiz
 *        (editar) → en "Versión" elige "Nueva versión" → Implementar.
 *        ¡OJO! Guardar el código NO actualiza la URL ya publicada, hay que
 *        hacer este paso de "Nueva versión" siempre que cambies el script.
 * 6. Copia la URL que termina en /exec y pégala en sheets.js, en
 *    la constante APPS_SCRIPT_URL (solo la primera vez, no cambia).
 */

function doGet(e) {
  const action = e.parameter.action || "add";
  if (action === "resolve") return handleResolve(e);
  return handleAdd(e);
}

function handleAdd(e) {
  try {
    const params = e.parameter;

    const partido = String(params.partido || "").trim();
    const apuesta = String(params.apuesta || "").trim();
    const cuota = Number(params.cuota);
    const importe = Number(params.importe);

    if (!partido || !apuesta || !cuota || !importe) {
      return jsonResponse({ ok: false, error: "Faltan campos obligatorios" });
    }

    const posibleGanancia = Math.round(cuota * importe * 100) / 100;

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    const row = sheet.getLastRow() + 1;

    sheet.getRange(row, 1).setValue(partido); // A: Partido
    sheet.getRange(row, 2).setValue(apuesta); // B: Apuesta
    sheet.getRange(row, 3).setValue(cuota); // C: Cuota
    sheet.getRange(row, 4).setValue(importe); // D: Importe
    sheet.getRange(row, 5).setValue(posibleGanancia); // E: Posible Ganancia

    // F: Status. Lo dejamos en blanco como TEXTO (no checkbox) = "pendiente".
    const statusCell = sheet.getRange(row, 6);
    statusCell.clearDataValidations();
    statusCell.setValue("");

    return jsonResponse({ ok: true, row: row });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleResolve(e) {
  try {
    const row = Number(e.parameter.row);
    const estado = String(e.parameter.estado || "");

    if (!row || (estado !== "ganada" && estado !== "perdida")) {
      return jsonResponse({ ok: false, error: "Parámetros inválidos (row/estado)" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    const statusCell = sheet.getRange(row, 6);
    // Quitamos cualquier casilla heredada y escribimos el resultado como texto.
    statusCell.clearDataValidations();
    statusCell.setValue(estado);

    return jsonResponse({ ok: true, row: row, estado: estado });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
