import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const GRANTED_CONSENT = { privacyConsent: { version: 1, grantedAt: "2026-08-29T00:00:00.000Z" } };

class ChromeEvent {
  listeners = [];
  addListener(listener) { this.listeners.push(listener); }
  emit(...args) { for (const listener of this.listeners) listener(...args); }
}

function createPort() {
  const messages = [];
  return {
    name: "apiviewer-panel",
    onMessage: new ChromeEvent(),
    onDisconnect: new ChromeEvent(),
    postMessage(message) { messages.push(structuredClone(message)); },
    messages,
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("does not attach before explicit privacy consent and starts after consent", async () => {
  const calls = { attach: 0 };
  const stored = {};
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        async get(key) { return { [key]: stored[key] }; },
        async set(value) { Object.assign(stored, structuredClone(value)); },
      },
    },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test", title: "Example" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { calls.attach += 1; callback(); },
      detach(_target, callback) { callback(); },
      sendCommand(_target, _method, _params, callback) { callback({}); },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 7 });
  await settle();

  assert.equal(calls.attach, 0);
  assert.equal(port.messages.at(-1).type, "consent-required");

  port.onMessage.emit({ type: "grant-consent", tabId: 7 });
  await settle();

  assert.equal(stored.privacyConsent.version, 1);
  assert.ok(stored.privacyConsent.grantedAt);
  assert.equal(calls.attach, 1);
  assert.ok(port.messages.some((message) => message.type === "snapshot"));
});

test("captures an XHR lifecycle and returns full request detail", async () => {
  const calls = { attach: [], detach: [], commands: [] };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        async get() { return { ...GRANTED_CONSENT, settings: { maxRequests: 100, maxBodyBytes: 1048576, autoStart: true } }; },
        async set() {},
      },
    },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test/device/123", title: "Device" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(target, version, callback) { calls.attach.push({ target, version }); callback(); },
      detach(target, callback) { calls.detach.push(target); callback(); },
      sendCommand(target, method, params, callback) {
        calls.commands.push({ target, method, params });
        callback(method === "Network.getResponseBody" ? { body: '{"ok":true}', base64Encoded: false } : {});
      },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 17 });
  await settle();

  assert.equal(calls.attach.length, 1);
  assert.equal(calls.attach[0].target.tabId, 17);
  assert.equal(calls.attach[0].version, "1.3");
  assert.ok(calls.commands.some((call) => call.method === "Network.enable"));
  assert.equal(port.messages.find((message) => message.type === "snapshot")?.page.url, "https://example.test/device/123");
  assert.equal(port.messages.at(-1).status, "capturing");

  events.debuggerEvent.emit(
    { tabId: 17 },
    "Network.requestWillBeSent",
    {
      requestId: "request-1",
      type: "XHR",
      timestamp: 10,
      wallTime: 1000,
      documentURL: "https://example.test/device/123",
      request: {
        method: "POST",
        url: "https://example.test/api/device/update",
        headers: { "content-type": "application/json" },
        postData: '{"status":"ONLINE"}',
        hasPostData: true,
      },
    },
  );
  events.debuggerEvent.emit(
    { tabId: 17 },
    "Network.responseReceived",
    {
      requestId: "request-1",
      type: "XHR",
      timestamp: 10.1,
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        mimeType: "application/json",
        protocol: "h2",
        remoteIPAddress: "203.0.113.1",
        fromDiskCache: false,
      },
    },
  );
  events.debuggerEvent.emit(
    { tabId: 17 },
    "Network.loadingFinished",
    { requestId: "request-1", timestamp: 10.142, encodedDataLength: 2400 },
  );
  await settle();

  const updates = port.messages.filter((message) => message.type === "request-updated");
  assert.equal(updates.at(-1).request.status, 200);
  assert.equal(Math.round(updates.at(-1).request.duration), 142);
  assert.equal(updates.at(-1).request.size, 2400);
  assert.equal(updates.at(-1).request.responseBodyState, "ready");

  port.onMessage.emit({ type: "get-request", requestId: "request-1" });
  const detail = port.messages.at(-1);
  assert.equal(detail.type, "request-detail");
  assert.equal(detail.request.requestBody, '{"status":"ONLINE"}');
  assert.equal(detail.request.responseBody, '{"ok":true}');

  port.onMessage.emit({ type: "clear" });
  assert.equal(port.messages.at(-1).type, "cleared");

  port.onMessage.emit({ type: "panel-closing" });
  port.onDisconnect.emit();
  await settle();
  assert.equal(calls.detach.length, 1);
  assert.equal(calls.detach[0].tabId, 17);
});

