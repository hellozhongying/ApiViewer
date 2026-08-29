const DEBUGGER_VERSION = "1.3";
const SIDE_PANEL_PATH = "sidepanel.html";
const PRIVACY_CONSENT_VERSION = 1;
const PANEL_HEARTBEAT_TIMEOUT_MS = 1800;
const REPLAY_TIMEOUT_MS = 30_000;
const DEFAULT_SETTINGS = Object.freeze({
  maxRequests: 250,
  maxBodyBytes: 2 * 1024 * 1024,
  autoStart: true,
});

/** @type {Map<number, {
 *   attached: boolean,
 *   attaching: boolean,
 *   attachPromise: Promise<void> | null,
 *   detachPromise: Promise<void> | null,
 *   panelOpen: boolean,
 *   windowId: number | null,
 *   heartbeatTimer: ReturnType<typeof setTimeout> | null,
 *   captureEnabled: boolean,
 *   status: string,
 *   error: string,
 *   page: {url: string, title: string},
 *   requests: Map<string, any>,
 *   order: string[],
 *   pendingReplays: Array<{id: string, sourceRequestId: string, method: string, url: string, createdAt: number}>,
 *   ports: Set<chrome.runtime.Port>,
 *   settings: typeof DEFAULT_SETTINGS
 * }>} */
const sessions = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.get("settings").then(({ settings }) => {
    if (!settings) chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Chrome 142+ exposes the actual side-panel lifecycle. Closing the browser UI
// does not consistently unload the panel document, so port disconnect alone is
// not a reliable signal for releasing chrome.debugger.
chrome.sidePanel.onClosed?.addListener((info) => {
  if (!isApiViewerPanel(info)) return;
  forEachMatchingPanelSession(info, (tabId, session) => {
    session.panelOpen = false;
    stopPanelHeartbeat(session);
    void suspendPanelSession(tabId, session);
  });
});

chrome.sidePanel.onOpened?.addListener((info) => {
  if (!isApiViewerPanel(info)) return;
  forEachMatchingPanelSession(info, (tabId, session) => {
    session.panelOpen = true;
    refreshPanelHeartbeat(tabId, session);
    void resumePanelSession(tabId, session);
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "apiviewer-panel") return;

  let currentTabId = null;
  let panelClosed = false;

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "init" && Number.isInteger(message.tabId)) {
      panelClosed = false;
      if (currentTabId !== null && currentTabId !== message.tabId) {
        void removePortFromSession(currentTabId, port);
      }
      currentTabId = message.tabId;
      void initializePanel(message.tabId, port, () => panelClosed || currentTabId !== message.tabId);
      return;
    }

    if (message.type === "grant-consent" && Number.isInteger(message.tabId)) {
      panelClosed = false;
      if (currentTabId !== null && currentTabId !== message.tabId) {
        void removePortFromSession(currentTabId, port);
      }
      currentTabId = message.tabId;
      void grantPrivacyConsent()
        .then(() => initializePanel(message.tabId, port, () => panelClosed || currentTabId !== message.tabId))
        .catch(() => safePost(port, { type: "consent-error", error: "无法保存授权状态，请重试。" }));
      return;
    }

    if (message.type === "panel-closing") {
      panelClosed = true;
      if (currentTabId !== null) {
        const session = sessions.get(currentTabId);
        if (session) session.panelOpen = false;
        void removePortFromSession(currentTabId, port);
      }
      currentTabId = null;
      return;
    }

    if (currentTabId === null) return;
    const session = sessions.get(currentTabId);
    if (!session) return;

    if (message.type === "heartbeat") {
      const needsResume = !session.panelOpen || !session.attached;
      session.panelOpen = true;
      refreshPanelHeartbeat(currentTabId, session);
      if (needsResume) void resumePanelSession(currentTabId, session);
    } else if (message.type === "clear") {
      session.requests.clear();
      session.order.length = 0;
      broadcast(session, { type: "cleared" });
    } else if (message.type === "get-request") {
      const request = session.requests.get(message.requestId);
      port.postMessage({ type: "request-detail", request: request || null });
    } else if (message.type === "set-capture") {
      session.captureEnabled = Boolean(message.enabled);
      session.status = session.captureEnabled ? "capturing" : "paused";
      broadcastStatus(session);
    } else if (message.type === "update-settings") {
      void updateSettings(currentTabId, session, message.settings);
    } else if (message.type === "retry-attach") {
      void attachDebugger(currentTabId, session);
    } else if (message.type === "replay-request") {
      void replayRequest(currentTabId, session, port, message);
    } else if (message.type === "cancel-replay") {
      void cancelReplay(currentTabId, session, message.replayId);
    }
  });

  port.onDisconnect.addListener(() => {
    panelClosed = true;
    if (currentTabId !== null) void removePortFromSession(currentTabId, port);
    currentTabId = null;
  });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId)) return;
  const session = sessions.get(tabId);
  if (!session?.attached) return;
  handleNetworkEvent(tabId, session, method, params);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId)) return;
  const session = sessions.get(tabId);
  if (!session) return;
  session.attached = false;
  session.attaching = false;
  session.status = "detached";
  session.error = detachReason(reason);
  broadcastStatus(session);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const session = sessions.get(tabId);
  if (!session) return;
  if (changeInfo.url || changeInfo.title) {
    session.page = { url: tab.url || session.page.url, title: tab.title || session.page.title };
    broadcast(session, { type: "page", page: session.page });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = sessions.get(tabId);
  if (session) {
    stopPanelHeartbeat(session);
    sessions.delete(tabId);
  }
});

