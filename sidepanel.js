const state = {
  tabId: null,
  port: null,
  requests: new Map(),
  order: [],
  selectedId: null,
  selectedDetail: null,
  filter: "All",
  search: "",
  activeDetailTab: "overview",
  captureStatus: "connecting",
  capturing: true,
  connectionError: "",
  replay: {
    open: false,
    sourceId: null,
    original: null,
    draft: null,
    activeTab: "params",
    resultTab: "body",
    result: null,
    replayId: "",
    sending: false,
    dirty: false,
    showSensitive: false,
  },
  settings: {
    maxRequests: 250,
    maxBodyBytes: 2 * 1024 * 1024,
    autoStart: true,
  },
  privacyConsentRequired: true,
};

const PANEL_HEARTBEAT_INTERVAL_MS = 400;
const REPLAYABLE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const elements = {
  appShell: document.querySelector("#appShell"),
  privacyConsent: document.querySelector("#privacyConsent"),
  consentAcceptButton: document.querySelector("#consentAcceptButton"),
  consentDeclineButton: document.querySelector("#consentDeclineButton"),
  consentDeclinedMessage: document.querySelector("#consentDeclinedMessage"),
  captureButton: document.querySelector("#captureButton"),
  captureLabel: document.querySelector("#captureLabel"),
  clearButton: document.querySelector("#clearButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPopover: document.querySelector("#settingsPopover"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  pageUrl: document.querySelector("#pageUrl"),
  searchInput: document.querySelector("#searchInput"),
  filterTabs: [...document.querySelectorAll(".filter-tab")],
  requestRows: document.querySelector("#requestRows"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyText: document.querySelector("#emptyText"),
  retryButton: document.querySelector("#retryButton"),
  detailHeading: document.querySelector("#detailHeading"),
  detailSelectionMarker: document.querySelector("#detailSelectionMarker"),
  detailSelectionLabel: document.querySelector("#detailSelectionLabel"),
  detailMethod: document.querySelector("#detailMethod"),
  detailPath: document.querySelector("#detailPath"),
  detailStatus: document.querySelector("#detailStatus"),
  detailDuration: document.querySelector("#detailDuration"),
  detailSize: document.querySelector("#detailSize"),
  detailTabs: [...document.querySelectorAll(".detail-tabs [role='tab']")],
  contentFormat: document.querySelector("#contentFormat"),
  detailContent: document.querySelector("#detailContent"),
  copyContentButton: document.querySelector("#copyContentButton"),
  replayButton: document.querySelector("#replayButton"),
  copyCurlButton: document.querySelector("#copyCurlButton"),
  copyRequestButton: document.querySelector("#copyRequestButton"),
  copyResponseButton: document.querySelector("#copyResponseButton"),
  maxRequestsSelect: document.querySelector("#maxRequestsSelect"),
  maxBodySelect: document.querySelector("#maxBodySelect"),
  autoStartInput: document.querySelector("#autoStartInput"),
  replayView: document.querySelector("#replayView"),
  replayBackButton: document.querySelector("#replayBackButton"),
  replaySourcePath: document.querySelector("#replaySourcePath"),
  replayMethod: document.querySelector("#replayMethod"),
  replayUrl: document.querySelector("#replayUrl"),
  replayUrlError: document.querySelector("#replayUrlError"),
  replayTabs: [...document.querySelectorAll("[data-replay-tab]")],
  replayParamsCount: document.querySelector("#replayParamsCount"),
  replayHeadersCount: document.querySelector("#replayHeadersCount"),
  replayResponseTab: document.querySelector("#replayResponseTab"),
  replayErrorSummary: document.querySelector("#replayErrorSummary"),
  replayEditorPanel: document.querySelector("#replayEditorPanel"),
  replayCredentials: document.querySelector("#replayCredentials"),
  replayResetButton: document.querySelector("#replayResetButton"),
  replayCancelButton: document.querySelector("#replayCancelButton"),
  replaySendButton: document.querySelector("#replaySendButton"),
  toast: document.querySelector("#toast"),
  toastText: document.querySelector("#toastText"),
};

let toastTimer = 0;
let searchTimer = 0;
let reconnectTimer = 0;
let panelIsClosing = false;
let lastHeartbeatAt = 0;
const confirmedReplayOrigins = new Set();

void initialize();

async function initialize() {
  bindEvents();
  connectPort();
  startPanelHeartbeat();
  await syncActiveTab();
}

function bindEvents() {
  window.addEventListener("pagehide", notifyPanelClosing);
  window.addEventListener("beforeunload", notifyPanelClosing);
  document.addEventListener("visibilitychange", handlePanelVisibilityChange);

  elements.consentAcceptButton.addEventListener("click", () => {
    if (!Number.isInteger(state.tabId)) return;
    elements.consentAcceptButton.disabled = true;
    elements.consentAcceptButton.textContent = "正在启用…";
    elements.consentDeclinedMessage.classList.add("hidden");
    send({ type: "grant-consent", tabId: state.tabId });
  });
  elements.consentDeclineButton.addEventListener("click", () => {
    elements.consentDeclinedMessage.classList.remove("hidden");
    elements.consentAcceptButton.disabled = false;
    elements.consentAcceptButton.textContent = "同意并开始捕获";
    send({ type: "panel-closing" });
    elements.consentAcceptButton.focus();
  });

  elements.captureButton.addEventListener("click", () => {
    if (state.captureStatus === "error" || state.captureStatus === "detached") {
      send({ type: "retry-attach" });
      return;
    }
    send({ type: "set-capture", enabled: !state.capturing });
  });

  elements.clearButton.addEventListener("click", () => send({ type: "clear" }));
  elements.retryButton.addEventListener("click", () => send({ type: "retry-attach" }));

  elements.settingsButton.addEventListener("click", () => toggleSettings());
  elements.closeSettingsButton.addEventListener("click", () => toggleSettings(false));

  document.addEventListener("pointerdown", (event) => {
    if (elements.settingsPopover.classList.contains("hidden")) return;
    if (elements.settingsPopover.contains(event.target) || elements.settingsButton.contains(event.target)) return;
    toggleSettings(false);
  });

  document.addEventListener("keydown", (event) => {
    if (state.replay.open) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!state.replay.sending) void submitReplay();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeReplay();
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.searchInput.focus();
      elements.searchInput.select();
    }
    if (event.key === "Escape" && !elements.settingsPopover.classList.contains("hidden")) {
      toggleSettings(false);
      elements.settingsButton.focus();
    }
  });

  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = elements.searchInput.value.trim().toLowerCase();
      renderRequestList();
    }, 120);
  });

  elements.filterTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      for (const tab of elements.filterTabs) {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-pressed", String(active));
      }
      renderRequestList();
    });
  });

  elements.detailTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeDetailTab = button.dataset.tab;
      renderDetailTabs();
      renderDetailContent();
    });
  });

  elements.requestRows.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const visible = visibleRequests();
    if (!visible.length) return;
    event.preventDefault();
    const currentIndex = visible.findIndex((request) => request.id === state.selectedId);
    let nextIndex = currentIndex < 0
      ? (event.key === "ArrowUp" || event.key === "End" ? visible.length - 1 : 0)
      : currentIndex;
    if (event.key === "ArrowUp" && currentIndex >= 0) nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "ArrowDown" && currentIndex >= 0) nextIndex = Math.min(visible.length - 1, currentIndex + 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = visible.length - 1;
    selectRequest(visible[nextIndex].id, true);
  });

  elements.copyContentButton.addEventListener("click", () => {
    const content = currentDetailContent();
    if (content.copyValue) void copyText(content.copyValue, `已复制${content.label}`);
  });
  elements.replayButton.addEventListener("click", openReplay);
  elements.copyCurlButton.addEventListener("click", () => {
    if (state.selectedDetail) void copyText(buildCurl(state.selectedDetail), "已复制 cURL 到剪贴板");
  });
  elements.copyRequestButton.addEventListener("click", () => {
    if (state.selectedDetail?.requestBody) void copyText(state.selectedDetail.requestBody, "已复制请求体到剪贴板");
  });
  elements.copyResponseButton.addEventListener("click", () => {
    if (state.selectedDetail?.responseBody) void copyText(state.selectedDetail.responseBody, "已复制响应体到剪贴板");
  });

  elements.replayBackButton.addEventListener("click", () => closeReplay());
  elements.replayTabs.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.replay.activeTab = button.dataset.replayTab;
      renderReplay();
    });
  });
  elements.replayMethod.addEventListener("change", () => {
    if (!state.replay.draft) return;
    state.replay.draft.method = elements.replayMethod.value;
    markReplayDirty();
    renderReplayEditor();
  });
  elements.replayUrl.addEventListener("input", () => {
    if (!state.replay.draft) return;
    state.replay.draft.url = elements.replayUrl.value;
    markReplayDirty();
    clearReplayErrors();
  });
  elements.replayUrl.addEventListener("blur", () => {
    if (!state.replay.draft) return;
    const parsed = parseReplayUrl(state.replay.draft.url);
    if (!parsed) {
      showReplayUrlError("请输入有效的 HTTP 或 HTTPS URL。");
      return;
    }
    state.replay.draft.url = parsed.url;
    state.replay.draft.params = parsed.params;
    elements.replayUrl.value = parsed.url;
    clearReplayErrors();
    renderReplayCounts();
    if (state.replay.activeTab === "params") renderReplayEditor();
  });
  elements.replayCredentials.addEventListener("change", () => {
    if (!state.replay.draft) return;
    state.replay.draft.credentials = elements.replayCredentials.checked;
    markReplayDirty();
  });
  elements.replayResetButton.addEventListener("click", resetReplayDraft);
  elements.replayCancelButton.addEventListener("click", cancelReplayRequest);
  elements.replaySendButton.addEventListener("click", () => void submitReplay());

  const saveSettings = () => {
    send({
      type: "update-settings",
      settings: {
        maxRequests: Number(elements.maxRequestsSelect.value),
        maxBodyBytes: Number(elements.maxBodySelect.value),
        autoStart: elements.autoStartInput.checked,
      },
    });
  };
  elements.maxRequestsSelect.addEventListener("change", saveSettings);
  elements.maxBodySelect.addEventListener("change", saveSettings);
  elements.autoStartInput.addEventListener("change", saveSettings);

  chrome.tabs.onActivated.addListener(() => void syncActiveTab());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== state.tabId || (!changeInfo.url && !changeInfo.title)) return;
    if (changeInfo.url && state.replay.open) closeReplay(true);
    renderPage(tab);
  });
}

