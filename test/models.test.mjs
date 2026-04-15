import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearComboCache,
  clearModelCache,
  fetchModels,
  getCachedModels,
  isCacheValid,
  refreshModels,
} from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;

const CONFIG = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'test-key',
  apiMode: 'chat',
  modelCacheTtl: 60000,
  modelsDev: { enabled: false },
};

afterEach(() => {
  clearComboCache();
  clearModelCache();
  global.fetch = ORIGINAL_FETCH;
});

test('fetchModels caches successful responses', async () => {
  let calls = 0;

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/api/combos')) {
      return new Response(JSON.stringify({ combos: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    calls += 1;
    return new Response(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' }],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  const first = await fetchModels(CONFIG, CONFIG.apiKey, false);
  const second = await fetchModels(CONFIG, CONFIG.apiKey, false);

  assert.equal(calls, 1);
  assert.equal(first[0].id, 'gpt-4.1-mini');
  assert.equal(second[0].id, 'gpt-4.1-mini');
  assert.ok(getCachedModels(CONFIG, CONFIG.apiKey));
  assert.equal(isCacheValid(CONFIG, CONFIG.apiKey), true);
});

test('refreshModels forces refetch', async () => {
  let calls = 0;

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/api/combos')) {
      return new Response(JSON.stringify({ combos: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    calls += 1;
    return new Response(
      JSON.stringify({
        object: 'list',
        data: [{ id: `model-${calls}`, name: `Model ${calls}` }],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  await fetchModels(CONFIG, CONFIG.apiKey, false);
  const refreshed = await refreshModels(CONFIG, CONFIG.apiKey);

  assert.equal(calls, 2);
  assert.equal(refreshed[0].id, 'model-2');
});

test('fetchModels falls back to defaults when response shape is invalid', async () => {
  global.fetch = async () => {
    return new Response(JSON.stringify({ data: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, true);
  assert.ok(models.length > 0);
  assert.ok(typeof models[0].id === 'string');
});

test('fetchModels preserves snake_case context limits from OmniRoute responses', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/api/combos')) {
      return new Response(JSON.stringify({ combos: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        object: 'list',
        data: [
          {
            id: 'cx/gpt-5.3-codex-high',
            name: 'cx/gpt-5.3-codex-high',
            context_length: 400000,
            max_tokens: 128000,
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, true);

  assert.equal(models[0].id, 'cx/gpt-5.3-codex-high');
  assert.equal(models[0].contextWindow, 400000);
  assert.equal(models[0].maxTokens, 128000);
});

test('fetchModels tolerates combo payloads that use object model targets', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'cx/gpt-5.4-high', name: 'cx/gpt-5.4-high' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (url.endsWith('/api/combos')) {
      return new Response(
        JSON.stringify({
          combos: [
            {
              id: 'combo-1',
              name: 'cx/gpt-5.4-high',
              models: [
                {
                  id: 'combo-target-1',
                  kind: 'model',
                  model: 'codex/gpt-5.4-high',
                  providerId: 'codex',
                  weight: 0,
                },
              ],
              strategy: 'priority',
              config: {},
              createdAt: '2026-04-01T14:55:16.922Z',
              updatedAt: '2026-04-01T14:55:16.922Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const models = await fetchModels(
    {
      ...CONFIG,
      modelsDev: { enabled: false },
    },
    CONFIG.apiKey,
    true,
  );

  assert.deepEqual(models.map((model) => model.id), ['cx/gpt-5.4-high']);
});
