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

    // Balance bar
    barLost: $("#bar-lost"),
    barWon: $("#bar-won"),
    barAvailable: $("#bar-available"),
    barFillSpent: $("#bar-fill-spent"),
    barFillWon: $("#bar-fill-won"),
    barFillRemaining: $("#bar-fill-remaining"),

    // Lists
    betsList: $("#bets-list"),
    betCount: $("#bet-count"),
    participantsSummary: $("#participants-summary"),

    // Chart
    chartWrapper: $("#chart-wrapper"),
    chartCurrent: $("#chart-current"),

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

    const totalApostado = resueltas.reduce((sum, a) => sum + a.importe, 0);
    const totalGanado = ganadas.reduce((sum, a) => sum + a.posibleGanancia, 0);
    const totalPerdido = perdidas.reduce((sum, a) => sum + a.importe, 0);
    const totalPendiente = pendientes.reduce((sum, a) => sum + a.importe, 0);

    // Net profit from resolved bets = money won minus money lost
    const netProfit = totalGanado - totalPerdido;

    // Dinero actual = bote + profit from wins - losses
    // = boteInicial - totalPerdido + (totalGanado - ganadas stakes)
    // Actually: dineroActual = boteInicial - totalPerdido + totalGanado - ganadas.stakes
    // Wait, let me think again.
    // bote starts at boteInicial
    // For each lost bet: bote -= importe (we lose the stake)
    // For each won bet: bote -= importe (we pay the stake) but bote += posibleGanancia (we receive winnings)
    // So: dineroActual = boteInicial - sum(all resolved stakes) + sum(won returns)
    const totalResolvedStakes = resueltas.reduce(
      (sum, a) => sum + a.importe,
      0
    );
    const dineroActual =
      state.boteInicial - totalResolvedStakes + totalGanado - totalPendiente;

    // Actually, pendientes shouldn't affect dinero actual until resolved
    // Let me recalculate:
    // dineroActual = boteInicial - perdidas.stakes - ganadas.stakes + ganadas.returns
    // = boteInicial - totalPerdido - ganadas.stakes + totalGanado
    const ganadasStakes = ganadas.reduce((sum, a) => sum + a.importe, 0);
    const dineroActualCorrected =
      state.boteInicial - totalPerdido - ganadasStakes + totalGanado;

    const balance = dineroActualCorrected - state.boteInicial;

    const pctAcierto =
      resueltas.length > 0
        ? Math.round((ganadas.length / resueltas.length) * 100)
        : 0;

    const numParticipantes = state.participantes.length;
    const aRepartir =
      numParticipantes > 0
        ? dineroActualCorrected / numParticipantes
        : 0;

    return {
      boteInicial: state.boteInicial,
      dineroActual: dineroActualCorrected,
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
    renderStats();
    renderBalanceBar();
    renderChart();
    renderBets();
    renderParticipants();
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

  function renderBalanceBar() {
    const s = calcStats();
    const netProfit = s.totalGanado - s.ganadasStakes; // beneficio neto: sin contar lo apostado
    const total = s.boteInicial + netProfit;

    // Proportions relative to total money that has "passed through"
    const pctLost = total > 0 ? (s.totalPerdido / total) * 100 : 0;
    const pctWon = total > 0 ? (netProfit / total) * 100 : 0;
    const pctRemaining = Math.max(0, 100 - pctLost - pctWon);

    dom.barFillSpent.style.width = pctLost + "%";
    dom.barFillWon.style.width = pctWon + "%";
    dom.barFillRemaining.style.width = pctRemaining + "%";

    dom.barLost.textContent = formatEuroShort(s.totalPerdido);
    dom.barWon.textContent = formatEuroShort(netProfit);
    dom.barAvailable.textContent = formatEuroShort(
      Math.max(0, s.dineroActual)
    );
  }

  // ---- Chart: evolución del dinero ----
  // Niveles de referencia personalizados del grupo
  const CHART_LEVELS = [
    { value: 0, label: "Ruina" },
    { value: 310, label: "Cubatas" },
    { value: 350, label: "Comida" },
    { value: 400, label: "Comida + Cubatas" },
  ];

  function buildHistorial() {
    // Reconstruye cómo ha ido evolucionando el dinero actual a medida que se
    // van resolviendo apuestas, en el mismo orden en que están en el Sheet.
    let running = state.boteInicial;
    const puntos = [running];
    state.apuestas.forEach((a) => {
      if (a.estado === "ganada") running += a.posibleGanancia - a.importe;
      else if (a.estado === "perdida") running -= a.importe;
      // pendiente: no cambia el dinero actual todavía
      puntos.push(running);
    });
    return puntos;
  }

  function renderChart() {
    const puntos = buildHistorial();
    const actual = puntos[puntos.length - 1];
    dom.chartCurrent.textContent = formatEuroShort(actual);

    const W = 700;
    const H = 220;
    const PAD_L = 14;
    const PAD_R = 14;
    const PAD_T = 18;
    const PAD_B = 28;

    // Calculamos el máximo real alcanzado para poner ahí "Casa Matiki"
    const maxAlcanzado = Math.max(...puntos, ...CHART_LEVELS.map((l) => l.value));
    const minAlcanzado = Math.min(...puntos, 0);

    const niveles = [...CHART_LEVELS];
    if (maxAlcanzado > 400) {
      niveles.push({ value: maxAlcanzado, label: "🏆 Casa Matiki" });
    }

    const yMax = maxAlcanzado * 1.08 || 10;
    const yMin = Math.min(0, minAlcanzado);
    const range = yMax - yMin || 1;

    const xFor = (i) =>
      puntos.length > 1
        ? PAD_L + (i / (puntos.length - 1)) * (W - PAD_L - PAD_R)
        : PAD_L;
    const yFor = (v) => PAD_T + (1 - (v - yMin) / range) * (H - PAD_T - PAD_B);

    // Líneas de referencia
    const gridLines = niveles
      .map((nivel) => {
        const y = yFor(nivel.value);
        return `
          <line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" class="chart-gridline" />
          <text x="${PAD_L}" y="${y - 4}" class="chart-gridlabel">${escapeHtml(
          nivel.label
        )} · ${formatEuroShort(nivel.value)}</text>
        `;
      })
      .join("");

    // Línea de la evolución
    const linePoints = puntos.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
    const areaPoints = `${PAD_L},${yFor(yMin)} ${linePoints} ${xFor(
      puntos.length - 1
    )},${yFor(yMin)}`;

    const lineColor = actual >= state.boteInicial ? "var(--green)" : "var(--red)";

    dom.chartWrapper.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">
        ${gridLines}
        <polygon points="${areaPoints}" class="chart-area" fill="${lineColor}" />
        <polyline points="${linePoints}" class="chart-line" stroke="${lineColor}" />
        <circle cx="${xFor(puntos.length - 1)}" cy="${yFor(
      actual
    )}" r="4.5" class="chart-dot" fill="${lineColor}" />
      </svg>
    `;
  }

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

    // Show most recent first
    const sorted = [...filtered].reverse();

    dom.betsList.innerHTML = sorted
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
      </div>`
      )
      .join("");

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
      showToast("📤", "Apuesta enviada, sincronizando…", "success");
      // Pequeño margen para que el Sheet refleje el cambio antes de refrescar
      setTimeout(() => SheetSync.refreshNow(), 2500);
    } catch (err) {
      console.error("Error añadiendo apuesta:", err);
      showToast(
        "⚠️",
        "No se pudo guardar. Revisa la conexión con el Sheet (¿configuraste APPS_SCRIPT_URL en sheets.js?)",
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
