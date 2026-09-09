import crypto from 'crypto';
import { Deobfuscator } from './deobfuscator.js';
import {
  validateSpanishDNI, validateSpanishCIF, validateMexicanRFC, validateMexicanCURP,
  validateBrazilianCPF, validateBrazilianCNPJ, validateIBAN, validateLuhn, looksLikeJWT
} from './identity-checksums.js';

/**
 * SynapseAI DLP (Data Loss Prevention) Engine
 *
 * Detects secrets and PII in text moving through the gateway and masks them
 * before the text reaches an upstream model.
 *
 * Scope, stated honestly: this is regex plus checksum validation. It reliably
 * catches structured identifiers (API keys, card numbers, national IDs, IBANs).
 * It does not detect unstructured confidential content — a paragraph of
 * strategy, a name in prose, an unlabelled internal codename — and no regex
 * engine can. Treat it as a guardrail against accidental paste-ins, not as a
 * compliance boundary.
 *
 * Audit records store a salted hash of the offending text by default: a DLP
 * tool that keeps a plaintext copy of every secret it caught is a larger
 * liability than the leak it prevented.
 */

export class DLPEngine {
  /**
   * @param {Object} options
   * @param {boolean} options.storePlaintextSamples Keep raw text in audit logs (off by default).
   * @param {number}  options.maxAuditLogs
   */
  constructor({ storePlaintextSamples = false, maxAuditLogs = 200 } = {}) {
    this.deobfuscator = new Deobfuscator();
    this.storePlaintextSamples = storePlaintextSamples;
    this.maxAuditLogs = maxAuditLogs;
    // Per-process salt: audit hashes cannot be dictionary-attacked across
    // deployments, and they do not survive a restart as a lookup table.
    this.auditSalt = crypto.randomBytes(32);

    this.patterns = [
      // 1. Secrets & Credentials (High Confidence)
      {
        id: 'api_key_openai',
        name: 'OpenAI API Key',
        regex: /sk-[a-zA-Z0-9_\-]{20,64}/gi,
        replacement: '[REDACTED_OPENAI_KEY]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_aws',
        name: 'AWS Access Key / Secret',
        regex: /(AKIA[0-9A-Z]{16}|aws_secret_access_key\s*=\s*[a-zA-Z0-9\/+=]{40})/gi,
        replacement: '[REDACTED_AWS_SECRET]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_github',
        // Covers the classic ghp_/gho_/ghs_ forms and the newer fine-grained
        // github_pat_ tokens, which the previous pattern missed entirely.
        name: 'GitHub Token',
        regex: /\b(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{50,})\b/g,
        replacement: '[REDACTED_GITHUB_TOKEN]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'private_key_block',
        // A PEM block is the highest-value secret a prompt can carry. Its
        // absence meant a GCP service-account JSON had its e-mail redacted
        // while the signing key travelled upstream untouched.
        name: 'Bloque de clave privada (PEM)',
        regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [^-]*-----/g,
        replacement: '[REDACTED_PRIVATE_KEY]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_stripe',
        name: 'Clave de Stripe',
        regex: /\b(?:sk|rk|pk)_(?:live|test)_[a-zA-Z0-9]{20,}\b/g,
        replacement: '[REDACTED_STRIPE_KEY]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_slack',
        name: 'Token de Slack',
        regex: /\b(?:xox[baprs]-[0-9a-zA-Z-]{10,}|https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/+]{20,})\b/g,
        replacement: '[REDACTED_SLACK_TOKEN]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_gitlab',
        name: 'Token de GitLab',
        regex: /\bglpat-[a-zA-Z0-9_-]{20,}\b/g,
        replacement: '[REDACTED_GITLAB_TOKEN]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_anthropic',
        name: 'Clave de API de Anthropic',
        regex: /\bsk-ant-[a-zA-Z0-9_-]{20,120}\b/g,
        replacement: '[REDACTED_ANTHROPIC_KEY]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'api_key_google',
        name: 'Clave de API de Google',
        regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
        replacement: '[REDACTED_GOOGLE_KEY]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'jwt_token',
        // Three base64url segments. Validated by decoding the header so random
        // dotted strings are not flagged.
        name: 'JSON Web Token',
        regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
        validate: match => looksLikeJWT(match),
        replacement: '[REDACTED_JWT]',
        severity: 'HIGH',
        category: 'Secrets & Credentials'
      },
      {
        id: 'connection_string',
        // Azure/AWS storage strings and any URI carrying inline credentials.
        name: 'Cadena de conexión con credenciales',
        regex: /(?:AccountKey=[A-Za-z0-9+/=]{40,}|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+)/gi,
        replacement: '[REDACTED_CONNECTION_STRING]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },
      {
        id: 'bearer_token',
        name: 'Cabecera Authorization con token',
        regex: /\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
        replacement: '[REDACTED_BEARER_TOKEN]',
        severity: 'HIGH',
        category: 'Secrets & Credentials'
      },
      {
        id: 'password_field',
        name: 'Plaintext Password Leak',
        regex: /(?:password|passwd|pwd|clave|contrasena|contraseña)\s*[:=]\s*["']?([^"'\s,;]{4,})["']?/gi,
        replacement: 'password: [REDACTED_CONFIDENTIAL_SECRET]',
        severity: 'CRITICAL',
        category: 'Secrets & Credentials'
      },

      // 2. Financial PII with Luhn Checksum Validation
      {
        id: 'credit_card',
        name: 'Credit / Debit Card Number',
        regex: /\b(?:4[0-9]{15}|4[0-9]{12}|5[1-5][0-9]{14}|3[47][0-9]{13}|6[0-9]{15}|(?:[0-9]{4}[ -]){3}[0-9]{4})\b/g,
        validate: match => validateLuhn(match),
        replacement: '[REDACTED_CARD_NUMBER]',
        severity: 'HIGH',
        category: 'Financial PII'
      },
      {
        id: 'iban_bank_account',
        name: 'International Bank Account (IBAN)',
        regex: /\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9A-Z]{4}){4,7}(?:[ ]?[0-9A-Z]{1,2})?\b/gi,
        validate: match => validateIBAN(match),
        replacement: '[REDACTED_IBAN_ACCOUNT]',
        severity: 'HIGH',
        category: 'Financial PII'
      },

