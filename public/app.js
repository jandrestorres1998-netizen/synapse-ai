/**
 * SynapseAI Dashboard & Interactive Gateway Controller
 */

// Tab Management
function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `pane-${tabId}`);
  });

  if (tabId === 'security') loadSecurityLogs();
  if (tabId === 'memory') loadMemories();
  if (tabId === 'overview') refreshDashboard();
}

// Attach Tab Click Handlers
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Telemetry & KPI Updating
async function refreshDashboard() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('kpi-money-saved').innerText = `$${data.totalMoneySavedUSD.toFixed(2)}`;
    document.getElementById('kpi-threats').innerText = data.totalThreatsBlocked || data.threatsIntercepted || 0;
    document.getElementById('kpi-cache-rate').innerText = `${data.cache?.hitRate || 0}%`;
    document.getElementById('kpi-latency').innerText = `${data.averageLatencyMs || 85} ms`;

    // Render Recent Activity
    const activityContainer = document.getElementById('recent-activity-list');
    if (data.requestsHistory && data.requestsHistory.length > 0) {
      activityContainer.innerHTML = data.requestsHistory.slice(0, 5).map(item => `
        <div class="stream-item">
          <div class="stream-left">
            <span class="stream-badge ${item.masked ? 'badge-masked' : item.cached ? 'badge-cached' : 'badge-routed'}">
              ${item.masked ? '🛡️ DLP MASKED' : item.cached ? '⚡ CACHE HIT' : '🔄 ROUTED'}
            </span>
            <span><strong>${item.model}</strong></span>
          </div>
          <div class="stream-right text-muted">
            <span>+ $${item.savedUSD.toFixed(4)} ahorrado (${item.latencyMs}ms)</span>
          </div>
        </div>
      `).join('');
    } else {
      activityContainer.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-muted);">Listo para procesar consultas. Ve a la pestaña Playground para probar.</div>`;
    }
  } catch (err) {
    console.error('Error fetching stats:', err);
  }
}

// Playground Preset Loader
function loadSamplePrompt(type) {
  const input = document.getElementById('playground-prompt-input');
  if (type === 'pii') {
    input.value = "Por favor analiza la cuenta del cliente John Doe (email: jdoe.corporate@fintech-bank.com, teléfono: +1-555-839-2091). Su tarjeta corporativa termina en 4532-8921-0091-7721 y su API Key de producción es sk-proj-928hfb83hfsd823489234892348923489234.";
  } else if (type === 'complex') {
    input.value = "Necesitamos diseñar la arquitectura de microservicios distribuida con tolerancia a fallos, concurrencia distribuida en Go/Rust y cumplimiento estricto de SOC2. Incluye diagramas de flujo y análisis de cuellos de botella.";
  } else if (type === 'cached') {
    input.value = "Resume las mejores prácticas de seguridad para tokens JWT en 3 puntos claros.";
  }
}

// Execute Gateway Playground Request
async function runGatewaySim() {
  const promptInput = document.getElementById('playground-prompt-input');
  const prompt = promptInput.value.trim();
  const injectMemory = document.getElementById('chk-inject-memory').checked;
  const inspectorContent = document.getElementById('inspector-content');
  const inspectorBadge = document.getElementById('inspector-badge');
  const btnRun = document.getElementById('btn-run-gateway');

  if (!prompt) {
    alert('Por favor ingresa un texto de prueba en el prompt.');
    return;
  }

  btnRun.disabled = true;
  btnRun.innerText = '⚡ Procesando a través del Gateway...';
  inspectorBadge.innerText = 'PROCESANDO EN TIEMPO REAL';
  inspectorBadge.style.color = 'var(--accent-cyan)';

  try {
    const res = await fetch('/api/gateway/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        source: 'Web UI Playground',
        injectMemory
      })
    });

    const data = await res.json();
    btnRun.disabled = false;
    btnRun.innerHTML = '<span>⚡ Enviar a través de SynapseAI</span>';
    inspectorBadge.innerText = data.source === 'SEMANTIC_CACHE' ? '⚡ RESUELTO POR CACHÉ' : '✓ PROCESADO CON ÉXITO';
    inspectorBadge.style.color = 'var(--accent-emerald)';

    // Render Detailed Telemetry Nodes
    let dlpNodeHtml = '';
    if (data.dlp && data.dlp.wasMasked) {
      dlpNodeHtml = `
        <div class="telemetry-node highlight-red">
          <div class="node-title" style="color: var(--accent-rose);">🛡️ DLP Activo: ${data.dlp.detections.length} Amenaza(s) de Privacidad Neutralizada(s)</div>
          <div class="node-content">
            <p style="margin-bottom: 6px; color: var(--text-muted);">Texto Sanitizado Enviado a la IA:</p>
            <div style="background: rgba(0,0,0,0.5); padding: 8px; border-radius: 4px; color: #fecdd3;">${escapeHtml(data.dlp.sanitizedText)}</div>
          </div>
        </div>
      `;
    } else {
      dlpNodeHtml = `
        <div class="telemetry-node highlight-green">
          <div class="node-title" style="color: var(--accent-emerald);">🛡️ DLP Shield: Datos Seguros (Cero PII Detectado)</div>
        </div>
      `;
    }

    const routeNodeHtml = `
      <div class="telemetry-node highlight-blue">
        <div class="node-title" style="color: var(--accent-cyan);">🔄 Smart Router: Modelo Seleccionado [${data.modelUsed}]</div>
        <div class="node-content">
          <p><strong>Criterio:</strong> ${data.routing.reasoning}</p>
          <p style="margin-top: 4px; color: var(--accent-emerald);">
            💵 Ahorro Calculado: <strong>$${data.routing.savingsDollars.toFixed(5)}</strong> (${data.routing.savingsPercent}% menos vs baseline) | Latencia: <strong>${data.latencyMs}ms</strong>
          </p>
        </div>
      </div>
    `;

    const responseNodeHtml = `
      <div class="telemetry-node">
        <div class="node-title" style="color: #fff;">💬 Respuesta Generada & Verificada</div>
        <div class="node-content" style="white-space: pre-wrap; background: rgba(0,0,0,0.4); padding: 12px; border-radius: 6px;">${escapeHtml(data.response)}</div>
      </div>
    `;

    inspectorContent.innerHTML = dlpNodeHtml + routeNodeHtml + responseNodeHtml;
    refreshDashboard();
  } catch (err) {
    btnRun.disabled = false;
    btnRun.innerHTML = '<span>⚡ Enviar a través de SynapseAI</span>';
    inspectorBadge.innerText = 'ERROR EN PROCESO';
    inspectorBadge.style.color = 'var(--accent-rose)';
    inspectorContent.innerHTML = `<div class="text-danger">Error conectando con el gateway: ${err.message}</div>`;
  }
}