function connectPort() {
  window.clearTimeout(reconnectTimer);
  state.port = chrome.runtime.connect({ name: "apiviewer-panel" });
  state.port.onMessage.addListener(handleMessage);
  state.port.onDisconnect.addListener(() => {
    state.port = null;
    if (panelIsClosing) return;
    state.captureStatus = "detached";
    state.connectionError = "后台连接已中断，正在重新连接…";
    if (state.replay.sending) {
      state.replay.sending = false;
      state.replay.result = { ok: false, error: "后台连接已中断，请重新连接后再试。" };
      state.replay.activeTab = "response";
      renderReplay();
    }
    renderStatus();
    reconnectTimer = window.setTimeout(() => {
      connectPort();
      if (state.tabId !== null) send({ type: "init", tabId: state.tabId });
    }, 500);
  });
}

function notifyPanelClosing() {
  if (panelIsClosing) return;
  panelIsClosing = true;
  window.clearTimeout(reconnectTimer);
  send({ type: "panel-closing" });
}

function handlePanelVisibilityChange() {
  if (document.visibilityState === "hidden") {
    notifyPanelClosing();
    return;
  }

  if (!panelIsClosing) return;
  panelIsClosing = false;
  if (!state.port) connectPort();
  void syncActiveTab();
}

function startPanelHeartbeat() {
  const tick = (timestamp) => {
    if (
      document.visibilityState === "visible"
      && timestamp - lastHeartbeatAt >= PANEL_HEARTBEAT_INTERVAL_MS
    ) {
      lastHeartbeatAt = timestamp;
      send({ type: "heartbeat" });
    }
    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
}

async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const changed = state.tabId !== tab.id;
  state.tabId = tab.id;
  renderPage(tab);
  if (changed) {
    closeReplay(true);
    resetRequests();
  }
  send({ type: "init", tabId: tab.id });
}

function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "snapshot") {
    hidePrivacyConsent();
    state.captureStatus = message.status;
    state.capturing = message.capturing;
    state.connectionError = message.error || "";
    state.settings = message.settings || state.settings;
    state.requests.clear();
    state.order = [];
    for (const request of message.requests || []) upsertRequest(request);
    renderPage(message.page);
    renderSettings();
    renderStatus();
    renderRequestList({ followLatest: true });
    if (state.order.length && !state.selectedId) selectRequest(state.order.at(-1));
    return;
  }

  if (message.type === "consent-required") {
    showPrivacyConsent();
  } else if (message.type === "consent-error") {
    showPrivacyConsent(message.error || "无法保存授权状态，请重试。", true);
  } else if (message.type === "status") {
    state.captureStatus = message.status;
    state.capturing = message.capturing;
    state.connectionError = message.error || "";
    renderStatus();
    renderEmptyState(visibleRequests());
    if (state.replay.open) renderReplayActions();
  } else if (message.type === "page") {
    renderPage(message.page);
  } else if (message.type === "request-updated") {
    const isNew = !state.requests.has(message.request.id);
    upsertRequest(message.request);
    renderRequestList({ newRequestId: isNew ? message.request.id : null });
    if (isNew && !state.selectedId) selectRequest(message.request.id);
    if (message.request.id === state.selectedId) send({ type: "get-request", requestId: state.selectedId });
  } else if (message.type === "request-detail") {
    if (!message.request || message.request.id !== state.selectedId) return;
    state.selectedDetail = message.request;
    renderDetail();
  } else if (message.type === "cleared") {
    resetRequests();
  } else if (message.type === "settings") {
    state.settings = message.settings;
    renderSettings();
  } else if (message.type === "replay-result") {
    if (!state.replay.open || message.replayId !== state.replay.replayId) return;
    state.replay.sending = false;
    state.replay.result = message.result || { ok: false, error: "请求没有返回结果。" };
    state.replay.activeTab = "response";
    state.replay.dirty = false;
    renderReplay();
  }
}

