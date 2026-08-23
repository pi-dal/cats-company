import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const showcaseScript = fileURLToPath(new URL('./local-chat-showcase.mjs', import.meta.url));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseURL) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseURL}/__mock/state`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('showcase mock server did not become ready');
}

test('showcase mock serves the Agent quota endpoint without console-noisy 404s', async (t) => {
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [showcaseScript], {
    env: {
      ...process.env,
      MOCK_CATS_PORT: String(port),
      MOCK_CATS_SCENARIO: 'showcase',
      MOCK_CATS_SHOWCASE_USERNAME: 'quota-reviewer',
      MOCK_CATS_SHOWCASE_PASSWORD: 'demo123456',
    },
    stdio: 'ignore',
  });

  t.after(() => {
    if (!server.killed) server.kill();
  });

  await waitForServer(baseURL);

  const loginResponse = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'quota-reviewer', password: 'demo123456' }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}` };

  const agentsResponse = await fetch(`${baseURL}/api/agents`, { headers });
  assert.equal(agentsResponse.status, 200);
  const { agents } = await agentsResponse.json();
  assert.ok(agents.length > 0);

  const quotaResponse = await fetch(`${baseURL}/api/agents/quota?uid=${agents[0].uid}`, { headers });
  assert.equal(quotaResponse.status, 200);
  assert.deepEqual(await quotaResponse.json(), {
    configured: true,
    shared: true,
    summary: {
      source: 'relay',
      model: 'gpt-5.6-terra',
      remaining_percent: 82,
      status: 'normal',
    },
  });

  const missingAgentResponse = await fetch(`${baseURL}/api/agents/quota?uid=999999`, { headers });
  assert.equal(missingAgentResponse.status, 404);
});

test('showcase mock creates a public capability excerpt with an isolated preview file', async (t) => {
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [showcaseScript], {
    env: {
      ...process.env,
      MOCK_CATS_PORT: String(port),
      MOCK_CATS_SCENARIO: 'showcase',
      MOCK_CATS_SHOWCASE_USERNAME: 'share-reviewer',
      MOCK_CATS_SHOWCASE_PASSWORD: 'demo123456',
    },
    stdio: 'ignore',
  });

  t.after(() => {
    if (!server.killed) server.kill();
  });

  await waitForServer(baseURL);
  const loginResponse = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'share-reviewer', password: 'demo123456' }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

  const agentsResponse = await fetch(`${baseURL}/api/agents`, { headers });
  const { agents } = await agentsResponse.json();
  const topicID = `p2p_${login.uid}_${agents[0].uid}`;
  const historyResponse = await fetch(`${baseURL}/api/messages?topic_id=${encodeURIComponent(topicID)}`, { headers });
  assert.equal(historyResponse.status, 200);
  const { messages } = await historyResponse.json();
  const messageWithPreview = messages.find((message) => Array.isArray(message.content_blocks)
    && message.content_blocks.some((block) => block.type === 'file'));
  assert.ok(messageWithPreview);
  assert.equal(messageWithPreview.seq_id, messageWithPreview.seq);

  const shareResponse = await fetch(`${baseURL}/api/conversation-shares`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      topic_id: topicID,
      message_ids: [messageWithPreview.seq],
      title: '聊天界面验收片段',
      expires_in: 60 * 60,
    }),
  });
  assert.equal(shareResponse.status, 201);
  const share = await shareResponse.json();
  const token = new URL(share.url).pathname.split('/').at(-1);

  const publicResponse = await fetch(`${baseURL}/api/shared-conversations/${token}`);
  assert.equal(publicResponse.status, 200);
  const publicShare = await publicResponse.json();
  assert.equal(publicShare.items.length, 1);
  assert.equal(Object.hasOwn(publicShare.items[0], 'topic_id'), false);
  const assetURL = publicShare.items[0].content_blocks.find((block) => block.type === 'file').payload.url;
  assert.match(assetURL, new RegExp(`^/api/shared-conversations/${token}/assets/[a-f0-9]{32}$`));

  const assetResponse = await fetch(`${baseURL}${assetURL}`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get('content-type'), /^text\/markdown/);
  assert.ok((await assetResponse.text()).length > 0);

  const revokeResponse = await fetch(`${baseURL}/api/conversation-shares/${share.id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(revokeResponse.status, 200);
  assert.equal((await fetch(`${baseURL}/api/shared-conversations/${token}`)).status, 404);
});
