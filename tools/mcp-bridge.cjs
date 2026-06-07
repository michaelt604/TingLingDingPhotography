#!/usr/bin/env node
/**
 * tld-mcp-bridge.cjs
 *
 * A minimal MCP stdio server that wraps the Playwright library directly.
 * Built because the official @playwright/mcp package can be slow to
 * initialize (~200ms+) and a plain Node script that responds to JSON-RPC
 * immediately is more reliable.
 *
 * Tools:
 *   - browser_navigate  { url }
 *   - browser_screenshot { filename?, fullPage? }
 *   - browser_close
 *   - browser_resize    { width, height }
 *
 * Usage (registered in ~/.mavis/mcp/mcp.json):
 *   node C:\...\tools\mcp-bridge.cjs
 *
 * Keep this dead simple. If you need more tools, add them — but
 * prefer fewer, more powerful tools over many small ones.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

let browser = null;
let context = null;
let page = null;

const OUTPUT_DIR = process.env.TLD_MCP_OUTPUT_DIR || path.join(process.cwd(), 'preview');
try { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); } catch {}

const TOOLS = [
  {
    name: 'browser_resize',
    description: 'Resize the browser viewport.',
    inputSchema: {
      type: 'object',
      properties: {
        width:  { type: 'number', default: 1440 },
        height: { type: 'number', default: 900 },
      },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Creates a browser/context/page on first use.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Saves to preview/ by default.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Output filename (without .png). Defaults to timestamped name.' },
        fullPage: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser and free resources.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function ensureBrowser() {
  if (browser && context && page) return;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let readBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  readBuffer += chunk;
  let idx;
  while ((idx = readBuffer.indexOf('\n')) !== -1) {
    const line = readBuffer.slice(0, idx).trim();
    readBuffer = readBuffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch((e) => {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e && e.message || e) } });
    });
  }
});

async function handle(msg) {
  // Notifications (no id) — handle but don't respond
  if (msg.id === undefined) {
    if (msg.method === 'notifications/cancelled') return;
    if (msg.method === 'notifications/initialized') return;
    return;
  }
  if (msg.method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tld-mcp-bridge', version: '1.0.0' },
      },
    });
  }
  if (msg.method === 'ping') {
    return send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const result = await callTool(name, args);
    return send({ jsonrpc: '2.0', id: msg.id, result });
  }
  return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
}

async function callTool(name, args) {
  try {
    if (name === 'browser_resize') {
      await ensureBrowser();
      const w = Number(args.width) || 1440;
      const h = Number(args.height) || 900;
      await page.setViewportSize({ width: w, height: h });
      return { content: [{ type: 'text', text: `Viewport set to ${w}x${h}` }] };
    }
    if (name === 'browser_navigate') {
      const url = args.url;
      if (!url) throw new Error('url is required');
      await ensureBrowser();
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const title = await page.title();
      return { content: [{ type: 'text', text: `Navigated to ${url}\nStatus: ${res ? res.status() : '?'}\nTitle: ${title}` }] };
    }
    if (name === 'browser_screenshot') {
      await ensureBrowser();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = (args.filename || `screenshot-${stamp}`) + '.png';
      const fullPage = Boolean(args.fullPage);
      const out = path.join(OUTPUT_DIR, filename);
      await page.screenshot({ path: out, fullPage });
      return { content: [{ type: 'text', text: `Saved: ${out}` }] };
    }
    if (name === 'browser_close') {
      if (browser) await browser.close().catch(() => {});
      browser = null; context = null; page = null;
      return { content: [{ type: 'text', text: 'Browser closed' }] };
    }
    throw new Error('Unknown tool: ' + name);
  } catch (e) {
    return { content: [{ type: 'text', text: 'Error: ' + (e && e.message || String(e)) }], isError: true };
  }
}

// Self-test on direct invocation: `node mcp-bridge.cjs --selftest`
if (process.argv.includes('--selftest')) {
  (async () => {
    await ensureBrowser();
    await page.goto('about:blank');
    const out = path.join(OUTPUT_DIR, 'selftest.png');
    await page.screenshot({ path: out });
    console.log('selftest ok:', out);
    await browser.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