// Security Logs Management
async function loadSecurityLogs() {
  try {
    const res = await fetch('/api/security/logs');
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById('security-logs-tbody');

    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No se han registrado incidentes aún. Genera una prueba con datos sensibles en el Playground.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.logs.map(log => {
      const categories = log.items.map(i => `<span class="rule-badge ${i.severity.toLowerCase()}" style="font-size:0.7rem; padding: 2px 6px;">${i.name}</span>`).join(' ');
      const severityClass = log.items.some(i => i.severity === 'CRITICAL') ? 'text-rose' : 'text-amber';
      
      return `
        <tr>
          <td><span style="font-family: var(--font-mono); font-size:0.75rem;">${new Date(log.timestamp).toLocaleTimeString()}</span></td>
          <td>${log.source}</td>
          <td>${categories}</td>
          <td><strong style="color: ${log.items.some(i => i.severity === 'CRITICAL') ? 'var(--accent-rose)' : 'var(--accent-amber)'}">${log.items[0]?.severity || 'MEDIUM'}</strong></td>
          <td><code style="font-size:0.75rem; color: #fda4af;">${escapeHtml(log.sampleBefore)}</code></td>
          <td><code style="font-size:0.75rem; color: #86efac;">${escapeHtml(log.sampleAfter)}</code></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading security logs:', err);
  }
}

// Memory Hub Management
async function loadMemories() {
  try {
    const res = await fetch('/api/memory');
    if (!res.ok) return;
    const memories = await res.json();
    const container = document.getElementById('memory-items-container');

    if (!memories || memories.length === 0) {
      container.innerHTML = `<div class="text-muted">No hay memorias registradas. Agrega una arriba.</div>`;
      return;
    }

    container.innerHTML = memories.map(mem => `
      <div class="memory-card-item ${mem.isActive ? 'active' : ''}">
        <div class="mem-body">
          <div class="mem-meta">
            <span class="mem-category-tag">${mem.category}</span>
            <span class="mem-title">${escapeHtml(mem.title)}</span>
          </div>
          <div class="mem-desc">${escapeHtml(mem.content)}</div>
        </div>
        <div class="mem-actions">
          <button class="btn btn-sm ${mem.isActive ? 'btn-outline' : 'btn-secondary'}" onclick="toggleMemory('${mem.id}')">
            ${mem.isActive ? '✓ Activo' : 'Pausado'}
          </button>
          <button class="btn-icon" onclick="deleteMemory('${mem.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading memories:', err);
  }
}

async function createNewMemory() {
  const title = document.getElementById('new-mem-title').value.trim();
  const category = document.getElementById('new-mem-category').value;
  const content = document.getElementById('new-mem-content').value.trim();

  if (!title || !content) {
    alert('Por favor ingresa un título y el contenido del contexto.');
    return;
  }

  try {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, content, isActive: true })
    });

    if (res.ok) {
      document.getElementById('new-mem-title').value = '';
      document.getElementById('new-mem-content').value = '';
      loadMemories();
    }
  } catch (err) {
    console.error('Error creating memory:', err);
  }
}

async function toggleMemory(id) {
  try {
    await fetch(`/api/memory/${id}/toggle`, { method: 'PATCH' });
    loadMemories();
  } catch (err) {
    console.error('Error toggling memory:', err);
  }
}

async function deleteMemory(id) {
  if (!confirm('¿Seguro que deseas eliminar este bloque de memoria?')) return;
  try {
    await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    loadMemories();
  } catch (err) {
    console.error('Error deleting memory:', err);
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  loadMemories();
  // Auto refresh telemetry every 5s
  setInterval(refreshDashboard, 5000);
});