function showPrivacyConsent(message = "", isError = false) {
  state.privacyConsentRequired = true;
  elements.appShell.inert = true;
  elements.appShell.setAttribute("aria-hidden", "true");
  elements.privacyConsent.classList.remove("hidden");
  elements.consentAcceptButton.disabled = false;
  elements.consentAcceptButton.textContent = "同意并开始捕获";
  if (message) {
    elements.consentDeclinedMessage.textContent = message;
    elements.consentDeclinedMessage.classList.remove("hidden");
    elements.consentDeclinedMessage.classList.toggle("error", isError);
  }
  elements.consentAcceptButton.focus({ preventScroll: true });
}

function hidePrivacyConsent() {
  state.privacyConsentRequired = false;
  elements.privacyConsent.classList.add("hidden");
  elements.appShell.inert = false;
  elements.appShell.removeAttribute("aria-hidden");
  elements.consentAcceptButton.disabled = false;
  elements.consentAcceptButton.textContent = "同意并开始捕获";
  elements.consentDeclinedMessage.classList.add("hidden");
  elements.searchInput.focus({ preventScroll: true });
}

function send(message) {
  if (!state.port) return;
  try { state.port.postMessage(message); } catch { /* Reconnect handler will recover. */ }
}

function upsertRequest(request) {
  const existing = state.requests.get(request.id);
  state.requests.set(request.id, { ...existing, ...request });
  if (!existing) state.order.push(request.id);
}

function resetRequests() {
  state.requests.clear();
  state.order = [];
  state.selectedId = null;
  state.selectedDetail = null;
  renderRequestList();
  renderDetail();
}

function visibleRequests() {
  return state.order
    .map((id) => state.requests.get(id))
    .filter(Boolean)
    .filter((request) => state.filter === "All" || request.type === state.filter)
    .filter((request) => {
      if (!state.search) return true;
      return `${request.method} ${request.url} ${request.status ?? ""} ${request.type}`.toLowerCase().includes(state.search);
    });
}

function renderRequestList({ newRequestId = null, followLatest = false } = {}) {
  const visible = visibleRequests();
  const fragment = document.createDocumentFragment();
  const previousScrollTop = elements.requestRows.scrollTop;
  const wasNearBottom = elements.requestRows.scrollHeight
    - previousScrollTop
    - elements.requestRows.clientHeight <= 4;
  const revealNewest = followLatest || (
    visible.at(-1)?.id === newRequestId
    && (!document.hasFocus() || wasNearBottom)
  );
  const focusedRequestId = elements.requestRows.contains(document.activeElement)
    ? document.activeElement.dataset.requestId
    : null;

  for (const [index, request] of visible.entries()) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `request-row${request.id === state.selectedId ? " selected" : ""}${request.replayed ? " replayed" : ""}`;
    row.dataset.requestId = request.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(request.id === state.selectedId));
    row.tabIndex = request.id === state.selectedId || (!state.selectedId && request === visible[0]) ? 0 : -1;
    row.title = request.replayed ? `重放请求 · ${request.url}` : request.url;
    row.setAttribute("aria-label", `第 ${index + 1} 项，${requestAriaLabel(request)}`);
    row.addEventListener("click", () => selectRequest(request.id, true));

    const sequence = document.createElement("span");
    sequence.className = "sequence";
    sequence.textContent = String(index + 1);

    const method = document.createElement("span");
    method.className = `method ${methodClass(request.method)}`;
    method.textContent = request.method;

    const path = document.createElement("span");
    path.className = "path";
    path.textContent = displayPath(request.url);

    const status = document.createElement("span");
    status.className = `status-code ${statusClass(request)}`;
    status.textContent = request.failed ? "ERR" : (request.status ?? "…");

    const duration = document.createElement("span");
    duration.className = "duration";
    duration.textContent = formatDuration(request.duration);

    row.append(sequence, method, path, status, duration);
    fragment.append(row);
  }

  elements.requestRows.replaceChildren(fragment);
  elements.requestRows.scrollTop = revealNewest
    ? elements.requestRows.scrollHeight
    : previousScrollTop;
  renderEmptyState(visible);
  if (focusedRequestId) focusRequestRow(focusedRequestId, false);
}

function renderEmptyState(visible) {
  const hasVisibleRows = visible.length > 0;
  elements.emptyState.classList.toggle("hidden", hasVisibleRows);
  if (hasVisibleRows) return;

  const connectionFailed = state.captureStatus === "error" || state.captureStatus === "detached";
  const noSearchResults = state.requests.size > 0 && (state.search || state.filter !== "All");
  elements.retryButton.classList.toggle("hidden", !connectionFailed);

  if (connectionFailed) {
    elements.emptyTitle.textContent = "无法连接当前页面";
    elements.emptyText.textContent = state.connectionError || "请切换到普通网页后重新连接。";
  } else if (noSearchResults) {
    elements.emptyTitle.textContent = "没有匹配的请求";
    elements.emptyText.textContent = "尝试更换关键词或切换请求类型。";
  } else if (!state.capturing) {
    elements.emptyTitle.textContent = "捕获已暂停";
    elements.emptyText.textContent = "点击顶部状态按钮继续捕获 Fetch / XHR 请求。";
  } else {
    elements.emptyTitle.textContent = "等待网络请求";
    elements.emptyText.textContent = "刷新当前页面或进行操作，Fetch / XHR 请求会显示在这里。";
  }
}

function selectRequest(requestId, focus = false) {
  if (!state.requests.has(requestId)) return;
  state.selectedId = requestId;
  state.selectedDetail = null;
  renderRequestList();
  renderDetail();
  send({ type: "get-request", requestId });
  if (focus) focusRequestRow(requestId);
}

function focusRequestRow(requestId, scrollIntoView = true) {
  requestAnimationFrame(() => {
    const row = [...elements.requestRows.children].find((item) => item.dataset.requestId === requestId);
    row?.focus({ preventScroll: true });
    if (scrollIntoView) row?.scrollIntoView({ block: "nearest" });
  });
}