async function initializePanel(tabId, port, isStale) {
  if (!await hasPrivacyConsent()) {
    if (!isStale()) safePost(port, { type: "consent-required", version: PRIVACY_CONSENT_VERSION });
    return;
  }

  let session = sessions.get(tabId);
  if (!session) {
    const [{ settings }, tab] = await Promise.all([
      chrome.storage.local.get("settings"),
      chrome.tabs.get(tabId).catch(() => null),
    ]);
    if (isStale()) return;
    const mergedSettings = normalizeSettings(settings);
    session = {
      attached: false,
      attaching: false,
      attachPromise: null,
      detachPromise: null,
      panelOpen: true,
      windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
      heartbeatTimer: null,
      captureEnabled: mergedSettings.autoStart,
      status: "connecting",
      error: "",
      page: { url: tab?.url || "", title: tab?.title || "" },
      requests: new Map(),
      order: [],
      pendingReplays: [],
      ports: new Set(),
      settings: mergedSettings,
    };
    sessions.set(tabId, session);
  }

  session.panelOpen = true;
  refreshPanelHeartbeat(tabId, session);
  session.ports.add(port);
  port.postMessage({
    type: "snapshot",
    status: session.status,
    error: session.error,
    page: session.page,
    settings: session.settings,
    capturing: session.captureEnabled,
    requests: session.order.map((id) => summarize(session.requests.get(id))).filter(Boolean),
  });

  if (session.detachPromise) await session.detachPromise;
  if (isStale()) {
    await removePortFromSession(tabId, port);
    return;
  }

  if (!session.attached && !session.attaching) {
    await attachDebugger(tabId, session);
  }
}

async function hasPrivacyConsent() {
  const { privacyConsent } = await chrome.storage.local.get("privacyConsent");
  return privacyConsent?.version === PRIVACY_CONSENT_VERSION && Boolean(privacyConsent?.grantedAt);
}

async function grantPrivacyConsent() {
  await chrome.storage.local.set({
    privacyConsent: {
      version: PRIVACY_CONSENT_VERSION,
      grantedAt: new Date().toISOString(),
    },
  });
}

async function attachDebugger(tabId, session) {
  if (session.attached || !session.panelOpen) return;
  if (session.attachPromise) return session.attachPromise;

  const attachPromise = performDebuggerAttach(tabId, session);
  session.attachPromise = attachPromise;
  try {
    await attachPromise;
  } finally {
    if (session.attachPromise === attachPromise) session.attachPromise = null;
  }
}

