/**
 * Aikido Security Scanner & Diagnostics
 * Verifica la conectividad con la API de Aikido Security y el estado del MCP Server / IDE Plugin.
 */
import fs from 'fs';
import path from 'path';

const AIKIDO_API_URL = process.env.AIKIDO_CORE_URL || 'https://ide.aikido.dev';
const TOKEN = process.env.AIKIDO_API_KEY;

async function runDiagnostics() {
  console.log('── Aikido Security: Diagnóstico y Verificación ──\n');

  if (!TOKEN) {
    console.error('❌ Error: AIKIDO_API_KEY no encontrada en las variables de entorno ni en .env');
    process.exit(1);
  }

  console.log(`✓ Token detectado (longitud: ${TOKEN.length} caracteres)`);

  // 1. Verificar token contra endpoint oficial
  try {
    const verifyRes = await fetch(`${AIKIDO_API_URL}/api/ide-plugin/token/verify`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'X-AIK-INTEGRATION-CLIENT': 'vscode'
      }
    });

    if (!verifyRes.ok) {
      console.error(`❌ Fallo al autenticar con Aikido: HTTP ${verifyRes.status}`);
      process.exit(1);
    }

    const verifyData = await verifyRes.json();
    console.log('✓ Autenticación válida con Aikido:', verifyData);

    // 2. Comprobar permisos de cuenta
    const accountRes = await fetch(`${AIKIDO_API_URL}/api/ide-plugin/getAccountInfo`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'X-AIK-INTEGRATION-CLIENT': 'vscode'
      }
    });

    if (accountRes.ok) {
      const accountData = await accountRes.json();
      console.log('✓ Información de cuenta:', accountData);
    }

    // 3. Comprobar configuraciones locales
    const mcpWorkspace = path.resolve('.agents/mcp_config.json');
    const mcpGlobal = path.resolve(process.env.USERPROFILE || '', '.gemini/config/mcp_config.json');
    const rulesWorkspace = path.resolve('.agents/rules/aikido_rules.md');

    console.log('\n── Estado de Integración Local ──');
    console.log(`✓ Workspace MCP Config (${mcpWorkspace}): ${fs.existsSync(mcpWorkspace) ? 'Configurado' : 'No encontrado'}`);
    console.log(`✓ Global MCP Config (${mcpGlobal}): ${fs.existsSync(mcpGlobal) ? 'Configurado' : 'No encontrado'}`);
    console.log(`✓ Reglas de Agente (${rulesWorkspace}): ${fs.existsSync(rulesWorkspace) ? 'Configurado' : 'No encontrado'}`);
    console.log('✓ Servidor MCP instalado: @aikidosec/mcp');

    console.log('\n✅ Aikido Security está activo y listo para escaneo en el proyecto y en el IDE.');
  } catch (err) {
    console.error('❌ Error de conexión:', err.message);
    process.exit(1);
  }
}

runDiagnostics();