function renderDetail() {
  const summary = state.selectedId ? state.requests.get(state.selectedId) : null;
  const detail = state.selectedDetail;

  elements.detailHeading.classList.toggle("has-selection", Boolean(summary));
  elements.detailSelectionMarker.hidden = !summary;
  elements.detailSelectionLabel.hidden = !summary;

  if (!summary) {
    elements.detailMethod.textContent = "—";
    elements.detailMethod.className = "method-chip";
    elements.detailPath.textContent = "选择一个请求查看详情";
    elements.detailPath.title = "";
    elements.detailStatus.textContent = "—";
    elements.detailStatus.className = "";
    elements.detailDuration.textContent = "—";
    elements.detailSize.textContent = "—";
  } else {
    elements.detailMethod.textContent = summary.method;
    elements.detailMethod.className = `method-chip ${methodClass(summary.method)}`;
    elements.detailPath.textContent = displayPath(summary.url);
    elements.detailPath.title = summary.url;
    elements.detailStatus.textContent = summary.failed
      ? "请求失败"
      : summary.status ? `${summary.status} ${summary.statusText || statusText(summary.status)}`.trim() : "等待响应";
    elements.detailStatus.className = statusClass(summary);
    elements.detailDuration.textContent = formatDuration(summary.duration);
    elements.detailSize.textContent = formatBytes(summary.size);
  }

  elements.copyCurlButton.disabled = !detail;
  elements.replayButton.disabled = !detail || !REPLAYABLE_METHODS.has(String(detail.method || "").toUpperCase());
  elements.copyRequestButton.disabled = !detail?.requestBody;
  elements.copyResponseButton.disabled = !detail?.responseBody;
  renderDetailTabs();
  renderDetailContent();
}

function renderDetailTabs() {
  for (const tab of elements.detailTabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === state.activeDetailTab));
    tab.tabIndex = tab.dataset.tab === state.activeDetailTab ? 0 : -1;
  }
}

function renderDetailContent() {
  const content = currentDetailContent();
  elements.contentFormat.textContent = content.format;
  elements.detailContent.textContent = content.displayValue;
  elements.copyContentButton.disabled = !content.copyValue;
}

function currentDetailContent() {
  const detail = state.selectedDetail;
  if (!state.selectedId) return { format: "详情", label: "内容", displayValue: "从上方列表中选择一个请求。", copyValue: "" };
  if (!detail) return { format: "正在读取", label: "内容", displayValue: "正在读取请求详情…", copyValue: "" };

  if (state.activeDetailTab === "overview") {
    const overview = {
      url: detail.url,
      method: detail.method,
      type: detail.type,
      status: detail.status,
      statusText: detail.statusText || undefined,
      duration: detail.duration === null ? null : `${Math.round(detail.duration)} ms`,
      transferredSize: detail.size === null ? null : formatBytes(detail.size),
      mimeType: detail.mimeType || undefined,
      protocol: detail.protocol || undefined,
      remoteAddress: detail.remoteIPAddress || undefined,
      fromDiskCache: detail.fromDiskCache,
      error: detail.errorText || undefined,
    };
    const value = prettyJson(overview);
    return { format: "概览 · JSON", label: "概览", displayValue: value, copyValue: value };
  }

  if (state.activeDetailTab === "request") {
    if (!detail.requestBody) {
      const message = detail.requestBodyAvailable
        ? "请求体不可用，页面可能在捕获开始前发起了该请求。"
        : "此请求没有请求体。";
      return { format: "请求体", label: "请求体", displayValue: message, copyValue: "" };
    }
    const formatted = prettyBody(detail.requestBody);
    return { format: formatted.format, label: "请求体", displayValue: formatted.value, copyValue: detail.requestBody };
  }

  if (state.activeDetailTab === "response") {
    if (detail.responseBodyBase64) {
      return {
        format: "Base64 · 二进制",
        label: "Base64 响应体",
        displayValue: "此响应为二进制内容。可复制 Base64 数据，但不会在面板中直接渲染。",
        copyValue: detail.responseBody,
      };
    }
    if (detail.responseBodyState === "too-large") {
      return { format: "响应体", label: "响应体", displayValue: "响应体超过设置中的大小上限，未保存在内存中。", copyValue: "" };
    }
    if (detail.responseBodyState === "unavailable") {
      return { format: "响应体", label: "响应体", displayValue: "Chrome 未提供此响应体。缓存、跨进程跳转或流式响应可能导致该情况。", copyValue: "" };
    }
    if (detail.responseBodyState === "pending" || detail.responseBodyState === "loading") {
      return { format: "响应体", label: "响应体", displayValue: "正在等待响应体…", copyValue: "" };
    }
    if (!detail.responseBody) {
      return { format: "响应体", label: "响应体", displayValue: "响应体为空。", copyValue: "" };
    }
    const formatted = prettyBody(detail.responseBody, detail.mimeType);
    return { format: formatted.format, label: "响应体", displayValue: formatted.value, copyValue: detail.responseBody };
  }

  const headers = detail.requestHeaders || {};
  const value = Object.keys(headers).length ? prettyJson(headers) : "没有可用的请求头。";
  return { format: "请求头 · JSON", label: "请求头", displayValue: value, copyValue: Object.keys(headers).length ? value : "" };
}

function openReplay() {
  if (!state.selectedDetail) {
    showToast("请求详情仍在读取，请稍后重试。", true);
    return;
  }
  const method = String(state.selectedDetail.method || "GET").toUpperCase();
  if (!REPLAYABLE_METHODS.has(method)) {
    showToast(`暂不支持重放 ${method} 请求。`, true);
    return;
  }

  state.replay.open = true;
  state.replay.sourceId = state.selectedDetail.id;
  state.replay.original = createReplayDraft(state.selectedDetail);
  state.replay.draft = cloneReplayDraft(state.replay.original);
  state.replay.activeTab = "params";
  state.replay.resultTab = "body";
  state.replay.result = null;
  state.replay.replayId = "";
  state.replay.sending = false;
  state.replay.dirty = false;
  state.replay.showSensitive = false;
  toggleUnderlyingContent(true);
  toggleSettings(false);
  elements.replayView.classList.remove("hidden");
  renderReplay();
  requestAnimationFrame(() => elements.replayUrl.focus());
}

function closeReplay(force = false) {
  if (!state.replay.open) return;
  if (!force && state.replay.sending && !window.confirm("请求仍在发送，确定要取消并返回吗？")) return;
  if (!force && !state.replay.sending && state.replay.dirty && !window.confirm("尚未发送的修改将会丢失，确定返回吗？")) return;
  if (state.replay.sending && state.replay.replayId) {
    send({ type: "cancel-replay", replayId: state.replay.replayId });
  }
  state.replay.open = false;
  state.replay.sending = false;
  state.replay.draft = null;
  state.replay.original = null;
  state.replay.result = null;
  state.replay.replayId = "";
  elements.replayView.classList.add("hidden");
  toggleUnderlyingContent(false);
  if (!force) requestAnimationFrame(() => elements.replayButton.focus());
}