async function performDebuggerAttach(tabId, session) {
  session.attaching = true;
  session.status = "connecting";
  session.error = "";
  broadcastStatus(session);

  try {
    const tab = await chrome.tabs.get(tabId);
    session.page = { url: tab.url || "", title: tab.title || "" };
    broadcast(session, { type: "page", page: session.page });

    if (!isInspectableUrl(tab.url || "")) {
      throw new Error("此页面受 Chrome 保护，无法捕获请求。请切换到普通网页后重试。");
    }

    await debuggerAttach({ tabId }, DEBUGGER_VERSION);
    session.attached = true;
    await debuggerCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: session.settings.maxBodyBytes,
      maxPostDataSize: session.settings.maxBodyBytes,
    });
    session.status = session.captureEnabled ? "capturing" : "paused";
  } catch (error) {
    if (session.attached) await detachSession(tabId, session);
    session.attached = false;
    session.status = "error";
    session.error = friendlyAttachError(error);
  } finally {
    session.attaching = false;
    if (!session.panelOpen) {
      await detachSession(tabId, session);
      session.status = "detached";
      session.error = "";
      if (session.ports.size === 0) await cleanupSession(tabId, session);
    } else if (session.ports.size === 0) {
      await cleanupSession(tabId, session);
    } else {
      broadcastStatus(session);
    }
  }
}

function handleNetworkEvent(tabId, session, method, params) {
  if (method === "Network.requestWillBeSent") {
    if (!isApiType(params.type)) return;
    const replay = takePendingReplay(session, params);
    if (!session.captureEnabled && !replay) return;
    const request = {
      id: params.requestId,
      type: normalizeType(params.type),
      method: params.request.method,
      url: params.request.url,
      documentURL: params.documentURL || "",
      requestHeaders: params.request.headers || {},
      requestBody: params.request.postData || "",
      requestBodyAvailable: Boolean(params.request.hasPostData || params.request.postData),
      responseHeaders: {},
      responseBody: "",
      responseBodyBase64: false,
      responseBodyState: "pending",
      status: null,
      statusText: "",
      mimeType: "",
      protocol: "",
      remoteIPAddress: "",
      fromDiskCache: false,
      failed: false,
      errorText: "",
      startTime: params.timestamp,
      endTime: null,
      duration: null,
      size: null,
      wallTime: params.wallTime || null,
      replayed: Boolean(replay),
      replayId: replay?.id || "",
      sourceRequestId: replay?.sourceRequestId || "",
    };

    if (!session.requests.has(request.id)) session.order.push(request.id);
    session.requests.set(request.id, request);
    trimSession(session);
    broadcast(session, { type: "request-updated", request: summarize(request) });
    return;
  }

  const request = session.requests.get(params.requestId);
  if (!request) return;
  if (!session.captureEnabled && !request.replayed) return;

  if (method === "Network.requestWillBeSentExtraInfo") {
    request.requestHeaders = params.headers || request.requestHeaders;
  } else if (method === "Network.responseReceived") {
    request.status = params.response.status;
    request.statusText = params.response.statusText || "";
    request.responseHeaders = params.response.headers || {};
    request.mimeType = params.response.mimeType || "";
    request.protocol = params.response.protocol || "";
    request.remoteIPAddress = params.response.remoteIPAddress || "";
    request.fromDiskCache = Boolean(params.response.fromDiskCache);
    request.type = normalizeType(params.type || request.type);
  } else if (method === "Network.responseReceivedExtraInfo") {
    request.responseHeaders = params.headers || request.responseHeaders;
    if (Number.isFinite(params.statusCode)) request.status = params.statusCode;
  } else if (method === "Network.dataReceived") {
    request.size = (request.size || 0) + (params.encodedDataLength || 0);
  } else if (method === "Network.loadingFinished") {
    request.endTime = params.timestamp;
    request.duration = Math.max(0, (request.endTime - request.startTime) * 1000);
    request.size = Number.isFinite(params.encodedDataLength) ? params.encodedDataLength : request.size;
    request.responseBodyState = "loading";
    broadcast(session, { type: "request-updated", request: summarize(request) });
    void loadResponseBody(tabId, session, request);
    return;
  } else if (method === "Network.loadingFailed") {
    request.endTime = params.timestamp;
    request.duration = Math.max(0, (request.endTime - request.startTime) * 1000);
    request.failed = true;
    request.errorText = params.errorText || "请求失败";
    request.responseBodyState = "unavailable";
  } else {
    return;
  }

  broadcast(session, { type: "request-updated", request: summarize(request) });
}

