// ============================================================
// app.js — Mundial 2026 Bet Tracker — Application Logic
// ============================================================

(function () {
  "use strict";

  // ---- Constants ----
  // (ya no usamos localStorage: los datos vienen de Google Sheets vía sheets.js)

  // ---- State ----
  // Arrancamos con los datos del Excel como placeholder mientras llega
  // la primera respuesta del Sheet, para no mostrar la pantalla vacía.
  let state = JSON.parse(JSON.stringify(INITIAL_DATA));
  let currentFilter = "all";
  let lastSyncAt = null;

  // ---- DOM Refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Stats
    statBote: $("#stat-bote"),
    statBoteSub: $("#stat-bote-sub"),
    statActual: $("#stat-actual"),
    statActualSub: $("#stat-actual-sub"),
    statBalance: $("#stat-balance"),
    statBalanceSub: $("#stat-balance-sub"),
    statBalanceCard: $("#stat-balance-card"),
    statAcierto: $("#stat-acierto"),
    statAciertoSub: $("#stat-acierto-sub"),

    // Lists
    betsList: $("#bets-list"),
    betCount: $("#bet-count"),
    participantsSummary: $("#participants-summary"),

    // Player of the day
    playerOfDaySection: $("#player-of-day-section"),
    playerOfDayCard: $("#player-of-day-card"),

    // Chart
    chartWrapper: $("#chart-wrapper"),
    chartCurrent: $("#chart-current"),

    // Achievements
    achievementsSection: $("#achievements-section"),
    achievementsList: $("#achievements-list"),

    // Filters
    filterGroup: $("#filter-group"),

    // Sync badge
    syncBadge: $("#sync-badge"),
    syncDot: $("#sync-dot"),
    syncText: $("#sync-text"),
    btnRefresh: $("#btn-refresh"),

    // Add Bet Modal
    modalOverlay: $("#modal-overlay"),
    modalClose: $("#modal-close"),
    betForm: $("#bet-form"),
    inputPartido: $("#input-partido"),
    inputApuesta: $("#input-apuesta"),
    inputCuota: $("#input-cuota"),
    inputImporte: $("#input-importe"),
    previewGanancia: $("#preview-ganancia"),
    btnCancel: $("#btn-cancel"),
    btnSubmit: $("#btn-submit"),

    // Share Modal
    shareOverlay: $("#share-overlay"),
    shareClose: $("#share-close"),
    shareMessage: $("#share-message"),
    btnCopy: $("#btn-copy"),
    btnWhatsapp: $("#btn-whatsapp"),

    // Buttons
    btnAdd: $("#btn-add"),
    btnShare: $("#btn-share"),
    btnExport: $("#btn-export"),

    // Toast
    toast: $("#toast"),
    toastIcon: $("#toast-icon"),
    toastMessage: $("#toast-message"),
  };

  // ---- Initialize ----
  function init() {
    renderAll();
    bindEvents();
    bindSheetSync();
    SheetSync.init();
    setInterval(tickSyncBadge, 1000);
  }

  // ---- Sincronización con Google Sheets ----
  let firstSync = true;

  function bindSheetSync() {
    SheetSync.onUpdate((event, payload) => {
      if (event === "sync-start") {
        setSyncBadge("loading", "Sincronizando…");
      } else if (event === "update") {
        state = payload;
        renderAll();
        lastSyncAt = Date.now();
        dom.syncBadge.title = "Estado de sincronización con Google Sheets";
        setSyncBadge("ok", "Sincronizado ahora");

        // Solo en el primer sync al abrir la app
        if (firstSync) {
          firstSync = false;
          const streak = getCurrentWinStreak();
          if (streak >= 3) launchMoneyRain(streak);
          // Mostrar resumen de lo que pasó desde la última visita (una vez al día)
          checkDailySummary();
        }
      } else if (event === "sync-error") {
        setSyncBadge("error", "No se pudo sincronizar");
        if (payload && payload.message) {
          dom.syncBadge.title = payload.message;
        }
      } else if (event === "new-bets") {
        const n = payload.length;
        showToast(
          "🆕",
          `${n} apuesta${n > 1 ? "s" : ""} nueva${n > 1 ? "s" : ""} detectada${n > 1 ? "s" : ""}`,
          "success"
        );
      }
    });
  }

  // Calcula cuántos aciertos seguidos hay ahora mismo (desde la más reciente)
  function getCurrentWinStreak() {
    const resueltas = state.apuestas.filter(
      (a) => a.estado === "ganada" || a.estado === "perdida"
    );
    let streak = 0;
    for (let i = resueltas.length - 1; i >= 0; i--) {
      if (resueltas[i].estado === "ganada") streak++;
      else break;
    }
    return streak;
  }

  // ---- Resumen diario (pop-up al abrir una vez al día) ----
  const STORAGE_KEY_SEEN    = "pibardos_summary_seen_date";
  const STORAGE_KEY_SNAPSHOT = "pibardos_snapshot_resolved";

  function checkDailySummary() {
    // El "día de apuestas" va de 7:00 a 7:00.
    // Si son las 3am del martes, aún estamos en el día del lunes.
    const now = new Date();
    const betDay = new Date(now);
    if (now.getHours() < 7) betDay.setDate(betDay.getDate() - 1);
    const today = betDay.toISOString().slice(0, 10);
    const lastSeen = localStorage.getItem(STORAGE_KEY_SEEN);

    // Ya lo vio hoy → no mostrar
    if (lastSeen === today) return;

    // Snapshot de las apuestas resueltas de la visita anterior
    let prevResolved = [];
    try {
      prevResolved = JSON.parse(localStorage.getItem(STORAGE_KEY_SNAPSHOT) || "[]");
    } catch (e) {}

    const currResolved = state.apuestas.filter(
      (a) => a.estado === "ganada" || a.estado === "perdida"
    );

    // IDs que ya estaban resueltos la última vez
    const prevIds = new Set(prevResolved.map((a) => a.id));

    // Apuestas nuevamente resueltas desde la última visita
    const newlyResolved = currResolved.filter((a) => !prevIds.has(a.id));

    // Guardar snapshot actual y marcar como visto hoy
    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(currResolved));
    localStorage.setItem(STORAGE_KEY_SEEN, today);

    // Si no hay nada nuevo resuelto desde la última visita → no molestar
    if (newlyResolved.length === 0) return;

    showDailySummaryModal(newlyResolved);
  }

  function showDailySummaryModal(bets) {
    const ganadas = bets.filter((b) => b.estado === "ganada");
    const perdidas = bets.filter((b) => b.estado === "perdida");
    const netGanado = ganadas.reduce((s, b) => s + b.posibleGanancia - b.importe, 0);
    const netPerdido = perdidas.reduce((s, b) => s + b.importe, 0);
    const net = netGanado - netPerdido;
    const esPositivo = net >= 0;

    const frase = esPositivo
      ? FRASES_GANADA[ganadas.length >= 5 ? 5 : ganadas.length >= 3 ? 3 : ganadas.length >= 2 ? 2 : 1][0]
      : FRASES_PERDIDA[perdidas.length >= 5 ? 5 : perdidas.length >= 3 ? 3 : perdidas.length >= 2 ? 2 : 1][0];

    const betRows = bets.map((b) => `
      <div class="summary-bet-row ${b.estado}">
        <span class="summary-bet-icon">${b.estado === "ganada" ? "✅" : "❌"}</span>
        <div class="summary-bet-info">
          <span class="summary-bet-partido">${escapeHtml(b.partido)}</span>
          <span class="summary-bet-apuesta">${escapeHtml(b.apuesta)}</span>
        </div>
        <span class="summary-bet-amount ${b.estado === "ganada" ? "positive" : "negative"}">
          ${b.estado === "ganada" ? "+" : "-"}${formatEuroShort(b.estado === "ganada" ? b.posibleGanancia - b.importe : b.importe)}
        </span>
      </div>`).join("");

    const modal = document.createElement("div");
    modal.id = "daily-summary-overlay";
    modal.innerHTML = `
      <div class="daily-summary-modal">
        <div class="daily-summary-header">
          <span class="daily-summary-title">📋 Desde tu última visita</span>
          <button class="modal-close" id="daily-summary-close">&times;</button>
        </div>
        <div class="daily-summary-stats">
          <div class="daily-summary-stat">
            <span class="daily-summary-stat-value">${bets.length}</span>
            <span class="daily-summary-stat-label">apuestas resueltas</span>
          </div>
          <div class="daily-summary-stat">
            <span class="daily-summary-stat-value">${ganadas.length}✅ / ${perdidas.length}❌</span>
            <span class="daily-summary-stat-label">ganadads / perdidas</span>
          </div>
          <div class="daily-summary-stat">
            <span class="daily-summary-stat-value ${esPositivo ? "positive" : "negative"}">
              ${esPositivo ? "+" : ""}${formatEuroShort(net)}
            </span>
            <span class="daily-summary-stat-label">resultado neto</span>
          </div>
        </div>
        <div class="daily-summary-frase">"${escapeHtml(frase)}"</div>
        <div class="daily-summary-bets">${betRows}</div>
        <button class="btn btn-primary daily-summary-ok" id="daily-summary-ok">Entendido</button>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById("daily-summary-close").addEventListener("click", close);
    document.getElementById("daily-summary-ok").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  }

  // ---- Lluvia de billetes con las caras de la peña ----
  const BILL_IMG = new Image();
  const PERSON_IMG = new Image();
  PERSON_IMG.src = "data:image/jpeg;base64,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";
  BILL_IMG.src = "data:image/jpeg;base64,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";

  function launchMoneyRain(streak) {
    streak = streak || 4;

    // Configuración según el nivel de racha
    // 4: lluvia normal
    // 5: más billetes, más rápido
    // 6: espiral + billetes girando fuerte
    // 7+: caos total, billetes desde todos los ángulos, rebotes
    const cfg =
      streak >= 7
        ? { count: 60, speed: [3, 7], spin: 0.12, scale: [0.6, 1.4], duration: 7000, mode: "caos" }
        : streak >= 6
        ? { count: 50, speed: [2.5, 5.5], spin: 0.08, scale: [0.5, 1.2], duration: 6000, mode: "espiral" }
        : streak >= 5
        ? { count: 42, speed: [2, 4.5], spin: 0.05, scale: [0.6, 1.1], duration: 6000, mode: "rapido" }
        : { count: 30, speed: [1.6, 4], spin: 0.03, scale: [0.75, 1.25], duration: 5000, mode: "normal" };

    const canvas = document.createElement("canvas");
    canvas.id = "money-rain";
    canvas.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const BILL_W = 220;
    const BILL_H = 146;
    const { duration: DURATION, mode } = cfg;
    const start = Date.now();

    function makeBill() {
      const b = {
        x: Math.random() * canvas.width,
        y: -BILL_H - Math.random() * canvas.height,
        speed: cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0]),
        angle: (Math.random() - 0.5) * (mode === "caos" ? 1.8 : 0.45),
        spin: (Math.random() - 0.5) * cfg.spin * 2,
        scale: cfg.scale[0] + Math.random() * (cfg.scale[1] - cfg.scale[0]),
        wobble: Math.random() * Math.PI * 2, // fase de aleteo
        wobbleSpeed: 0.04 + Math.random() * 0.04,
      };
      if (mode === "caos") {
        // También algunos vienen de los lados
        if (Math.random() < 0.3) {
          b.x = Math.random() < 0.5 ? -BILL_W : canvas.width + BILL_W;
          b.y = Math.random() * canvas.height;
          b.vx = (b.x < 0 ? 1 : -1) * (1 + Math.random() * 3);
        } else {
          b.vx = (Math.random() - 0.5) * 2;
        }
      } else if (mode === "espiral") {
        b.vx = Math.sin(b.y / 80) * 1.5;
      } else {
        b.vx = (Math.random() - 0.5) * 0.8;
      }
      return b;
    }

    const bills = Array.from({ length: cfg.count }, makeBill);

    function frame() {
      const elapsed = Date.now() - start;
      const opacity = elapsed > DURATION - 900
        ? Math.max(0, (DURATION - elapsed) / 900)
        : 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = opacity;

      bills.forEach((b) => {
        b.y += b.speed;
        b.x += b.vx || 0;
        b.angle += b.spin;
        b.wobble += b.wobbleSpeed;

        // Modo espiral: vx oscila en función de la posición
        if (mode === "espiral") b.vx = Math.sin(b.y / 70 + b.wobble) * 2.2;

        // Rebote lateral en modo caos
        if (mode === "caos") {
          if (b.x < -BILL_W * 2 || b.x > canvas.width + BILL_W * 2) b.vx *= -1;
        }

        if (b.y > canvas.height + BILL_H * 2) {
          Object.assign(b, makeBill());
          b.y = -BILL_H;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        // aleteo con onda sinusoidal
        const flap = Math.sin(b.wobble) * 0.18 + 0.82;
        ctx.scale(b.scale * flap, b.scale);
        ctx.drawImage(BILL_IMG, -BILL_W / 2, -BILL_H / 2, BILL_W, BILL_H);
        ctx.restore();
      });

      // ---- Dibujar el personaje tirando billetes ----
      const PW = 120, PH = 200;
      const px = 10;
      // Sube y baja suavemente con el tiempo (animación de "lanzamiento")
      const throwCycle = (elapsed % 800) / 800; // ciclo de 800ms
      const py = -PH + PH * 0.18 + Math.sin(throwCycle * Math.PI * 2) * 8;
      const armAngle = Math.sin(throwCycle * Math.PI * 2) * 0.25; // "brazo" oscila

      ctx.save();
      ctx.globalAlpha = opacity;
      // Sombra bajo el personaje
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 12;
      ctx.drawImage(PERSON_IMG, px, py, PW, PH);
      ctx.restore();

      if (elapsed < DURATION) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }

    if (BILL_IMG.complete) {
      requestAnimationFrame(frame);
    } else {
      BILL_IMG.onload = () => requestAnimationFrame(frame);
    }
  }

  function setSyncBadge(status, text) {
    dom.syncBadge.classList.remove("ok", "loading", "error");
    dom.syncBadge.classList.add(status);
    dom.syncText.textContent = text;
  }

  function tickSyncBadge() {
    if (!lastSyncAt) return;
    if (dom.syncBadge.classList.contains("error")) return; // no pisar el mensaje de error
    if (dom.syncBadge.classList.contains("loading")) return;
    const secs = Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000));
    const when = secs < 5 ? "ahora" : `hace ${secs}s`;
    dom.syncText.textContent = `Sincronizado ${when}`;
  }

  // ---- Calculations ----
  function calcStats() {
    const apuestas = state.apuestas;
    const resueltas = apuestas.filter(
      (a) => a.estado === "ganada" || a.estado === "perdida"
    );
    const ganadas = apuestas.filter((a) => a.estado === "ganada");
    const perdidas = apuestas.filter((a) => a.estado === "perdida");
    const pendientes = apuestas.filter((a) => a.estado === "pendiente");

    const totalGanado = ganadas.reduce((sum, a) => sum + a.posibleGanancia, 0);
    const totalPerdido = perdidas.reduce((sum, a) => sum + a.importe, 0);
    const totalPendiente = pendientes.reduce((sum, a) => sum + a.importe, 0);
    const ganadasStakes = ganadas.reduce((sum, a) => sum + a.importe, 0);

    // Misma fórmula que en el Sheet:
    // Dinero actual = Bote inicial - TODO lo apostado (también lo pendiente,
    // porque ese dinero ya ha salido del bote en el momento de apostar) +
    // lo ganado en bruto de las apuestas ya acertadas.
    const totalApostadoTodas = apuestas.reduce((sum, a) => sum + a.importe, 0);
    const dineroActual = state.boteInicial - totalApostadoTodas + totalGanado;

    const balance = dineroActual - state.boteInicial;

    const pctAcierto =
      resueltas.length > 0
        ? Math.round((ganadas.length / resueltas.length) * 100)
        : 0;

    const numParticipantes = state.participantes.length;
    const aRepartir =
      numParticipantes > 0 ? dineroActual / numParticipantes : 0;

    return {
      boteInicial: state.boteInicial,
      dineroActual,
      balance,
      pctAcierto,
      totalGanadas: ganadas.length,
      totalPerdidas: perdidas.length,
      totalPendientes: pendientes.length,
      totalResueltas: resueltas.length,
      totalApuestas: apuestas.length,
      totalGanado,
      totalPerdido,
      totalPendiente,
      ganadasStakes,
      aRepartir,
      numParticipantes,
    };
  }

  // ---- Formatting ----
  function formatEuro(amount) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    }).format(amount);
  }

  function formatEuroShort(amount) {
    return (
      amount.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " €"
    );
  }

  // ---- Render Functions ----
  function renderAll() {
    renderPlayerOfDay();
    renderStats();
    renderChart();
    renderAchievements();
    renderBets();
    renderParticipants();
  }

  function renderPlayerOfDay() {
    const jugador = state.jugadorDelDia;
    if (!jugador || !jugador.nombre) {
      dom.playerOfDaySection.classList.remove("show");
      dom.playerOfDayCard.innerHTML = "";
      return;
    }
    dom.playerOfDaySection.classList.add("show");
    dom.playerOfDayCard.innerHTML = `
      ${
        jugador.foto
          ? `<img class="player-of-day-photo" src="${escapeHtml(jugador.foto)}" alt="${escapeHtml(jugador.nombre)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;player-of-day-photo player-of-day-placeholder&quot;>⚽</div>'">`
          : `<div class="player-of-day-photo player-of-day-placeholder">⚽</div>`
      }
      <div class="player-of-day-info">
        <span class="player-of-day-tag">🌟 Jugador del día</span>
        <span class="player-of-day-name">${escapeHtml(jugador.nombre)}</span>
        ${jugador.motivo ? `<span class="player-of-day-motivo">${escapeHtml(jugador.motivo)}</span>` : ""}
      </div>`;
  }

  function renderStats() {
    const s = calcStats();

    dom.statBote.textContent = formatEuro(s.boteInicial);
    dom.statBoteSub.textContent = `${s.numParticipantes} participantes`;

    dom.statActual.textContent = formatEuro(s.dineroActual);
    dom.statActualSub.textContent = `en el bote`;

    dom.statBalance.textContent =
      (s.balance >= 0 ? "+" : "") + formatEuro(s.balance);
    dom.statBalanceSub.textContent = `desde el inicio`;
    dom.statBalanceCard.classList.toggle("negative", s.balance < 0);

    dom.statAcierto.textContent = s.pctAcierto + "%";
    dom.statAciertoSub.textContent = `${s.totalGanadas} de ${s.totalResueltas} resueltas`;
  }

  // ---- Chart: evolución del dinero ----

  function niceTicks(min, max, count) {
    const range = max - min || 1;
    const rawStep = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = Math.ceil(rawStep / mag) * mag || 1;
    const ticks = [];
    let v = Math.ceil(min / step) * step;
    while (v <= max) {
      ticks.push(v);
      v += step;
    }
    return ticks;
  }

  function buildHistorial() {
    // Solo las apuestas YA RESUELTAS mueven la gráfica (las pendientes no
    // cambian el dinero actual todavía, así que no generan punto nuevo).
    let running = state.boteInicial;
    const puntos = [{ valor: running, label: "Inicio", delta: 0, estado: "inicio" }];
    state.apuestas.forEach((a) => {
      if (a.estado === "pendiente") return;
      const delta = a.estado === "ganada" ? a.posibleGanancia - a.importe : -a.importe;
      running += delta;
      puntos.push({ valor: running, label: a.partido, delta, estado: a.estado });
    });
    return puntos;
  }

  // Convierte una serie de puntos {x,y} en un path SVG suave (Catmull-Rom -> Bézier)
  function smoothPath(pts) {
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? i : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  }

  function renderChart() {
    const historial = buildHistorial();
    const actual = historial[historial.length - 1].valor;
    dom.chartCurrent.textContent = formatEuroShort(actual);
    dom.chartCurrent.className = "chart-current " + (actual >= state.boteInicial ? "positive" : "negative");

    const W = 700;
    const H = 240;
    const PAD_L = 16;
    const PAD_R = 16;
    const PAD_T = 24;
    const PAD_B = 16;

    const valores = historial.map((p) => p.valor);
    // Encuadramos el eje en la zona donde realmente se mueve el dinero
    // (en vez de arrancar siempre desde 0), para que las subidas y bajadas
    // se vean grandes y claras en vez de aplastadas contra el eje.
    const dataMin = Math.min(...valores, state.boteInicial);
    const dataMax = Math.max(...valores, state.boteInicial);
    const dataRange = dataMax - dataMin || Math.max(dataMax * 0.1, 10);
    const padding = dataRange * 0.25;

    const yMax = dataMax + padding;
    const yMin = dataMin - padding;
    const range = yMax - yMin || 1;

    const niveles = niceTicks(yMin, yMax, 4).map((value) => ({ value }));

    const xFor = (i) =>
      historial.length > 1
        ? PAD_L + (i / (historial.length - 1)) * (W - PAD_L - PAD_R)
        : (PAD_L + (W - PAD_R)) / 2;
    const yFor = (v) => PAD_T + (1 - (v - yMin) / range) * (H - PAD_T - PAD_B);

    // Líneas de referencia (en euros)
    const gridLines = niveles
      .map((nivel) => {
        const y = yFor(nivel.value);
        return `
          <line x1="${PAD_L}" y1="${y.toFixed(2)}" x2="${W - PAD_R}" y2="${y.toFixed(2)}" class="chart-gridline" />
          <text x="${PAD_L}" y="${(y - 5).toFixed(2)}" class="chart-gridlabel">${formatEuroShort(nivel.value)}</text>
        `;
      })
      .join("");

    // Línea base: el bote inicial, para ver de un vistazo si vais ganando o perdiendo
    const baseY = yFor(state.boteInicial);
    const baseLine = `
      <line x1="${PAD_L}" y1="${baseY.toFixed(2)}" x2="${W - PAD_R}" y2="${baseY.toFixed(2)}" class="chart-baseline" />
    `;

    const pts = historial.map((p, i) => ({ x: xFor(i), y: yFor(p.valor), ...p }));
    const linePath = smoothPath(pts);
    const baseLineY = yFor(yMin);
    const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(2)} ${baseLineY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${baseLineY.toFixed(2)} Z`;

    const lineColor = actual >= state.boteInicial ? "var(--green)" : "var(--red)";

    const dots = pts
      .map((p, i) => {
        const isLast = i === pts.length - 1;
        const color =
          p.estado === "ganada" ? "var(--green)" : p.estado === "perdida" ? "var(--red)" : "var(--gold-light)";
        const tooltip =
          p.estado === "inicio"
            ? `Bote inicial: ${formatEuroShort(p.valor)}`
            : `${p.label}: ${p.delta >= 0 ? "+" : ""}${formatEuroShort(p.delta)} → ${formatEuroShort(p.valor)}`;
        return `
          <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${isLast ? 5.5 : 3.5}" fill="${color}" class="chart-dot${isLast ? " chart-dot-current" : ""}">
            <title>${escapeHtml(tooltip)}</title>
          </circle>
        `;
      })
      .join("");

    dom.chartWrapper.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFillGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.32" />
            <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridLines}
        ${baseLine}
        <path d="${areaPath}" fill="url(#chartFillGradient)" />
        <path d="${linePath}" class="chart-line" stroke="${lineColor}" fill="none" />
        ${dots}
      </svg>
    `;
  }

  // ---- Logros: rachas de aciertos / fallos ----
  // Frases al estilo "La Sotanita" — algunas suyas reales, otras inventadas
  // en su mismo tono, organizadas por tamaño de racha.
  const FRASES_GANADA = {
    1: ["Bien, una menos para la ruina", "Ahí la metiste, qué menos"],
    2: ["2 aciertos seguidos, vamos bien", "Tu apuesta favorita ahora mismo: cualquiera de estas"],
    3: [
      "Estéticamente es una locura esta racha",
      "Esto no es normal, eh",
      "Métela tú que a mí me da la risa... y la metisteis",
    ],
    5: [
      "🏠 Road to Casa Matiki",
    ],
  };

  const FRASES_PERDIDA = {
    1: ["Si fallas, ríete, que se rían tus colegas y ya está", "Volvió a rodar la cuadrada"],
    2: ["Ponte las gafas, que no estáis acertando ni una", "2 fallos seguidos, cuidado"],
    3: [
      "Para qué acertarla, pudiendo fallarla",
      "Aciértala tú que a mí me da la risa",
      "Malas noticias para los amantes de las apuestas ganadoras",
    ],
    5: [
      "Friégalo tú que a mí me da la risa, dijo el bote",
      "Esto ya no es racha, es vocación",
      "Para qué acertarla, pudiendo fallarla... otra vez",
    ],
  };

  // Coge la frase de la categoría que corresponda según el tamaño de la racha
  // (1, 2, 3 o 5+), rotando entre las disponibles de esa categoría.
  function fraseParaRacha(pool, streak) {
    const tier = streak >= 5 ? 5 : streak >= 3 ? 3 : streak >= 2 ? 2 : 1;
    const opciones = pool[tier];
    return opciones[streak % opciones.length];
  }

  function calcAchievements() {
    const resueltas = state.apuestas.filter(
      (a) => a.estado === "ganada" || a.estado === "perdida"
    );
    const achievements = [];

    // Racha actual, contando desde la apuesta más reciente hacia atrás
    let currentStreak = 0;
    let currentType = null;
    for (let i = resueltas.length - 1; i >= 0; i--) {
      const estado = resueltas[i].estado;
      if (currentType === null) {
        currentType = estado;
        currentStreak = 1;
      } else if (estado === currentType) {
        currentStreak++;
      } else {
        break;
      }
    }

    if (currentStreak >= 1) {
      if (currentType === "ganada") {
        const icon =
          currentStreak >= 5 ? "🔥🔥🔥" : currentStreak >= 3 ? "🔥" : currentStreak >= 2 ? "✌️" : "👍";
        const frase = fraseParaRacha(FRASES_GANADA, currentStreak);
        const texto =
          currentStreak >= 2
            ? `${currentStreak} aciertos seguidos. "${frase}"`
            : `"${frase}"`;
        achievements.push({ icon, texto, tipo: "positive" });
      } else {
        const icon =
          currentStreak >= 5 ? "💀💀💀" : currentStreak >= 3 ? "💀" : currentStreak >= 2 ? "😬" : "🙃";
        const frase = fraseParaRacha(FRASES_PERDIDA, currentStreak);
        const texto =
          currentStreak >= 2
            ? `${currentStreak} fallos seguidos. "${frase}"`
            : `"${frase}"`;
        achievements.push({ icon, texto, tipo: "negative" });
      }
    }

    return achievements;
  }

  function renderAchievements() {
    const achievements = calcAchievements();
    if (achievements.length === 0) {
      dom.achievementsSection.classList.remove("show");
      dom.achievementsList.innerHTML = "";
      return;
    }
    dom.achievementsSection.classList.add("show");
    dom.achievementsList.innerHTML = achievements
      .map(
        (a) => `
      <div class="achievement-badge ${a.tipo}">
        <span class="achievement-icon">${a.icon}</span>
        <span class="achievement-text">${escapeHtml(a.texto)}</span>
      </div>`
      )
      .join("");
  }

  const BETS_INITIAL_VISIBLE = 5;
  let betsExpanded = false;

  function renderBets() {
    const filtered =
      currentFilter === "all"
        ? state.apuestas
        : state.apuestas.filter((a) => a.estado === currentFilter);

    if (filtered.length === 0) {
      dom.betsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚽</div>
          <div class="empty-state-text">
            ${
              currentFilter === "all"
                ? "Todavía no hay apuestas en el Sheet."
                : `No hay apuestas ${
                    currentFilter === "ganada"
                      ? "ganadas"
                      : currentFilter === "perdida"
                      ? "perdidas"
                      : "pendientes"
                  }`
            }
          </div>
        </div>`;
      dom.betCount.textContent = "0 apuestas";
      return;
    }

    // Las más recientes primero
    const sorted = [...filtered].reverse();
    const visible = betsExpanded ? sorted : sorted.slice(0, BETS_INITIAL_VISIBLE);
    const hayMas = sorted.length > BETS_INITIAL_VISIBLE;

    dom.betsList.innerHTML =
      visible
        .map(
          (bet, idx) => `
        <div class="bet-card ${bet.estado}" data-id="${bet.id}" style="animation-delay: ${idx * 0.04}s">
          <div class="bet-status-badge ${bet.estado}" title="${bet.estado}">
            ${statusEmoji(bet.estado)}
          </div>
          <div class="bet-info">
            <div class="bet-match">${escapeHtml(bet.partido)}</div>
            <div class="bet-type">${escapeHtml(bet.apuesta)}</div>
          </div>
          <div class="bet-numbers">
            <div class="bet-amount">${formatEuroShort(bet.importe)}</div>
            <div class="bet-odds">× ${bet.cuota.toFixed(2)}</div>
          </div>
          <div class="bet-result">
            <div class="bet-potential">${
              bet.estado === "perdida"
                ? "-" + formatEuroShort(bet.importe)
                : bet.estado === "ganada"
                ? "+" + formatEuroShort(bet.posibleGanancia - bet.importe)
                : formatEuroShort(bet.posibleGanancia)
            }</div>
            <div class="bet-result-label">${
              bet.estado === "pendiente"
                ? "posible"
                : bet.estado === "ganada"
                ? "ganancia"
                : "perdido"
            }</div>
          </div>
          <div class="bet-resolve">
            <button class="btn-resolve win${bet.estado === "ganada" ? " active" : ""}" data-row="${bet.sheetRow}" data-estado="ganada" title="Marcar como ganada">✅</button>
            <button class="btn-resolve lose${bet.estado === "perdida" ? " active" : ""}" data-row="${bet.sheetRow}" data-estado="perdida" title="Marcar como perdida">❌</button>
          </div>
        </div>`
        )
        .join("") +
      (hayMas
        ? `<button class="btn-ver-mas" id="btn-ver-mas">
            ${betsExpanded ? "▲ Ver menos" : `▼ Ver todas (${sorted.length - BETS_INITIAL_VISIBLE} más)`}
          </button>`
        : "");

    const btnVerMas = document.getElementById("btn-ver-mas");
    if (btnVerMas) {
      btnVerMas.addEventListener("click", () => {
        betsExpanded = !betsExpanded;
        renderBets();
      });
    }

    const countText =
      currentFilter === "all"
        ? `${filtered.length} apuestas`
        : `${filtered.length} de ${state.apuestas.length}`;
    dom.betCount.textContent = countText;
  }

  function renderParticipants() {
    const s = calcStats();
    const aportacion = state.participantes[0]?.aportacion || 0;
    const balancePorPersona = s.aRepartir - aportacion;

    dom.participantsSummary.innerHTML = `
      <div class="participants-summary-card">
        <div class="participants-summary-item">
          <span class="participants-summary-value">${s.numParticipantes}</span>
          <span class="participants-summary-label">participantes</span>
        </div>
        <div class="participants-summary-item">
          <span class="participants-summary-value">${formatEuroShort(aportacion)}</span>
          <span class="participants-summary-label">aportó cada uno</span>
        </div>
        <div class="participants-summary-item">
          <span class="participants-summary-value">${formatEuroShort(s.aRepartir)}</span>
          <span class="participants-summary-label">a repartir cada uno</span>
        </div>
        <div class="participants-summary-item">
          <span class="participants-summary-value ${
            balancePorPersona >= 0 ? "positive" : "negative"
          }">${balancePorPersona >= 0 ? "+" : ""}${formatEuroShort(balancePorPersona)}</span>
          <span class="participants-summary-label">balance por persona</span>
        </div>
      </div>`;
  }

  // ---- Helpers ----
  function statusEmoji(estado) {
    switch (estado) {
      case "ganada":
        return "✅";
      case "perdida":
        return "❌";
      case "pendiente":
        return "⏳";
      default:
        return "❓";
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Add bet modal
    dom.btnAdd.addEventListener("click", () => openAddModal());
    dom.modalClose.addEventListener("click", () => closeAddModal());
    dom.btnCancel.addEventListener("click", () => closeAddModal());
    dom.modalOverlay.addEventListener("click", (e) => {
      if (e.target === dom.modalOverlay) closeAddModal();
    });
    dom.inputCuota.addEventListener("input", updateGananciaPreview);
    dom.inputImporte.addEventListener("input", updateGananciaPreview);
    dom.betForm.addEventListener("submit", handleAddFormSubmit);

    dom.shareClose.addEventListener("click", () => closeShareModal());
    dom.shareOverlay.addEventListener("click", (e) => {
      if (e.target === dom.shareOverlay) closeShareModal();
    });

    // Filters
    dom.filterGroup.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderBets();
    });

    // Resolver apuesta (ganada/perdida) desde la tarjeta
    dom.betsList.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-resolve");
      if (!btn) return;
      if (btn.classList.contains("active")) return; // ya está en ese estado
      handleResolveBet(parseInt(btn.dataset.row, 10), btn.dataset.estado);
    });

    // Share button
    dom.btnShare.addEventListener("click", openShareModal);

    // Share actions
    dom.btnCopy.addEventListener("click", copyShareMessage);
    dom.btnWhatsapp.addEventListener("click", sendWhatsApp);

    // Data management
    dom.btnExport.addEventListener("click", exportData);

    // Sincronizar ahora (botón manual)
    dom.btnRefresh.addEventListener("click", () => SheetSync.refreshNow());

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAddModal();
        closeShareModal();
      }
    });
  }

  // ---- Resolver apuesta (ganada/perdida) ----
  async function handleResolveBet(sheetRow, estado) {
    if (!sheetRow) {
      showToast("⚠️", "No se pudo identificar la fila de esa apuesta", "error");
      return;
    }
    showToast(estado === "ganada" ? "✅" : "❌", "Actualizando…", "success");
    try {
      await SheetSync.resolveBet(sheetRow, estado);
      setTimeout(() => SheetSync.refreshNow(), 2000);
    } catch (err) {
      console.error("Error resolviendo apuesta:", err);
      showToast("⚠️", "No se pudo actualizar (sin conexión)", "error");
    }
  }

  // ---- Add Bet Modal ----
  function openAddModal() {
    dom.betForm.reset();
    dom.previewGanancia.textContent = "0,00 €";
    dom.modalOverlay.classList.add("active");
  }

  function closeAddModal() {
    dom.modalOverlay.classList.remove("active");
  }

  function updateGananciaPreview() {
    const cuota = parseFloat(dom.inputCuota.value) || 0;
    const importe = parseFloat(dom.inputImporte.value) || 0;
    dom.previewGanancia.textContent = formatEuroShort(cuota * importe);
  }

  async function handleAddFormSubmit(e) {
    e.preventDefault();

    const payload = {
      partido: dom.inputPartido.value.trim(),
      apuesta: dom.inputApuesta.value.trim(),
      cuota: parseFloat(dom.inputCuota.value),
      importe: parseFloat(dom.inputImporte.value),
    };

    if (!payload.partido || !payload.apuesta || !payload.cuota || !payload.importe) {
      showToast("⚠️", "Rellena todos los campos", "error");
      return;
    }

    dom.btnSubmit.disabled = true;
    dom.btnSubmit.textContent = "Guardando…";

    try {
      await SheetSync.submitBet(payload);
      closeAddModal();
      showToast("📤", "Apuesta enviada, comprobando en unos segundos…", "success");
      // Pequeño margen para que el Sheet refleje el cambio antes de refrescar
      setTimeout(() => SheetSync.refreshNow(), 2500);
    } catch (err) {
      console.error("Error añadiendo apuesta:", err);
      showToast(
        "⚠️",
        "No se pudo enviar (sin conexión). Inténtalo de nuevo.",
        "error"
      );
    } finally {
      dom.btnSubmit.disabled = false;
      dom.btnSubmit.textContent = "Guardar";
    }
  }

  // ---- Share Functions ----
  function generateShareMessage(lastBet) {
    const s = calcStats();
    const ganadas = state.apuestas.filter((a) => a.estado === "ganada");
    const perdidas = state.apuestas.filter((a) => a.estado === "perdida");

    let msg = `🏆 *MUNDIAL 2026 — Actualización de Apuestas*\n\n`;
    msg += `📊 *Resumen:*\n`;
    msg += `💰 Bote inicial: ${formatEuroShort(s.boteInicial)}\n`;
    msg += `💵 Dinero actual: ${formatEuroShort(s.dineroActual)}\n`;
    msg += `${s.balance >= 0 ? "📈" : "📉"} Balance: ${s.balance >= 0 ? "+" : ""}${formatEuroShort(s.balance)}\n`;
    msg += `🎯 Aciertos: ${s.totalGanadas}/${s.totalResueltas} (${s.pctAcierto}%)\n`;
    msg += `\n`;

    if (lastBet) {
      msg += `🆕 *Última apuesta:*\n`;
      msg += `⚽ ${lastBet.partido}\n`;
      msg += `🎲 ${lastBet.apuesta} → Cuota ${lastBet.cuota.toFixed(2)}\n`;
      msg += `💸 Apostado: ${formatEuroShort(lastBet.importe)} → Posible: ${formatEuroShort(lastBet.posibleGanancia)}\n`;
      msg += `${statusEmoji(lastBet.estado)} ${lastBet.estado.toUpperCase()}\n`;
      msg += `\n`;
    }

    // Recent results (last 5 resolved)
    const recentResolved = [...state.apuestas]
      .filter((a) => a.estado !== "pendiente")
      .slice(-5)
      .reverse();

    if (recentResolved.length > 0) {
      msg += `📋 *Últimas resueltas:*\n`;
      recentResolved.forEach((a) => {
        msg += `${statusEmoji(a.estado)} ${a.partido} — ${a.apuesta} (${formatEuroShort(a.importe)})\n`;
      });
      msg += `\n`;
    }

    // Pending bets
    const pendientes = state.apuestas.filter((a) => a.estado === "pendiente");
    if (pendientes.length > 0) {
      msg += `⏳ *Pendientes (${pendientes.length}):*\n`;
      pendientes.forEach((a) => {
        msg += `• ${a.partido} — ${a.apuesta} (${formatEuroShort(a.importe)})\n`;
      });
      msg += `\n`;
    }

    msg += `👥 A repartir por persona: ${formatEuroShort(s.aRepartir)}\n`;

    return msg;
  }

  function openShareModal() {
    // Use the most recent bet as "last bet"
    const lastBet = state.apuestas.length > 0
      ? state.apuestas[state.apuestas.length - 1]
      : null;
    const msg = generateShareMessage(lastBet);
    dom.shareMessage.textContent = msg;
    dom.shareOverlay.classList.add("active");
  }

  function closeShareModal() {
    dom.shareOverlay.classList.remove("active");
  }

  function copyShareMessage() {
    const text = dom.shareMessage.textContent;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast("📋", "Mensaje copiado al portapapeles", "success");
      })
      .catch(() => {
        // Fallback
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        showToast("📋", "Mensaje copiado", "success");
      });
  }

  function sendWhatsApp() {
    const text = dom.shareMessage.textContent;
    const encoded = encodeURIComponent(text);
    // wa.me without phone number opens WhatsApp with the message to choose a contact/group
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
    showToast("📱", "Abriendo WhatsApp...", "success");
  }

  // ---- Data Management ----
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mundial2026_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("📥", "Datos exportados", "success");
  }

  // ---- Toast ----
  let toastTimeout = null;
  function showToast(icon, message, type = "info") {
    if (toastTimeout) clearTimeout(toastTimeout);

    dom.toast.className = `toast ${type}`;
    dom.toastIcon.textContent = icon;
    dom.toastMessage.textContent = message;

    // Force reflow
    dom.toast.offsetHeight;
    dom.toast.classList.add("show");

    toastTimeout = setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 3000);
  }

  // ---- Boot ----
  if (document.readyState === "loading") {
    


  document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
