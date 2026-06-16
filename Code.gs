/**
 * Code.gs — Apps Script para Mundial Pibardos
 * ============================================================
 * Esto permite que la web AÑADA apuestas directamente a tu Google Sheet,
 * sin que tengas que abrir el Sheet a mano cada vez.
 *
 * CÓMO INSTALARLO:
 * 1. Abre tu Google Sheet.
 * 2. Menú "Extensiones" → "Apps Script".
 * 3. Borra el contenido de Code.gs que aparece por defecto y pega TODO este archivo.
 * 4. Pulsa el icono de guardar (💾).
 * 5. Arriba a la derecha, botón azul "Implementar" → "Nueva implementación".
 * 6. En "Seleccionar tipo", elige "Aplicación web".
 * 7. Configúralo así:
 *      Ejecutar como: Yo (tu cuenta)
 *      Quién tiene acceso: Cualquier usuario
 * 8. Pulsa "Implementar". Te pedirá autorizar permisos la primera vez (acepta).
 * 9. Copia la URL que te da (termina en /exec) y pégala en sheets.js,
 *    en la constante APPS_SCRIPT_URL.
 *
 * Si más adelante cambias el código, tendrás que hacer "Implementar" →
 * "Gestionar implementaciones" → editar (lápiz) → "Nueva versión" → Implementar,
 * para que los cambios se publiquen (guardar solo no actualiza la URL ya publicada).
 */

function doGet(e) {
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

    // F: Status. Si la columna tiene casillas (checkbox) heredadas, las
    // quitamos para esta celda y la dejamos realmente vacía = "pendiente".
    const statusCell = sheet.getRange(row, 6);
    statusCell.clearDataValidations();
    statusCell.setValue("");

    return jsonResponse({ ok: true, row: row });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
