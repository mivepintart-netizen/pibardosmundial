// ============================================================
// sheets.js — Sincronización con Google Sheets
// ============================================================
// Sustituye a localStorage como fuente de datos: lee el Google Sheet
// del grupo, lo transforma al mismo formato que usaba app.js
// ({ boteInicial, participantes, apuestas }) y hace polling cada
// POLL_INTERVAL_MS para que todo el mundo vea los cambios sin recargar.
//
// El Sheet sigue siendo de SOLO LECTURA desde la web: para añadir o
// corregir una apuesta hay que editar el propio Google Sheet.

(function () {
  "use strict";

  // ---- Configuración ----
  const CONFIG = {
    SHEET_ID: "1fArzmnr_DomX_IowuOGmkW091O9fgL4Vwqdc7eMak78",
    GID: null, // null = la primera pestaña visible (no asumimos un id concreto)
    POLL_INTERVAL_MS: 45000, // entre 30 y 60 segundos

    // URL del Web App de Google Apps Script (ver Code.gs) que permite AÑADIR
    // apuestas desde la web. Tienes que desplegarlo tú y pegar la URL aquí.
    // Instrucciones en el mensaje / README que acompaña a este código.
    APPS_SCRIPT_URL: "PEGA_AQUI_LA_URL_DE_TU_APPS_SCRIPT",
  };

  function sheetUrl() {
    // El "_=" al final evita que el navegador devuelva una respuesta cacheada
    let url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&_=${Date.now()}`;
    if (CONFIG.GID !== null && CONFIG.GID !== undefined) {
      url += `&gid=${CONFIG.GID}`;
    }
    return url;
  }

  // ---- Helpers de parseo ----
  function cellValue(row, colIndex) {
    if (!row || !row.c) return null;
    const cell = row.c[colIndex];
    return cell ? cell.v : null;
  }

  function toNumber(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  function normalizeStatus(raw) {
    // La columna de estado puede ser una casilla (true/false) o texto.
    // Importante: una casilla NUNCA puede estar "vacía" para Google, así que
    // con casillas no se puede distinguir "pendiente" de "perdida" todavía.
    if (raw === true) return "ganada";
    if (raw === false) return "perdida";
    if (raw === null || raw === undefined || raw === "") return "pendiente";

    const s = String(raw).trim().toLowerCase();
    if (["ganada", "ganado", "gano", "ganó", "won", "win", "true", "✅"].some((k) => s.includes(k))) {
      return "ganada";
    }
    if (["perdida", "perdido", "lost", "false", "❌"].some((k) => s.includes(k))) {
      return "perdida";
    }
    return "pendiente";
  }

  // Busca una celda de texto exacto (ej. "BOTE", "Partido") en toda la hoja
  // y devuelve su posición {r, c}. Así no dependemos de que las filas/columnas
  // estén siempre en el mismo sitio si alguien reordena el Sheet un poco.
  function findLabel(rows, label) {
    const target = label.trim().toLowerCase();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.c) continue;
      for (let c = 0; c < row.c.length; c++) {
        const cell = row.c[c];
        if (cell && typeof cell.v === "string" && cell.v.trim().toLowerCase() === target) {
          return { r, c };
        }
      }
    }
    return null;
  }

  function parseGvizResponse(text) {
    // La respuesta viene envuelta como: /*O_o*/ google.visualization.Query.setResponse({...});
    const start = text.indexOf("(");
    const end = text.lastIndexOf(")");
    if (start === -1 || end === -1) throw new Error("Respuesta de Google Sheets con formato inesperado");
    const json = JSON.parse(text.substring(start + 1, end));
    if (json.status && json.status !== "ok") {
      throw new Error("Google Sheets devolvió status: " + json.status);
    }
    return json.table;
  }

  function parseSheetState(table) {
    const rows = table.rows || [];

    // --- Apuestas (tabla Partido | Apuesta | Cuota | Importe | Posible Ganancia | Status) ---
    const partidoPos = findLabel(rows, "Partido");
    if (!partidoPos) {
      throw new Error('No encuentro la cabecera "Partido" en el Sheet (¿pestaña o estructura distinta?)');
    }

    // --- Bote inicial ---
    // OJO: la celda de texto "BOTE" vive en la misma columna que las Cuotas
    // (números), así que Google la trata como columna numérica y anula el
    // texto "BOTE" (lo convierte en null). Por eso no podemos buscarlo por
    // etiqueta: leemos directamente la fila 1, en la misma columna que
    // "Importe" (3 columnas a la derecha de "Partido"), que es donde tu
    // plantilla pone siempre el valor del bote.
    const boteInicial = toNumber(cellValue(rows[0], partidoPos.c + 3));

    const apuestas = [];
    {
      let r = partidoPos.r + 1;
      let autoId = 1;
      while (r < rows.length) {
        const partido = cellValue(rows[r], partidoPos.c);
        if (!partido) break; // primera fila vacía = fin de la tabla
        apuestas.push({
          id: autoId++,
          partido: String(partido),
          apuesta: String(cellValue(rows[r], partidoPos.c + 1) || ""),
          cuota: toNumber(cellValue(rows[r], partidoPos.c + 2)),
          importe: toNumber(cellValue(rows[r], partidoPos.c + 3)),
          posibleGanancia: toNumber(cellValue(rows[r], partidoPos.c + 4)),
          estado: normalizeStatus(cellValue(rows[r], partidoPos.c + 5)),
        });
        r++;
      }
    }

    // --- Participantes (tabla Participantes | Importe | A repartir) ---
    const participantes = [];
    const participantesPos = findLabel(rows, "Participantes");
    if (participantesPos) {
      let r = participantesPos.r + 1;
      let autoId = 1;
      while (r < rows.length) {
        const nombre = cellValue(rows[r], participantesPos.c);
        if (!nombre) break;
        participantes.push({
          id: autoId++,
          nombre: String(nombre),
          aportacion: toNumber(cellValue(rows[r], participantesPos.c + 1)),
        });
        r++;
      }
    }

    return { boteInicial, participantes, apuestas };
  }

  // ---- Controlador de polling ----
  const listeners = [];
  let lastState = null;
  let lastBetCount = null;
  let pollTimer = null;

  function notify(eventName, payload) {
    listeners.forEach((fn) => {
      try {
        fn(eventName, payload);
      } catch (e) {
        console.error("[SheetSync] Error en listener:", e);
      }
    });
  }

  async function syncOnce() {
    notify("sync-start");
    try {
      const res = await fetch(sheetUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const table = parseGvizResponse(text);
      const newState = parseSheetState(table);

      // Detectar apuestas nuevas (comparando cuántas había antes vs ahora)
      if (lastBetCount !== null && newState.apuestas.length > lastBetCount) {
        const added = newState.apuestas.slice(lastBetCount);
        notify("new-bets", added);
        notifyExternalChannels(added, newState);
      }
      lastBetCount = newState.apuestas.length;

      lastState = newState;
      notify("update", newState);
      notify("sync-ok");
    } catch (err) {
      console.error("[SheetSync] Error sincronizando con Google Sheets:", err);
      notify("sync-error", err);
    }
  }

  // ============================================================
  // Punto de enganche para futuras notificaciones (WhatsApp / Telegram)
  // ============================================================
  // Se llama automáticamente cada vez que se detectan apuestas nuevas
  // en el Sheet. Por ahora solo deja constancia en la consola; cuando
  // tengas tu bot de WhatsApp o un bot de Telegram, descomenta y adapta
  // el fetch de abajo para que les avise.
  function notifyExternalChannels(newBets, fullState) {
    // fetch('https://tu-bot.tudominio.com/notify', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ newBets, fullState }),
    // }).catch((e) => console.error('No se pudo notificar al canal externo:', e));

    console.log("[SheetSync] Apuestas nuevas detectadas (canal externo pendiente de conectar):", newBets);
  }

  // ============================================================
  // Añadir una apuesta nueva desde la web (escribe en el Sheet)
  // ============================================================
  async function submitBet(payload) {
    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("PEGA_AQUI")) {
      throw new Error(
        "Falta configurar APPS_SCRIPT_URL en sheets.js (despliega el Apps Script y pega la URL)"
      );
    }

    // Usamos text/plain para evitar el preflight de CORS; el Apps Script
    // hace JSON.parse(e.postData.contents) igualmente.
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("El Apps Script respondió HTTP " + res.status);

    try {
      const data = await res.json();
      if (data && data.ok === false) throw new Error(data.error || "Error desconocido del Apps Script");
      return data;
    } catch (e) {
      // Si no se puede leer/parsear la respuesta (a veces pasa por CORS),
      // no lo tratamos como fallo: el siguiente sync confirmará si se guardó.
      return null;
    }
  }

  // ---- API pública ----
  window.SheetSync = {
    init() {
      syncOnce();
      pollTimer = setInterval(syncOnce, CONFIG.POLL_INTERVAL_MS);
    },
    stop() {
      if (pollTimer) clearInterval(pollTimer);
    },
    refreshNow() {
      return syncOnce();
    },
    submitBet,
    getState() {
      return lastState;
    },
    onUpdate(fn) {
      listeners.push(fn);
    },
    config: CONFIG,
  };
})();