async function loadResponseBody(tabId, session, request) {
  if ((request.size || 0) > session.settings.maxBodyBytes) {
    request.responseBodyState = "too-large";
    broadcast(session, { type: "request-updated", request: summarize(request) });
    return;
  }

  try {
    const result = await debuggerCommand({ tabId }, "Network.getResponseBody", { requestId: request.id });
    request.responseBody = result?.body || "";
    request.responseBodyBase64 = Boolean(result?.base64Encoded);
    request.responseBodyState = "ready";
  } catch {
    request.responseBodyState = "unavailable";
  }

  broadcast(session, { type: "request-updated", request: summarize(request) });
}

async function replayRequest(tabId, session, port, message) {
  const replayId = typeof message.replayId === "string" ? message.replayId : "";
  try {
    if (!replayId) throw new Error("缺少重放请求标识。");
    if (session.detachPromise) await session.detachPromise;
    if (!session.attached && session.panelOpen) await attachDebugger(tabId, session);
    if (!session.attached) {
      throw new Error(session.error || "当前页面尚未连接，无法发送请求。");
    }

    const input = normalizeReplayInput(message.request, session.settings.maxBodyBytes);
    session.pendingReplays = session.pendingReplays.filter((item) => Date.now() - item.createdAt < REPLAY_TIMEOUT_MS);
    session.pendingReplays.push({
      id: replayId,
      sourceRequestId: typeof message.requestId === "string" ? message.requestId : "",
      method: input.method,
      url: input.url,
      createdAt: Date.now(),
    });

    const evaluation = await debuggerCommand({ tabId }, "Runtime.evaluate", {
      expression: buildReplayExpression({
        ...input,
        replayId,
        maxBodyBytes: session.settings.maxBodyBytes,
        timeoutMs: REPLAY_TIMEOUT_MS,
      }),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    if (evaluation?.exceptionDetails) {
      throw new Error(runtimeExceptionMessage(evaluation.exceptionDetails));
    }
    const result = evaluation?.result?.value;
    if (!result || typeof result !== "object") throw new Error("页面没有返回可读取的响应结果。");
    safePost(port, { type: "replay-result", replayId, result });
  } catch (error) {
    session.pendingReplays = session.pendingReplays.filter((item) => item.id !== replayId);
    safePost(port, {
      type: "replay-result",
      replayId,
      result: { ok: false, error: String(error?.message || error || "请求发送失败") },
    });
  }
}

async function cancelReplay(tabId, session, replayId) {
  if (!session.attached || typeof replayId !== "string" || !replayId) return;
  session.pendingReplays = session.pendingReplays.filter((item) => item.id !== replayId);
  const expression = `(() => { const registry = globalThis.__APIVIEWER_REPLAY_CONTROLLERS__; const controller = registry?.[${JSON.stringify(replayId)}]; if (!controller) return false; controller.abort(); return true; })()`;
  await debuggerCommand({ tabId }, "Runtime.evaluate", { expression, returnByValue: true }).catch(() => {});
}

function normalizeReplayInput(request, maxBodyBytes) {
  if (!request || typeof request !== "object") throw new Error("请求配置无效。");
  const method = String(request.method || "GET").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("请求方法无效。");

  let url;
  try {
    url = new URL(String(request.url || ""));
  } catch {
    throw new Error("请输入有效的请求 URL。");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("目前只支持重放 HTTP 和 HTTPS 请求。");

  const body = typeof request.body === "string" ? request.body : "";
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) {
    throw new Error("请求体超过设置中的大小上限。");
  }

  const headers = Array.isArray(request.headers)
    ? request.headers
      .filter((item) => item && item.enabled !== false && !item.managed)
      .map((item) => ({ name: String(item.name || "").trim(), value: String(item.value || "") }))
      .filter((item) => item.name && !isManagedRequestHeader(item.name))
    : [];

  return {
    method,
    url: url.href,
    headers,
    body: method === "GET" || method === "HEAD" ? "" : body,
    credentials: request.credentials === false ? "same-origin" : "include",
  };
}

function buildReplayExpression(input) {
  const sourceName = `apiviewer-replay-${String(input.replayId).replace(/[^a-z0-9_-]/gi, "")}.js`;
  return `(${pageReplayRequest.toString()})(${JSON.stringify(input)})\n//# sourceURL=${sourceName}`;
}

async function pageReplayRequest(input) {
  const registryKey = "__APIVIEWER_REPLAY_CONTROLLERS__";
  const registry = globalThis[registryKey] || (globalThis[registryKey] = Object.create(null));
  const controller = new AbortController();
  registry[input.replayId] = controller;
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = performance.now();

  try {
    const headers = new Headers();
    for (const item of input.headers) headers.append(item.name, item.value);
    const response = await fetch(input.url, {
      method: input.method,
      headers,
      body: input.body || undefined,
      credentials: input.credentials,
      signal: controller.signal,
    });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    const textLike = !contentType || /(^text\/|json|javascript|xml|svg|x-www-form-urlencoded)/i.test(contentType);
    let body = "";
    let bodyState = "ready";
    if (buffer.byteLength > input.maxBodyBytes) bodyState = "too-large";
    else if (!textLike && buffer.byteLength) bodyState = "binary";
    else if (buffer.byteLength) body = new TextDecoder().decode(buffer);

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      redirected: response.redirected,
      duration: Math.max(0, performance.now() - startedAt),
      size: buffer.byteLength,
      headers: Array.from(response.headers.entries()),
      contentType,
      body,
      bodyState,
    };
  } catch (error) {
    return {
      ok: false,
      duration: Math.max(0, performance.now() - startedAt),
      error: error?.name === "AbortError" ? "请求已取消或等待响应超时。" : String(error?.message || error || "请求发送失败"),
    };
  } finally {
    clearTimeout(timer);
    delete registry[input.replayId];
  }
}

function takePendingReplay(session, params) {
  const now = Date.now();
  session.pendingReplays = session.pendingReplays.filter((item) => now - item.createdAt < REPLAY_TIMEOUT_MS);
  const initiatorText = JSON.stringify(params?.initiator || {});
  const sourceIndex = session.pendingReplays.findIndex((item) => initiatorText.includes(`apiviewer-replay-${item.id}`));
  if (sourceIndex >= 0) return session.pendingReplays.splice(sourceIndex, 1)[0];
  const request = params?.request;
  const index = session.pendingReplays.findIndex((item) => (
    item.method === String(request?.method || "").toUpperCase()
    && item.url === String(request?.url || "")
  ));
  if (index < 0) return null;
  return session.pendingReplays.splice(index, 1)[0];
}

function isManagedRequestHeader(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized.startsWith(":")
    || normalized.startsWith("sec-")
    || normalized.startsWith("proxy-")
    || [
      "accept-encoding", "connection", "content-length", "cookie", "host", "origin",
      "referer", "te", "trailer", "transfer-encoding", "upgrade", "user-agent",
    ].includes(normalized);
}

function runtimeExceptionMessage(details) {
  return details?.exception?.description || details?.text || "页面执行请求时发生错误。";
}

function safePost(port, message) {
  try { port.postMessage(message); } catch { /* The panel may have closed while awaiting the response. */ }
}

async function updateSettings(tabId, session, nextSettings) {
  session.settings = normalizeSettings({ ...session.settings, ...nextSettings });
  trimSession(session);
  if (session.attached) {
    await debuggerCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: session.settings.maxBodyBytes,
      maxPostDataSize: session.settings.maxBodyBytes,
    }).catch(() => {});
  }
  await chrome.storage.local.set({ settings: session.settings });
  broadcast(session, { type: "settings", settings: session.settings });
}