      // 3. Government & Identity PII with Checksum Validation
      {
        id: 'es_dni_nie',
        name: 'Spanish DNI / NIE',
        regex: /\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z])\b/gi,
        validate: match => validateSpanishDNI(match),
        replacement: '[REDACTED_ES_DNI_NIE]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'es_cif',
        name: 'CIF de empresa española',
        regex: /\b[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]\b/gi,
        // Without the check digit this shape also matches part numbers and
        // invoice references; the false positives get the whole rule disabled.
        validate: match => validateSpanishCIF(match),
        replacement: '[REDACTED_ES_CIF]',
        severity: 'MEDIUM',
        category: 'Corporate PII'
      },
      {
        id: 'mx_rfc',
        name: 'RFC mexicano',
        // Widened to the real homoclave alphabet, then narrowed by the check
        // digit. The old character classes rejected valid RFCs while still
        // accepting invalid ones, which is the worst of both.
        regex: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi,
        validate: match => validateMexicanRFC(match),
        replacement: '[REDACTED_MX_RFC]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'mx_curp',
        name: 'CURP mexicana',
        regex: /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d\b/gi,
        validate: match => validateMexicanCURP(match),
        replacement: '[REDACTED_MX_CURP]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'br_cpf',
        name: 'CPF brasileño',
        regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
        validate: match => validateBrazilianCPF(match),
        replacement: '[REDACTED_BR_CPF]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'br_cnpj',
        name: 'CNPJ brasileño',
        regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
        validate: match => validateBrazilianCNPJ(match),
        replacement: '[REDACTED_BR_CNPJ]',
        severity: 'MEDIUM',
        category: 'Corporate PII'
      },
      {
        id: 'us_ssn',
        name: 'US Social Security Number (SSN)',
        regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
        replacement: '[REDACTED_US_SSN]',
        severity: 'CRITICAL',
        category: 'Government PII'
      },

      // 4. Contact PII
      {
        id: 'email_address',
        name: 'Personal / Customer Email',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
        validate: (match) => !match.endsWith('@example.com') && !match.endsWith('@test.com'),
        // Keeping two characters of the local part plus the full domain made
        // the "redacted" value trivially re-identifiable inside a small company.
        // Only the top-level domain survives, which is enough to tell a customer
        // address from an internal one without naming anyone.
        replacement: (match) => {
          const domain = match.split('@')[1] ?? '';
          const tld = domain.slice(domain.lastIndexOf('.'));
          return `[REDACTED_EMAIL${tld}]`;
        },
        severity: 'MEDIUM',
        category: 'Personal PII'
      }
    ];

    this.auditLogs = [];
    this.totalInterceptions = 0;
    this.evasionAttemptsBlocked = 0;
  }

  // The checksum algorithms live in identity-checksums.js so they can be used
  // (and tested) without pulling in the whole engine. These delegations keep
  // the existing DLPEngine.validateX call sites working.
  static validateLuhn(input) { return validateLuhn(input); }
  static validateSpanishDNI(input) { return validateSpanishDNI(input); }
  static validateSpanishCIF(input) { return validateSpanishCIF(input); }
  static validateMexicanRFC(input) { return validateMexicanRFC(input); }
  static validateMexicanCURP(input) { return validateMexicanCURP(input); }
  static validateBrazilianCPF(input) { return validateBrazilianCPF(input); }
  static validateBrazilianCNPJ(input) { return validateBrazilianCNPJ(input); }
  static validateIBAN(input) { return validateIBAN(input); }
  static looksLikeJWT(token) { return looksLikeJWT(token); }

  /** Salted digest used instead of storing the offending text. */
  fingerprint(text) {
    return crypto.createHmac('sha256', this.auditSalt).update(text || '').digest('hex').slice(0, 32);
  }

  /**
   * Masks a matched value while leaving enough for a human to recognise it.
   * Full secrets are never echoed back, not even truncated at both ends —
   * the first four characters of an API key identify the account prefix.
   */
  static maskSnippet(match, severity) {
    if (severity === 'CRITICAL') return `***${match.length} chars***`;
    return match.length > 8 ? `***${match.slice(-4)}` : '***';
  }

  /**
   * Runs every pattern over a piece of text and masks what validates.
   * @returns {{text: string, detections: Array}}
   */
  _scanAndMask(text) {
    let masked = text;
    const detections = [];

    for (const pattern of this.patterns) {
      // Deduplicate: a value repeated five times is one finding, five masks.
      const matches = [...new Set(masked.match(pattern.regex) ?? [])];

      for (const match of matches) {
        // Reject candidates that fail their checksum — these are false positives.
        if (pattern.validate && !pattern.validate(match)) continue;

        detections.push({
          patternId: pattern.id,
          name: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          snippet: DLPEngine.maskSnippet(match, pattern.severity),
          valueHash: this.fingerprint(match)
        });

        const replacementStr = typeof pattern.replacement === 'function' ? pattern.replacement(match) : pattern.replacement;
        // replaceAll: a card number pasted twice must be masked twice.
        masked = masked.replaceAll(match, replacementStr);
      }
    }

    return { text: masked, detections };
  }

  /**
   * Scans text and masks what it finds.
   *
   * Detection and rewriting are deliberately separated. Detection runs over a
   * deobfuscated copy, so base64, hex, homoglyphs and zero-width padding cannot
   * hide a secret. Rewriting is applied to the *original* text.
   *
   * The previous version forwarded the deobfuscated copy upstream, which
   * silently corrupted legitimate prompts: Cyrillic prose came out transliterated
   * into look-alike Latin, and a base64 attachment the user asked the model to
   * decode was replaced by "[DECODED_BASE64: …]". The model then answered a
   * question the user never asked.
   *
   * When a secret is visible *only* after deobfuscation, neither option is
   * correct — forwarding the original leaks it, forwarding the normalized copy
   * corrupts the request — so the result is flagged `requiresBlock` and the
   * pipeline rejects it regardless of the configured DLP mode.
   *
   * @param {string} rawText
   * @param {string} source Free-text origin label for the audit trail.
   * @returns {{sanitizedText: string, detections: Array, wasMasked: boolean, requiresBlock: boolean, deobfuscated: Object}}
   */
  process(rawText, source = 'Web Client', { audit = true } = {}) {
    if (!rawText || typeof rawText !== 'string') {
      return { sanitizedText: rawText, detections: [], wasMasked: false, requiresBlock: false, deobfuscated: null };
    }

    // Pass 1 — the text exactly as the user wrote it. This is what gets masked.
    const direct = this._scanAndMask(rawText);

    // Pass 2 — a normalized copy, used only to catch evasion attempts.
    const deobfuscated = this.deobfuscator.normalize(rawText);
    let hiddenDetections = [];

    if (deobfuscated.normalizedText !== rawText) {
      const deep = this._scanAndMask(deobfuscated.normalizedText);
      const seen = new Set(direct.detections.map(d => d.valueHash));
      hiddenDetections = deep.detections.filter(d => !seen.has(d.valueHash));

      if (hiddenDetections.length > 0) this.evasionAttemptsBlocked++;
    }

    const detections = [...direct.detections, ...hiddenDetections];
    const requiresBlock = hiddenDetections.length > 0;

    // The streaming redactor rescans its buffer on every chunk, so it opts out
    // of auditing and reports once at the end. Counting there would inflate
    // both the interception total and the audit log by a factor of the chunk
    // count for a single leaked secret.
    if (detections.length > 0 && audit) {
      this.totalInterceptions += detections.length;

      const logEntry = {
        id: 'sec_' + crypto.randomBytes(5).toString('hex'),
        timestamp: new Date().toISOString(),
        source,
        detectionsCount: detections.length,
        items: detections,
        obfuscationDetected: requiresBlock,
        // The hash lets an auditor correlate repeat offences without the ledger
        // itself becoming a store of secrets.
        payloadHash: this.fingerprint(rawText),
        payloadLength: rawText.length
      };

      if (this.storePlaintextSamples) {
        logEntry.sampleBefore = rawText.slice(0, 100);
        logEntry.sampleAfter = direct.text.slice(0, 100);
        logEntry.plaintextRetained = true;
      }

      this.auditLogs.unshift(logEntry);
      if (this.auditLogs.length > this.maxAuditLogs) this.auditLogs.pop();
    }

    return {
      sanitizedText: direct.text,
      detections,
      wasMasked: detections.length > 0,
      requiresBlock,
      deobfuscated
    };
  }

  getAuditLogs() {
    return this.auditLogs;
  }

  getTotalInterceptions() {
    return this.totalInterceptions;
  }

  getEvasionAttemptsBlocked() {
    return this.evasionAttemptsBlocked;
  }
}
