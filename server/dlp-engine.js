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
  /** Upper bound on repaired line breaks per message, to bound cost. */
  static MAX_GAPS = 200;

  /** Whitespace that sits between two token characters, i.e. splits a token. */
  static GAP_PATTERN = /(?<=[A-Za-z0-9_+/=-])[\s​-‏⁠﻿­]+(?=[A-Za-z0-9_+/=-])/g;

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
        checksum: true,
        validate: match => validateLuhn(match),
        replacement: '[REDACTED_CARD_NUMBER]',
        severity: 'HIGH',
        category: 'Financial PII'
      },
      {
        id: 'iban_bank_account',
        name: 'International Bank Account (IBAN)',
        regex: /\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9A-Z]{4}){4,7}(?:[ ]?[0-9A-Z]{1,2})?\b/gi,
        // El grupo final opcional acepta un espacio y hasta dos caracteres, asi
        // que en «...0005 1332 y la tarjeta» se traga el «y». El checksum falla
        // sobre esa cadena y el IBAN se escapaba entero, que es el peor final
        // posible: la regla parecia cubrirlo. Se recorta por la derecha hasta
        // que valide. En espanol esa construccion es de lo mas corriente.
        trim: match => {
          let candidate = match;
          while (candidate.includes(' ')) {
            if (validateIBAN(candidate)) return candidate;
            candidate = candidate.slice(0, candidate.lastIndexOf(' '));
          }
          return candidate;
        },
        checksum: true,
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
        checksum: true,
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
        checksum: true,
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
        checksum: true,
        validate: match => validateMexicanRFC(match),
        replacement: '[REDACTED_MX_RFC]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'mx_curp',
        name: 'CURP mexicana',
        regex: /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d\b/gi,
        checksum: true,
        validate: match => validateMexicanCURP(match),
        replacement: '[REDACTED_MX_CURP]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'br_cpf',
        name: 'CPF brasileño',
        regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
        checksum: true,
        validate: match => validateBrazilianCPF(match),
        replacement: '[REDACTED_BR_CPF]',
        severity: 'HIGH',
        category: 'Government PII'
      },
      {
        id: 'br_cnpj',
        name: 'CNPJ brasileño',
        regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
        checksum: true,
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
      // El recorte va antes de deduplicar: dos coincidencias distintas pueden
      // reducirse al mismo valor.
      const raw = masked.match(pattern.regex) ?? [];
      const matches = [...new Set(pattern.trim ? raw.map(pattern.trim) : raw)];

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
   * Finds credentials that were broken across a line and masks them in place.
   *
   * A wrapped key is the ordinary case, not an attack: it is what a paste from
   * a PDF, an e-mail client or a narrow terminal produces. A fuzzing run found
   * 13 of 16 secret types surviving a single inserted space.
   *
   * Collapsing *all* whitespace at once does not work — it welds neighbouring
   * words together and destroys the word boundaries the patterns rely on, so
   * "token ghp_abc… fin" stops matching. Instead each gap is closed on its own
   * and only matches that actually span the closed gap are kept; everything
   * else was already handled by the direct pass.
   *
   * Limits, deliberately: only single breaks are repaired, so a key wrapped
   * twice still gets through, and at most MAX_GAPS gaps are tried per message
   * to bound the cost on long inputs.
   */
  _scanIgnoringWhitespace(text) {
    const detections = [];
    const spans = [];

    // Gaps that sit between two token characters — the only ones that can be
    // splitting a credential rather than separating two words.
    // Written as a literal on purpose: building it from a template string
    // silently mangled it — the template turned the escapes into the raw
    // characters, producing an out-of-order range that never matched.
    DLPEngine.GAP_PATTERN.lastIndex = 0;
    const gaps = [...text.matchAll(DLPEngine.GAP_PATTERN)].slice(0, DLPEngine.MAX_GAPS);

    for (const gap of gaps) {
      const gapStart = gap.index;
      const gapLength = gap[0].length;
      const joined = text.slice(0, gapStart) + text.slice(gapStart + gapLength);

      for (const pattern of this.patterns) {
        const rx = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
        let match;

        while ((match = rx.exec(joined)) !== null) {
          if (match[0].length === 0) { rx.lastIndex++; continue; }

          // El recorte solo quita por la derecha, asi que el final del tramo se
          // ajusta con la longitud ya recortada.
          const value = pattern.trim ? pattern.trim(match[0]) : match[0];
          const matchStart = match.index;
          const matchEnd = matchStart + value.length;

          // Only a match that straddles the closed gap is new information.
          if (!(matchStart < gapStart && matchEnd > gapStart)) continue;
          if (pattern.validate && !pattern.validate(value)) continue;

          const replacement = typeof pattern.replacement === 'function' ? pattern.replacement(value) : pattern.replacement;
          spans.push({ start: matchStart, end: matchEnd + gapLength, replacement });

          detections.push({
            patternId: pattern.id,
            name: pattern.name,
            severity: pattern.severity,
            category: pattern.category,
            snippet: DLPEngine.maskSnippet(value, pattern.severity),
            valueHash: this.fingerprint(value),
            splitAcrossWhitespace: true
          });
        }
      }
    }

    if (spans.length === 0) return { text, detections };

    // Applied right to left so masking one span does not shift the next.
    spans.sort((a, b) => b.start - a.start);
    let masked = text;
    let lastStart = Infinity;

    for (const span of spans) {
      if (span.end > lastStart) continue; // overlaps a span already masked
      masked = masked.slice(0, span.start) + span.replacement + masked.slice(span.end);
      lastStart = span.start;
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

    // Pass 1b — the same text with whitespace collapsed, so a credential broken
    // across a line still matches. This is not an evasion case: it is how a key
    // arrives when copied out of a PDF, an e-mail or a wrapped terminal, and a
    // fuzzing run found 13 of 16 secret types surviving a single inserted
    // space. Spans are mapped back and masked in place, so the surrounding
    // prompt is left untouched.
    const wrapped = this._scanIgnoringWhitespace(direct.text);

    // Pass 2 — a normalized copy, used only to catch evasion attempts.
    const deobfuscated = this.deobfuscator.normalize(rawText);
    let hiddenDetections = [];

    if (deobfuscated.normalizedText !== rawText) {
      const deep = this._scanAndMask(deobfuscated.normalizedText);
      const seen = new Set([...direct.detections, ...wrapped.detections].map(d => d.valueHash));
      hiddenDetections = deep.detections.filter(d => !seen.has(d.valueHash));

      if (hiddenDetections.length > 0) this.evasionAttemptsBlocked++;
    }

    const detections = [...direct.detections, ...wrapped.detections, ...hiddenDetections];
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
        logEntry.sampleAfter = wrapped.text.slice(0, 100);
        logEntry.plaintextRetained = true;
      }

      this.auditLogs.unshift(logEntry);
      if (this.auditLogs.length > this.maxAuditLogs) this.auditLogs.pop();
    }

    return {
      sanitizedText: wrapped.text,
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