function toggleUnderlyingContent(inert) {
  for (const child of elements.replayView.parentElement.children) {
    if (child === elements.replayView || child === elements.toast) continue;
    child.inert = inert;
  }
}

function createReplayDraft(detail) {
  const headers = Object.entries(detail.requestHeaders || {}).map(([name, value]) => ({
    id: createLocalId(),
    name,
    value: String(value),
    enabled: !isManagedRequestHeader(name),
    managed: isManagedRequestHeader(name),
  }));
  const contentType = headers.find((item) => item.name.toLowerCase() === "content-type")?.value || "";
  const body = detail.requestBody || "";
  const bodyMode = detectBodyMode(body, contentType);
  const editorBody = bodyMode === "json" && body.trim() ? tryFormatJsonText(body) : body;
  const parsedUrl = parseReplayUrl(detail.url);
  return {
    method: String(detail.method || "GET").toUpperCase(),
    url: detail.url,
    params: parsedUrl?.params || [],
    headers,
    body: editorBody,
    bodyMode,
    formFields: bodyMode === "form" ? parseFormFields(body) : [],
    credentials: true,
  };
}

function cloneReplayDraft(draft) {
  return {
    ...draft,
    params: draft.params.map((item) => ({ ...item })),
    headers: draft.headers.map((item) => ({ ...item })),
    formFields: draft.formFields.map((item) => ({ ...item })),
  };
}

function resetReplayDraft() {
  if (!state.replay.original || state.replay.sending) return;
  state.replay.draft = cloneReplayDraft(state.replay.original);
  state.replay.result = null;
  state.replay.activeTab = "params";
  state.replay.resultTab = "body";
  state.replay.dirty = false;
  state.replay.showSensitive = false;
  clearReplayErrors();
  renderReplay();
}