test("replays an edited request in the inspected page and marks its captured record", async () => {
  const calls = { commands: [] };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { async get() { return GRANTED_CONSENT; }, async set() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test/dashboard", title: "Dashboard" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { callback(); },
      detach(_target, callback) { callback(); },
      sendCommand(target, method, params, callback) {
        calls.commands.push({ target, method, params });
        if (method === "Runtime.evaluate") {
          callback({
            result: {
              value: {
                ok: true,
                status: 201,
                statusText: "Created",
                url: "https://example.test/api/items?id=2",
                duration: 24,
                size: 11,
                headers: [["content-type", "application/json"]],
                contentType: "application/json",
                body: '{"ok":true}',
                bodyState: "ready",
              },
            },
          });
        } else callback({});
      },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({
    chrome,
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    TextEncoder,
    URL,
  }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 61 });
  await settle();
  port.onMessage.emit({ type: "set-capture", enabled: false });

  port.onMessage.emit({
    type: "replay-request",
    replayId: "replay-1",
    requestId: "source-1",
    request: {
      method: "POST",
      url: "https://example.test/api/items?id=2",
      credentials: true,
      headers: [
        { name: "content-type", value: "application/json", enabled: true },
        { name: "cookie", value: "secret-cookie", enabled: true, managed: true },
      ],
      body: '{"name":"new"}',
    },
  });

  events.debuggerEvent.emit(
    { tabId: 61 },
    "Network.requestWillBeSent",
    {
      requestId: "captured-replay-1",
      type: "Fetch",
      timestamp: 20,
      wallTime: 2000,
      documentURL: "https://example.test/dashboard",
      request: {
        method: "POST",
        url: "https://example.test/api/items?id=2",
        headers: { "content-type": "application/json" },
        postData: '{"name":"new"}',
        hasPostData: true,
      },
    },
  );
  await settle();

  const evaluate = calls.commands.find((call) => call.method === "Runtime.evaluate");
  assert.ok(evaluate);
  assert.equal(evaluate.params.awaitPromise, true);
  assert.equal(evaluate.params.returnByValue, true);
  assert.ok(evaluate.params.expression.includes("fetch(input.url"));
  assert.equal(evaluate.params.expression.includes("secret-cookie"), false);

  const result = port.messages.find((message) => message.type === "replay-result");
  assert.equal(result.replayId, "replay-1");
  assert.equal(result.result.status, 201);

  const replayUpdate = port.messages
    .filter((message) => message.type === "request-updated")
    .find((message) => message.request.id === "captured-replay-1");
  assert.equal(replayUpdate.request.replayed, true);
  assert.equal(replayUpdate.request.sourceRequestId, "source-1");
  port.onDisconnect.emit();
  await settle();
});

test("waits for an in-progress debugger attachment before the first replay", async () => {
  const calls = { commands: [] };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };
  let finishAttach;
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { async get() { return GRANTED_CONSENT; }, async set() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test/dashboard", title: "Dashboard" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { finishAttach = callback; },
      detach(_target, callback) { callback(); },
      sendCommand(target, method, params, callback) {
        calls.commands.push({ target, method, params });
        if (method === "Runtime.evaluate") {
          callback({ result: { value: { ok: true, status: 200, body: "ok", bodyState: "ready" } } });
        } else callback({});
      },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({
    chrome,
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    TextEncoder,
    URL,
  }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 62 });
  await settle();

  port.onMessage.emit({
    type: "replay-request",
    replayId: "first-replay",
    requestId: "source-1",
    request: {
      method: "GET",
      url: "https://example.test/api/items",
      credentials: true,
      headers: [],
      body: "",
    },
  });
  await settle();

  assert.equal(port.messages.some((message) => message.type === "replay-result"), false);
  assert.equal(calls.commands.some((call) => call.method === "Runtime.evaluate"), false);

  finishAttach();
  await settle();

  const result = port.messages.find((message) => message.type === "replay-result");
  assert.equal(result.replayId, "first-replay");
  assert.equal(result.result.status, 200);
  assert.equal(calls.commands.filter((call) => call.method === "Runtime.evaluate").length, 1);

  port.onDisconnect.emit();
  await settle();
});

