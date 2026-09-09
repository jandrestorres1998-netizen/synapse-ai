import Ajv from 'ajv';

/**
 * SynapseAI Agent Tool Schemas
 * Strict JSON Type Contracts for Autonomous Agent Function Calling
 */

const ajv = new Ajv({ allErrors: true, strict: true });

// Schema for executing Bash commands
const executeBashSchema = {
  type: 'object',
  properties: {
    command: { 
      type: 'string', 
      maxLength: 300,
      description: 'El comando o script bash a evaluar.'
    },
    args: {
      type: 'array',
      items: { type: 'string', maxLength: 50 },
      maxItems: 10,
      description: 'Argumentos adicionales para el script.'
    }
  },
  required: ['command'],
  additionalProperties: false
};

// Schema for querying Database
const queryDatabaseSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      maxLength: 500,
      description: 'Sentencia SQL estructurada.'
    },
    timeout: {
      type: 'integer',
      minimum: 1,
      maximum: 30
    }
  },
  required: ['query'],
  additionalProperties: false
};

// Pre-compile validators for maximum performance
export const validators = {
  execute_bash: ajv.compile(executeBashSchema),
  query_database: ajv.compile(queryDatabaseSchema)
};

export const getToolSchemas = () => ({
  execute_bash: executeBashSchema,
  query_database: queryDatabaseSchema
});