async function removePortFromSession(tabId, port) {
  const session = sessions.get(tabId);
  if (!session) return;
  session.ports.delete(port);
  if (session.ports.size > 0) return;

  await cleanupSession(tabId, session);
}

async function suspendPanelSession(tabId, session) {
  // attachDebugger() performs this cleanup in its finally block if closing
  // races with attach or Network.enable.
  if (session.attaching) return;
  await detachSession(tabId, session);
  session.status = "detached";
  session.error = "";
  broadcastStatus(session);
}

async function resumePanelSession(tabId, session) {
  if (session.detachPromise) await session.detachPromise;
  if (!session.panelOpen || session.ports.size === 0) return;
  await attachDebugger(tabId, session);
}

async function cleanupSession(tabId, session) {
  if (session.ports.size > 0) return;

  // If the panel closes while attach/Network.enable is still pending, the
  // attach operation's finally block will return here and detach immediately.
  if (session.attaching) return;

  await detachSession(tabId, session);
  if (session.ports.size === 0 && sessions.get(tabId) === session) {
    stopPanelHeartbeat(session);
    sessions.delete(tabId);
  }
}

async function detachSession(tabId, session) {
  if (!session.attached) return;

  if (!session.detachPromise) {
    session.detachPromise = debuggerDetach({ tabId })
      .catch(() => {})
      .finally(() => {
        session.attached = false;
        session.detachPromise = null;
      });
  }

  await session.detachPromise;
}