test("detaches if the panel closes while debugger attachment is still pending", async () => {
  const calls = { detach: [] };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };
  let finishAttach;

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { async get() { return GRANTED_CONSENT; }, async set() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test", title: "Example" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { finishAttach = callback; },
      detach(target, callback) { calls.detach.push(target); callback(); },
      sendCommand(_target, _method, _params, callback) { callback({}); },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 23 });
  await settle();

  port.onMessage.emit({ type: "panel-closing" });
  finishAttach();
  await settle();

  assert.equal(calls.detach.length, 1);
  assert.equal(calls.detach[0].tabId, 23);
});

test("does not attach if the panel closes before session initialization finishes", async () => {
  const calls = { attach: 0 };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };
  let finishSettings;
  let markSettingsStarted;
  const settingsStarted = new Promise((resolve) => { markSettingsStarted = resolve; });

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        get(key) {
          if (key === "privacyConsent") return Promise.resolve(GRANTED_CONSENT);
          return new Promise((resolve) => {
            finishSettings = resolve;
            markSettingsStarted();
          });
        },
        async set() {},
      },
    },
    tabs: {
      async get(tabId) { return { id: tabId, url: "https://example.test", title: "Example" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { calls.attach += 1; callback(); },
      detach(_target, callback) { callback(); },
      sendCommand(_target, _method, _params, callback) { callback({}); },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 31 });
  await settingsStarted;
  port.onMessage.emit({ type: "panel-closing" });
  finishSettings({});
  await settle();

  assert.equal(calls.attach, 0);
});

test("detaches on Chrome sidePanel.onClosed and reconnects on onOpened", async () => {
  const calls = { attach: 0, detach: 0 };
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    panelClosed: new ChromeEvent(),
    panelOpened: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: {
      setPanelBehavior: async () => {},
      onClosed: events.panelClosed,
      onOpened: events.panelOpened,
    },
    storage: { local: { async get() { return GRANTED_CONSENT; }, async set() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, windowId: 9, url: "https://example.test", title: "Example" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { calls.attach += 1; callback(); },
      detach(_target, callback) { calls.detach += 1; callback(); },
      sendCommand(_target, _method, _params, callback) { callback({}); },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 41 });
  await settle();
  assert.equal(calls.attach, 1);

  events.panelClosed.emit({ path: "sidepanel.html", windowId: 9 });
  await settle();
  assert.equal(calls.detach, 1);

  events.panelOpened.emit({ path: "sidepanel.html", windowId: 9 });
  await settle();
  assert.equal(calls.attach, 2);

  port.onDisconnect.emit();
  await settle();
});

test("detaches when render heartbeats stop even if the panel port stays connected", async () => {
  const calls = { attach: 0, detach: 0 };
  const timers = new Map();
  let nextTimerId = 0;
  const fakeSetTimeout = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const events = {
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onConnect: new ChromeEvent(),
    debuggerEvent: new ChromeEvent(),
    debuggerDetach: new ChromeEvent(),
    tabUpdated: new ChromeEvent(),
    tabRemoved: new ChromeEvent(),
  };

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onConnect: events.onConnect,
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: { local: { async get() { return GRANTED_CONSENT; }, async set() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, windowId: 12, url: "https://example.test", title: "Example" }; },
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    debugger: {
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
      attach(_target, _version, callback) { calls.attach += 1; callback(); },
      detach(_target, callback) { calls.detach += 1; callback(); },
      sendCommand(_target, _method, _params, callback) { callback({}); },
    },
  };

  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  vm.runInContext(source, vm.createContext({
    chrome,
    console,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    structuredClone,
  }));

  const port = createPort();
  events.onConnect.emit(port);
  port.onMessage.emit({ type: "init", tabId: 52 });
  await settle();
  assert.equal(calls.attach, 1);

  const watchdog = [...timers.values()].find((timer) => timer.delay === 1800);
  assert.ok(watchdog);
  watchdog.callback();
  await settle();

  assert.equal(calls.detach, 1);
});
