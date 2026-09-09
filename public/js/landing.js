/**
 * SynapseAI Commercial Landing Page Interactive Logic
 * Handles dynamic ROI calculator, live DLP simulator, and smooth scrolling.
 */

document.addEventListener('DOMContentLoaded', () => {
  initRoiCalculator();
  initDlpSimulator();
});

// 1. Dynamic ROI Calculator Logic
function initRoiCalculator() {
  const usersSlider = document.getElementById('slider-users');
  const queriesSlider = document.getElementById('slider-queries');
  const modelSelect = document.getElementById('select-model-tier');

  const usersVal = document.getElementById('val-users');
  const queriesVal = document.getElementById('val-queries');

  const outSavingsMonth = document.getElementById('out-savings-month');
  const outTokensSaved = document.getElementById('out-tokens-saved');
  const outDlpThreats = document.getElementById('out-dlp-threats');
  const outSpeedup = document.getElementById('out-speedup');

  function calculate() {
    const users = parseInt(usersSlider.value, 10);
    const queriesPerUserDay = parseInt(queriesSlider.value, 10);
    const modelTier = modelSelect.value; // 'gpt4o', 'claude', 'multi'

    usersVal.innerText = `${users} usuario(s)`;
    queriesVal.innerText = `${queriesPerUserDay} / día`;

    // Calculation Constants
    const workingDaysMonth = 22;
    const totalMonthlyQueries = users * queriesPerUserDay * workingDaysMonth;
    const avgTokensPerQuery = 1200;
    const totalTokensMonthly = totalMonthlyQueries * avgTokensPerQuery;

    // Model costs per 1M tokens
    let baselineCostPer1M = 10.00; // Standard unoptimized blended
    if (modelTier === 'claude') baselineCostPer1M = 15.00;
    if (modelTier === 'gpt4o') baselineCostPer1M = 10.00;
    if (modelTier === 'multi') baselineCostPer1M = 8.50;

    const unoptimizedCost = (totalTokensMonthly / 1_000_000) * baselineCostPer1M;

    // SynapseAI Optimization factors (Cache + Smart Routing):
    // 35% Cache hit rate (cost $0) + 40% smart routing to fast tier = ~65% total cost reduction
    const savingsPercentage = 0.65;
    const monthlyDollarsSaved = unoptimizedCost * savingsPercentage;
    const tokensSavedMonthly = Math.round(totalTokensMonthly * 0.47);

    // Estimated DLP leaks prevented (industry standard: ~1.8% of enterprise prompts contain PII/keys)
    const leaksPrevented = Math.max(1, Math.round(totalMonthlyQueries * 0.018));

    // Update UI Elements with smooth animation
    outSavingsMonth.innerText = `$${Math.round(monthlyDollarsSaved).toLocaleString()} USD`;
    outTokensSaved.innerText = `${(tokensSavedMonthly / 1_000_000).toFixed(1)}M Tokens`;
    outDlpThreats.innerText = `${leaksPrevented.toLocaleString()} Amenazas`;
    outSpeedup.innerText = `4.8x Más Rápido`;
  }

  usersSlider.addEventListener('input', calculate);
  queriesSlider.addEventListener('input', calculate);
  modelSelect.addEventListener('change', calculate);

  // Initial calculation
  calculate();
}

// 2. Live DLP Simulator on Landing Page
function initDlpSimulator() {
  const input = document.getElementById('landing-dlp-input');
  const output = document.getElementById('landing-dlp-output');
  const badge = document.getElementById('landing-dlp-badge');

  if (!input || !output) return;

  const sampleSensitiveTexts = [
    "Enviar reporte al cliente con IBAN ES9121000418450200051332 y DNI 12345678Z. OpenAI API Key: sk-proj-123456789012345678901234.",
    "Procesar cobro con tarjeta 4532 8921 0091 7721 del usuario john.doe@empresa.com con RFC GODE561231GR8.",
    "Credencial de base de datos en producción: password: Sup3rS3cr3t123! para acceso root."
  ];

  window.loadLandingSample = (index) => {
    input.value = sampleSensitiveTexts[index];
    runLiveScan();
  };

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(runLiveScan, 250);
  });

  async function runLiveScan() {
    const raw = input.value.trim();
    if (!raw) {
      output.innerHTML = '<span style="color: var(--text-muted);">Escribe o selecciona un ejemplo arriba para ver la anonimización en tiempo real...</span>';
      badge.innerText = 'ESPERANDO TEXTO';
      badge.style.color = 'var(--text-muted)';
      return;
    }

    try {
      const res = await fetch('/api/gateway/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: raw, source: 'Landing Page Demo' })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.dlp && data.dlp.wasMasked) {
          badge.innerText = `🛡️ ${data.dlp.detections.length} AMENAZA(S) SANITIZADA(S)`;
          badge.style.color = 'var(--accent-emerald)';
          output.innerHTML = `<span style="color: #86efac;">${escapeHtml(data.dlp.sanitizedText)}</span>`;
        } else {
          badge.innerText = `✓ DATO SEGURO (CERO PII)`;
          badge.style.color = 'var(--accent-cyan)';
          output.innerHTML = `<span>${escapeHtml(data.dlp.sanitizedText)}</span>`;
        }
      }
    } catch (e) {
      // Offline fallback
      output.innerText = raw.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_OPENAI_KEY]')
                            .replace(/\b\d{4}[\s_]\d{4}[\s_]\d{4}[\s_]\d{4}\b/g, '[REDACTED_CARD_NUMBER]');
      badge.innerText = '🛡️ DLP ACTIVO (LOCAL)';
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Load first sample by default
  window.loadLandingSample(0);
}