function isApiViewerPanel(info) {
  return String(info?.path || "").replace(/^\//, "") === SIDE_PANEL_PATH;
}

function forEachMatchingPanelSession(info, callback) {
  for (const [tabId, session] of sessions) {
    const matches = Number.isInteger(info.tabId)
      ? tabId === info.tabId
      : session.windowId === info.windowId;
    if (matches) callback(tabId, session);
  }
}

function refreshPanelHeartbeat(tabId, session) {
  stopPanelHeartbeat(session);
  session.heartbeatTimer = setTimeout(() => {
    session.heartbeatTimer = null;
    if (sessions.get(tabId) !== session || session.ports.size === 0) return;
    session.panelOpen = false;
    void suspendPanelSession(tabId, session);
  }, PANEL_HEARTBEAT_TIMEOUT_MS);
}

function stopPanelHeartbeat(session) {
  if (session.heartbeatTimer === null) return;
  clearTimeout(session.heartbeatTimer);
  session.heartbeatTimer = null;
}

function trimSession(session) {
  while (session.order.length > session.settings.maxRequests) {
    const oldestId = session.order.shift();
    if (oldestId) session.requests.delete(oldestId);
  }
}

function summarize(request) {
  if (!request) return null;
  return {
    id: request.id,
    type: request.type,
    method: request.method,
    url: request.url,
    status: request.status,
    statusText: request.statusText,
    duration: request.duration,
    size: request.size,
    failed: request.failed,
    errorText: request.errorText,
    responseBodyState: request.responseBodyState,
    startTime: request.startTime,
    replayed: Boolean(request.replayed),
    sourceRequestId: request.sourceRequestId || "",
  };
}

function broadcastStatus(session) {
  broadcast(session, {
    type: "status",
    status: session.status,
    error: session.error,
    capturing: session.captureEnabled,
  });
}

function broadcast(session, message) {
  for (const port of session.ports) {
    try {
      port.postMessage(message);
    } catch {
      session.ports.delete(port);
    }
  }
}

function isApiType(type) {
  return type === "XHR" || type === "Fetch";
}

function normalizeType(type) {
  return String(type || "Other").toLowerCase() === "xhr" ? "XHR" : "Fetch";
}

function normalizeSettings(settings = {}) {
  const maxRequests = [100, 250, 500].includes(Number(settings.maxRequests))
    ? Number(settings.maxRequests)
    : DEFAULT_SETTINGS.maxRequests;
  const allowedBodySizes = [1, 2, 5].map((value) => value * 1024 * 1024);
  const maxBodyBytes = allowedBodySizes.includes(Number(settings.maxBodyBytes))
    ? Number(settings.maxBodyBytes)
    : DEFAULT_SETTINGS.maxBodyBytes;
  return {
    maxRequests,
    maxBodyBytes,
    autoStart: settings.autoStart !== false,
  };
}

function isInspectableUrl(url) {
  return /^(https?|file):/i.test(url);
}

function friendlyAttachError(error) {
  const message = String(error?.message || error || "无法连接到当前标签页");
  if (message.includes("Another debugger")) {
    return "当前标签页已被开发者工具或其他调试器占用，请关闭后重试。";
  }
  if (message.includes("Cannot access") || message.includes("not allowed")) {
    return "Chrome 不允许检查此页面，请切换到普通网页后重试。";
  }
  return message;
}

function detachReason(reason) {
  const labels = {
    target_closed: "标签页已关闭。",
    canceled_by_user: "调试连接已被用户取消。",
    replaced_with_devtools: "Chrome 开发者工具已接管调试连接。",
  };
  return labels[reason] || "调试连接已断开，可点击重试。";
}

function debuggerAttach(target, version) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, version, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function debuggerCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}
