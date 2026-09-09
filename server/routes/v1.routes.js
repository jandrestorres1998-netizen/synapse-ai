import { Router } from 'express';
import { router as modelRouter, providers } from '../config/container.js';

const router = Router();

/**
 * GET /v1/models — OpenAI-compatible model listing.
 *
 * Not decoration: LangChain, LlamaIndex and the OpenAI SDKs call this on
 * startup to discover what is available. Returning 404 made those clients fail
 * before they sent a single completion, which quietly broke the "just change
 * the baseURL" promise.
 *
 * Only models whose provider is actually reachable are listed — advertising a
 * model the gateway cannot serve moves the failure to the first real request.
 */
router.get('/models', (req, res) => {
  const created = Math.floor(Date.now() / 1000);

  res.json({
    object: 'list',
    data: modelRouter.getAvailableModels()
      .filter(m => m.available && m.provider !== 'mock')
      .map(m => ({
        id: m.providerModel,
        object: 'model',
        created,
        owned_by: m.provider,
        _synapse: { alias: m.id, tier: m.tier, contextWindow: m.contextWindow }
      }))
  });
});

/** GET /v1/models/:id */
router.get('/models/:id', (req, res) => {
  const model = modelRouter.getAvailableModels()
    .find(m => m.providerModel === req.params.id || m.id === req.params.id);

  if (!model || !model.available) {
    return res.status(404).json({
      error: { message: `El modelo "${req.params.id}" no existe o su proveedor no está configurado.`, type: 'invalid_request_error', code: 'model_not_found' }
    });
  }

  res.json({
    id: model.providerModel,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.provider
  });
});

export { providers };
export default router;