function renderReplay() {
  if (!state.replay.open || !state.replay.draft) return;
  const draft = state.replay.draft;
  elements.replaySourcePath.textContent = displayPath(state.selectedDetail?.url || draft.url);
  elements.replaySourcePath.title = state.selectedDetail?.url || draft.url;
  elements.replayMethod.value = draft.method;
  elements.replayMethod.disabled = state.replay.sending;
  elements.replayUrl.value = draft.url;
  elements.replayUrl.disabled = state.replay.sending;
  elements.replayCredentials.checked = draft.credentials;
  elements.replayCredentials.disabled = state.replay.sending;
  elements.replayResponseTab.disabled = !state.replay.result;

  for (const tab of elements.replayTabs) {
    const active = tab.dataset.replayTab === state.replay.activeTab;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  renderReplayCounts();
  renderReplayEditor();
  renderReplayActions();
}

function renderReplayCounts() {
  const draft = state.replay.draft;
  if (!draft) return;
  elements.replayParamsCount.textContent = String(draft.params.filter((item) => item.enabled).length);
  elements.replayHeadersCount.textContent = String(draft.headers.filter((item) => item.enabled && !item.managed).length);
}

function renderReplayEditor() {
  if (!state.replay.draft) return;
  const tab = state.replay.activeTab;
  elements.replayEditorPanel.classList.toggle("response-mode", tab === "response");
  if (tab === "params") renderPairEditor("params");
  else if (tab === "headers") renderPairEditor("headers");
  else if (tab === "body") renderBodyEditor();
  else renderReplayResponse();
}

function renderPairEditor(kind) {
  const draft = state.replay.draft;
  const isHeaders = kind === "headers";
  const items = isHeaders ? draft.headers : draft.params;
  const section = createElement("section", "editor-section");
  const toolbar = createElement("div", "editor-section-toolbar");
  const heading = createElement("div");
  heading.append(
    createElement("strong", "", isHeaders ? "请求头" : "查询参数"),
    createElement("p", "editor-helper", isHeaders
      ? "浏览器自动管理的请求头仅供参考；敏感值默认隐藏。"
      : "关闭某一行可临时从发送 URL 中移除该参数。"),
  );
  toolbar.append(heading);

  if (isHeaders) {
    const showLabel = createElement("label", "compact-check");
    const showInput = document.createElement("input");
    showInput.type = "checkbox";
    showInput.checked = state.replay.showSensitive;
    showInput.disabled = state.replay.sending;
    showInput.addEventListener("change", () => {
      state.replay.showSensitive = showInput.checked;
      renderReplayEditor();
    });
    showLabel.append(showInput, document.createTextNode("显示敏感值"));
    toolbar.append(showLabel);
  }
  section.append(toolbar);

  const list = createElement("div", "kv-list");
  items.forEach((item, index) => list.append(createPairRow(kind, item, index)));
  if (!items.length) list.append(createElement("p", "empty-editor-note", isHeaders ? "没有可用的请求头。" : "此 URL 没有查询参数。"));
  section.append(list);

  const addButton = createElement("button", "secondary-button add-row-button", isHeaders ? "＋ 添加请求头" : "＋ 添加参数");
  addButton.type = "button";
  addButton.disabled = state.replay.sending;
  addButton.addEventListener("click", () => {
    items.push({ id: createLocalId(), name: "", value: "", enabled: true, managed: false });
    markReplayDirty();
    if (!isHeaders) syncUrlFromParams();
    renderReplay();
    requestAnimationFrame(() => elements.replayEditorPanel.querySelector(".kv-row:last-of-type .kv-input")?.focus());
  });
  section.append(addButton);
  elements.replayEditorPanel.replaceChildren(section);
}

function createPairRow(kind, item, index) {
  const isHeaders = kind === "headers";
  const row = createElement("div", `kv-row${item.enabled ? "" : " is-disabled"}${item.managed ? " is-managed" : ""}`);
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.className = "kv-enabled";
  enabled.checked = item.enabled;
  enabled.disabled = state.replay.sending || item.managed;
  enabled.setAttribute("aria-label", `${item.name || `第 ${index + 1} 行`}是否随请求发送`);
  enabled.addEventListener("change", () => {
    item.enabled = enabled.checked;
    markReplayDirty();
    if (!isHeaders) syncUrlFromParams();
    renderReplay();
  });

  const name = document.createElement("input");
  name.className = "kv-input";
  name.value = item.name;
  name.placeholder = "名称";
  name.autocomplete = "off";
  name.spellcheck = false;
  name.readOnly = item.managed;
  name.disabled = state.replay.sending;
  name.setAttribute("aria-label", `${isHeaders ? "请求头" : "参数"}名称 ${index + 1}`);
  name.addEventListener("input", () => {
    item.name = name.value;
    markReplayDirty();
    if (!isHeaders) syncUrlFromParams();
  });
  if (isHeaders) {
    name.addEventListener("blur", () => {
      const managed = isManagedRequestHeader(item.name);
      if (managed !== item.managed) {
        item.managed = managed;
        if (managed) item.enabled = false;
        renderReplay();
      }
    });
  }

  const value = document.createElement("input");
  value.className = "kv-input";
  value.type = isHeaders && isSensitiveHeader(item.name) && !state.replay.showSensitive ? "password" : "text";
  value.value = item.value;
  value.placeholder = "值";
  value.autocomplete = "off";
  value.spellcheck = false;
  value.readOnly = item.managed;
  value.disabled = state.replay.sending;
  value.setAttribute("aria-label", `${isHeaders ? "请求头" : "参数"}值 ${index + 1}`);
  value.addEventListener("input", () => {
    item.value = value.value;
    markReplayDirty();
    if (!isHeaders) syncUrlFromParams();
  });

  if (item.managed) {
    const managed = createElement("span", "managed-label");
    managed.title = "由浏览器自动管理";
    managed.setAttribute("aria-label", "由浏览器自动管理");
    managed.append(createSvgIcon("lock"));
    row.append(enabled, name, value, managed);
  } else {
    const remove = createElement("button", "mini-icon-button");
    remove.type = "button";
    remove.disabled = state.replay.sending;
    remove.title = "删除此行";
    remove.setAttribute("aria-label", `删除第 ${index + 1} 行`);
    remove.append(createSvgIcon("trash"));
    remove.addEventListener("click", () => {
      const collection = isHeaders ? state.replay.draft.headers : state.replay.draft.params;
      collection.splice(index, 1);
      markReplayDirty();
      if (!isHeaders) syncUrlFromParams();
      renderReplay();
    });
    row.append(enabled, name, value, remove);
  }
  return row;
}

function renderBodyEditor() {
  const draft = state.replay.draft;
  const section = createElement("section", "editor-section");
  const toolbar = createElement("div", "body-toolbar");
  const modeLabel = createElement("label", "body-mode-label", "请求体格式");
  const select = createElement("select", "editor-select");
  for (const [value, label] of [["json", "JSON"], ["form", "Form URL Encoded"], ["raw", "Raw 文本"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = draft.bodyMode === value;
    select.append(option);
  }
  select.disabled = state.replay.sending || ["GET", "HEAD"].includes(draft.method);
  select.addEventListener("change", () => changeBodyMode(select.value));
  modeLabel.append(select);
  toolbar.append(modeLabel);

  if (draft.bodyMode === "json") {
    const formatButton = createElement("button", "secondary-button", "格式化 JSON");
    formatButton.type = "button";
    formatButton.disabled = state.replay.sending || !draft.body.trim() || ["GET", "HEAD"].includes(draft.method);
    formatButton.addEventListener("click", formatReplayJson);
    toolbar.append(formatButton);
  }
  section.append(toolbar);

  if (["GET", "HEAD"].includes(draft.method)) {
    section.append(createElement("p", "editor-helper", `${draft.method} 请求不会发送请求体。切换请求方法后可以继续编辑。`));
  }

  if (draft.bodyMode === "form") {
    const list = createElement("div", "kv-list");
    draft.formFields.forEach((item, index) => list.append(createFormRow(item, index)));
    if (!draft.formFields.length) list.append(createElement("p", "empty-editor-note", "请求体中没有表单字段。"));
    section.append(list);
    const add = createElement("button", "secondary-button add-row-button", "＋ 添加表单字段");
    add.type = "button";
    add.disabled = state.replay.sending || ["GET", "HEAD"].includes(draft.method);
    add.addEventListener("click", () => {
      draft.formFields.push({ id: createLocalId(), name: "", value: "", enabled: true });
      markReplayDirty();
      renderReplayEditor();
    });
    section.append(add);
  } else {
    const textarea = createElement("textarea", "body-textarea");
    textarea.id = "replayBodyInput";
    textarea.value = draft.body;
    textarea.placeholder = draft.bodyMode === "json" ? "输入 JSON 请求体" : "输入原始请求体";
    textarea.spellcheck = false;
    textarea.disabled = state.replay.sending || ["GET", "HEAD"].includes(draft.method);
    textarea.setAttribute("aria-label", "请求体内容");
    textarea.setAttribute("aria-describedby", "replayBodyError");
    textarea.addEventListener("input", () => {
      draft.body = textarea.value;
      markReplayDirty();
      textarea.removeAttribute("aria-invalid");
      section.querySelector(".body-error")?.remove();
    });
    textarea.addEventListener("blur", () => {
      const error = validateReplayBody();
      if (!error) return;
      textarea.setAttribute("aria-invalid", "true");
      const errorElement = createElement("p", "body-error", error);
      errorElement.id = "replayBodyError";
      section.append(errorElement);
    });
    section.append(textarea);
  }
  elements.replayEditorPanel.replaceChildren(section);
}

function createFormRow(item, index) {
  const row = createElement("div", `kv-row${item.enabled ? "" : " is-disabled"}`);
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.className = "kv-enabled";
  enabled.checked = item.enabled;
  enabled.disabled = state.replay.sending;
  enabled.setAttribute("aria-label", `表单字段 ${index + 1} 是否随请求发送`);
  enabled.addEventListener("change", () => { item.enabled = enabled.checked; markReplayDirty(); renderReplayEditor(); });
  const name = createElement("input", "kv-input");
  name.value = item.name;
  name.placeholder = "名称";
  name.disabled = state.replay.sending;
  name.setAttribute("aria-label", `表单字段名称 ${index + 1}`);
  name.addEventListener("input", () => { item.name = name.value; markReplayDirty(); });
  const value = createElement("input", "kv-input");
  value.value = item.value;
  value.placeholder = "值";
  value.disabled = state.replay.sending;
  value.setAttribute("aria-label", `表单字段值 ${index + 1}`);
  value.addEventListener("input", () => { item.value = value.value; markReplayDirty(); });
  const remove = createElement("button", "mini-icon-button");
  remove.type = "button";
  remove.disabled = state.replay.sending;
  remove.title = "删除此行";
  remove.setAttribute("aria-label", `删除第 ${index + 1} 个表单字段`);
  remove.append(createSvgIcon("trash"));
  remove.addEventListener("click", () => { state.replay.draft.formFields.splice(index, 1); markReplayDirty(); renderReplayEditor(); });
  row.append(enabled, name, value, remove);
  return row;
}

function renderReplayResponse() {
  const result = state.replay.result;
  const section = createElement("section", "editor-section response-section");
  if (!result) {
    section.append(createElement("p", "empty-editor-note", state.replay.sending ? "正在等待响应…" : "发送请求后可在这里查看响应。"));
    elements.replayEditorPanel.replaceChildren(section);
    return;
  }
  if (!result.ok) {
    section.append(
      createElement("strong", "", "请求失败"),
      createElement("div", "response-error", result.error || "页面未能完成此请求。"),
      createElement("p", "editor-helper", `耗时 ${formatDuration(result.duration)}`),
    );
    elements.replayEditorPanel.replaceChildren(section);
    return;
  }

  const summary = createElement("div", "response-summary");
  summary.append(
    responseStat("状态", `${result.status} ${result.statusText || ""}`.trim(), statusClass({ status: result.status })),
    responseStat("耗时", formatDuration(result.duration)),
    responseStat("大小", formatBytes(result.size)),
  );
  section.append(summary);
  if (result.redirected) section.append(createElement("p", "editor-helper", `请求发生了重定向，最终 URL：${result.url}`));

  const toolbar = createElement("div", "response-toolbar");
  for (const [value, label] of [["body", "响应体"], ["headers", "响应头"], ["overview", "概览"]]) {
    const button = createElement("button", state.replay.resultTab === value ? "active" : "", label);
    button.type = "button";
    button.addEventListener("click", () => { state.replay.resultTab = value; renderReplayResponse(); });
    toolbar.append(button);
  }
  const copy = createElement("button", "", "复制当前内容");
  copy.type = "button";
  copy.addEventListener("click", () => {
    const content = replayResultContent();
    if (content) void copyText(content, "已复制重放结果");
  });
  toolbar.append(copy);
  section.append(toolbar, createElement("pre", "response-code", replayResultContent()));
  elements.replayEditorPanel.replaceChildren(section);
}

function responseStat(label, value, status = "") {
  const stat = createElement("div", "response-stat");
  stat.append(createElement("span", "", label), createElement("strong", status, value));
  return stat;
}

function replayResultContent() {
  const result = state.replay.result;
  if (!result?.ok) return result?.error || "";
  if (state.replay.resultTab === "headers") {
    return prettyJson(Object.fromEntries(result.headers || []));
  }
  if (state.replay.resultTab === "overview") {
    return prettyJson({
      url: result.url,
      status: result.status,
      statusText: result.statusText,
      duration: `${Math.round(result.duration || 0)} ms`,
      size: formatBytes(result.size),
      contentType: result.contentType || undefined,
      redirected: Boolean(result.redirected),
    });
  }
  if (result.bodyState === "too-large") return "响应体超过设置中的大小上限，未在重放结果中保存。";
  if (result.bodyState === "binary") return "响应为二进制内容，当前版本不直接预览。";
  if (!result.body) return "响应体为空。";
  return prettyBody(result.body, result.contentType).value;
}

function renderReplayActions() {
  const sending = state.replay.sending;
  elements.replayResetButton.disabled = sending;
  elements.replayCancelButton.classList.toggle("hidden", !sending);
  elements.replayCancelButton.disabled = false;
  elements.replayCancelButton.textContent = "取消";
  elements.replaySendButton.disabled = sending || state.captureStatus === "error" || state.captureStatus === "detached";
  elements.replaySendButton.setAttribute("aria-busy", String(sending));
  elements.replaySendButton.querySelector("span").textContent = sending ? "发送中…" : (state.replay.result ? "再次发送" : "发送请求");
}

async function submitReplay() {
  const draft = state.replay.draft;
  if (!draft || state.replay.sending) return;
  draft.method = elements.replayMethod.value;
  draft.url = elements.replayUrl.value.trim();
  draft.credentials = elements.replayCredentials.checked;
  clearReplayErrors();

  const parsed = parseReplayUrl(draft.url);
  const errors = [];
  if (!parsed) errors.push("请输入有效的 HTTP 或 HTTPS URL。");
  const bodyError = validateReplayBody();
  if (bodyError) errors.push(bodyError);
  const headerError = validateReplayHeaders(draft.headers);
  if (headerError) errors.push(headerError);
  if (errors.length) {
    if (!parsed) showReplayUrlError(errors[0]);
    elements.replayErrorSummary.textContent = errors.join(" ");
    elements.replayErrorSummary.classList.remove("hidden");
    elements.replayErrorSummary.focus();
    return;
  }
  draft.url = parsed.url;
  elements.replayUrl.value = parsed.url;

  if (UNSAFE_METHODS.has(draft.method)) {
    const targetUrl = new URL(draft.url);
    const target = targetUrl.host;
    const needsConfirmation = draft.method === "DELETE" || !confirmedReplayOrigins.has(targetUrl.origin);
    const description = draft.method === "DELETE"
      ? `DELETE 请求可能删除数据。确定要向 ${target} 发送吗？`
      : `${draft.method} 请求可能修改网站数据。确定要向 ${target} 发送吗？`;
    if (needsConfirmation && !window.confirm(description)) return;
    if (draft.method !== "DELETE") confirmedReplayOrigins.add(targetUrl.origin);
  }

  state.replay.replayId = createLocalId();
  state.replay.sending = true;
  state.replay.result = null;
  state.replay.activeTab = "response";
  renderReplay();
  send({
    type: "replay-request",
    requestId: state.replay.sourceId,
    replayId: state.replay.replayId,
    request: {
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      body: serializeReplayBody(draft),
      credentials: draft.credentials,
    },
  });
}

function cancelReplayRequest() {
  if (!state.replay.sending || !state.replay.replayId) return;
  elements.replayCancelButton.disabled = true;
  elements.replayCancelButton.textContent = "正在取消…";
  send({ type: "cancel-replay", replayId: state.replay.replayId });
}

function changeBodyMode(nextMode) {
  const draft = state.replay.draft;
  if (!draft || nextMode === draft.bodyMode) return;
  if (draft.bodyMode === "form") draft.body = serializeFormFields(draft.formFields);
  if (nextMode === "form") draft.formFields = parseFormFields(draft.body);
  draft.bodyMode = nextMode;
  if (nextMode === "json") ensureReplayContentType("application/json");
  if (nextMode === "form") ensureReplayContentType("application/x-www-form-urlencoded");
  markReplayDirty();
  clearReplayErrors();
  renderReplayEditor();
}

function ensureReplayContentType(value) {
  const headers = state.replay.draft?.headers;
  if (!headers) return;
  const existing = headers.find((item) => item.name.toLowerCase() === "content-type");
  if (existing) {
    existing.value = value;
    existing.enabled = true;
    existing.managed = false;
  } else {
    headers.push({ id: createLocalId(), name: "Content-Type", value, enabled: true, managed: false });
  }
}

function formatReplayJson() {
  const draft = state.replay.draft;
  if (!draft) return;
  try {
    draft.body = formatJsonText(draft.body);
    markReplayDirty();
    clearReplayErrors();
    renderReplayEditor();
  } catch {
    elements.replayErrorSummary.textContent = "请求体不是有效的 JSON，无法格式化。";
    elements.replayErrorSummary.classList.remove("hidden");
    elements.replayErrorSummary.focus();
  }
}

function validateReplayBody() {
  const draft = state.replay.draft;
  if (!draft || draft.bodyMode !== "json" || !draft.body.trim() || ["GET", "HEAD"].includes(draft.method)) return "";
  try { JSON.parse(draft.body); return ""; } catch (error) { return `JSON 请求体格式错误：${error.message}`; }
}

function validateReplayHeaders(headers) {
  try {
    const candidate = new Headers();
    for (const item of headers) {
      if (!item.enabled || item.managed || !item.name.trim()) continue;
      candidate.append(item.name.trim(), item.value);
    }
    return "";
  } catch (error) {
    return `请求头格式错误：${error.message}`;
  }
}

function serializeReplayBody(draft) {
  if (["GET", "HEAD"].includes(draft.method)) return "";
  return draft.bodyMode === "form" ? serializeFormFields(draft.formFields) : draft.body;
}

function parseReplayUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/^https?:$/.test(url.protocol)) return null;
    return {
      url: url.href,
      params: [...url.searchParams.entries()].map(([name, itemValue]) => ({ id: createLocalId(), name, value: itemValue, enabled: true })),
    };
  } catch {
    return null;
  }
}

function syncUrlFromParams() {
  const draft = state.replay.draft;
  if (!draft) return;
  try {
    const url = new URL(draft.url);
    url.search = "";
    for (const item of draft.params) {
      if (item.enabled) url.searchParams.append(item.name, item.value);
    }
    draft.url = url.href;
    elements.replayUrl.value = draft.url;
    clearReplayErrors();
    renderReplayCounts();
  } catch {
    showReplayUrlError("请先修正 URL，再编辑查询参数。");
  }
}

function parseFormFields(body) {
  return [...new URLSearchParams(body).entries()].map(([name, value]) => ({ id: createLocalId(), name, value, enabled: true }));
}

function serializeFormFields(fields) {
  const params = new URLSearchParams();
  for (const item of fields) if (item.enabled) params.append(item.name, item.value);
  return params.toString();
}

function detectBodyMode(body, contentType) {
  if (/x-www-form-urlencoded/i.test(contentType)) return "form";
  if (/json/i.test(contentType)) return "json";
  if (body.trim()) {
    try { JSON.parse(body); return "json"; } catch { /* Keep raw text as raw. */ }
  }
  return "raw";
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

function isSensitiveHeader(name) {
  return /authorization|cookie|token|api[-_]?key|secret/i.test(String(name || ""));
}

function markReplayDirty() {
  state.replay.dirty = true;
  clearReplayErrors();
  renderReplayCounts();
}

function clearReplayErrors() {
  elements.replayUrl.removeAttribute("aria-invalid");
  elements.replayUrlError.classList.add("hidden");
  elements.replayUrlError.textContent = "";
  elements.replayErrorSummary.classList.add("hidden");
  elements.replayErrorSummary.textContent = "";
}

function showReplayUrlError(message) {
  elements.replayUrl.setAttribute("aria-invalid", "true");
  elements.replayUrlError.textContent = message;
  elements.replayUrlError.classList.remove("hidden");
}

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() || `replay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createSvgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const paths = name === "lock"
    ? ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"]
    : ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 10v6", "M14 10v6"];
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

function renderStatus() {
  const labels = {
    connecting: "连接中",
    capturing: "捕获中",
    paused: "已暂停",
    error: "连接失败",
    detached: "已断开",
  };
  elements.captureLabel.textContent = labels[state.captureStatus] || "连接中";
  elements.captureButton.classList.toggle("paused", state.captureStatus === "paused");
  elements.captureButton.classList.toggle("error", state.captureStatus === "error" || state.captureStatus === "detached");
  elements.captureButton.setAttribute("aria-pressed", String(state.capturing));
  elements.captureButton.title = state.captureStatus === "error" || state.captureStatus === "detached"
    ? "重新连接"
    : state.capturing ? "暂停捕获" : "继续捕获";
}

function renderPage(page) {
  if (!page) return;
  const url = typeof page === "string" ? page : page.url;
  const label = compactUrl(url || "");
  elements.pageUrl.textContent = label || "无法读取当前页面";
  elements.pageUrl.title = url || "";
}

function renderSettings() {
  elements.maxRequestsSelect.value = String(state.settings.maxRequests);
  elements.maxBodySelect.value = String(state.settings.maxBodyBytes);
  elements.autoStartInput.checked = state.settings.autoStart !== false;
}

function toggleSettings(force) {
  const shouldOpen = force ?? elements.settingsPopover.classList.contains("hidden");
  elements.settingsPopover.classList.toggle("hidden", !shouldOpen);
  elements.settingsButton.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) elements.maxRequestsSelect.focus();
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast("复制失败，请在 Chrome 设置中允许剪贴板权限。", true);
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toastText.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function buildCurl(request) {
  const lines = [`curl -X ${shellQuote(request.method)} ${shellQuote(request.url)}`];
  for (const [name, value] of Object.entries(request.requestHeaders || {})) {
    if (name.startsWith(":")) continue;
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (request.requestBody) lines.push(`  --data-raw ${shellQuote(request.requestBody)}`);
  return lines.join(" \\\n");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function prettyBody(value, mimeType = "") {
  const trimmed = String(value).trim();
  try {
    const parsed = JSON.parse(trimmed);
    return { format: "JSON · 格式化", value: JSON.stringify(parsed, null, 2) };
  } catch {
    if (mimeType.includes("html") || /^<!doctype|^<html/i.test(trimmed)) return { format: "HTML · 文本", value: String(value) };
    if (mimeType.includes("xml") || /^<\?xml/i.test(trimmed)) return { format: "XML · 文本", value: String(value) };
    if (mimeType.includes("javascript")) return { format: "JavaScript · 文本", value: String(value) };
    return { format: "文本", value: String(value) };
  }
}

function prettyJson(value) {
  return JSON.stringify(value, (_, item) => item === undefined ? undefined : item, 2);
}

function displayPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url || "—";
  }
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return `${parsed.host}${parsed.pathname}${parsed.search}`;
    return url;
  } catch {
    return url;
  }
}

function methodClass(method = "") {
  return method.toLowerCase().replace(/[^a-z]/g, "");
}

function statusClass(request) {
  if (request.failed || (request.status && request.status >= 500)) return "error";
  if (request.status && request.status >= 400) return "warn";
  if (request.status && request.status < 400) return "ok";
  return "pending";
}

function statusText(status) {
  const common = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 500: "Server Error", 502: "Bad Gateway", 503: "Unavailable" };
  return common[status] || "";
}

function formatDuration(duration) {
  if (!Number.isFinite(duration)) return "—";
  if (duration < 1000) return `${Math.round(duration)} ms`;
  return `${(duration / 1000).toFixed(duration >= 10000 ? 1 : 2)} s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function requestAriaLabel(request) {
  const status = request.failed ? "失败" : request.status ? `状态 ${request.status}` : "等待响应";
  const origin = request.replayed ? "重放请求，" : "";
  return `${origin}${request.method} ${displayPath(request.url)}，${status}，${formatDuration(request.duration)}，${formatBytes(request.size)}`;
}
