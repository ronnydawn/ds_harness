window.__ModuleLoader__.load({
  id: 'deepseek-herness-kanban',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// kanban-en/out/client/src/entry.tsx
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(entry_exports);

// kanban-en/out/client/src/api.ts
var RPC_URL = "/herness-kanban/rpc";
var EVENTS_URL = "/herness-kanban/events";
var snapshot = { boards: [], tasks: [], running: {}, queue: 0 };
var connected = false;
var loading = false;
var error = null;
var listeners = /* @__PURE__ */ new Set();
var toastListeners = /* @__PURE__ */ new Set();
var toasts = [];
var toastSeq = 1;
function emit() {
  for (const fn of listeners) fn();
}
function emitToasts() {
  for (const fn of toastListeners) fn();
}
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getSnapshot() {
  return snapshot;
}
function getLoading() {
  return loading;
}
function getError() {
  return error;
}
function isConnected() {
  return connected;
}
function subscribeToasts(fn) {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}
function getToasts() {
  return toasts;
}
function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}
async function rpc(method, args = {}) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args })
  });
  const body = await res.json();
  if (!body.ok || res.status >= 400) throw new Error(body.error ?? "rpc failed: " + method);
  return body.value;
}
async function refresh() {
  if (loading) return;
  loading = true;
  emit();
  try {
    snapshot = await rpc("state.snapshot");
    error = null;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    loading = false;
    emit();
  }
}
async function call(method, args = {}) {
  const result = await rpc(method, args);
  await refresh();
  return result;
}
function pushToast(kind, title, message) {
  toasts = [...toasts, { id: toastSeq++, kind, title, message }].slice(-5);
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => !toasts.some((x) => x.id === t.id && Date.now() > 0));
  }, 0);
}
var retryTimer = null;
function connectEvents() {
  if (typeof EventSource === "undefined") {
    const timer = setInterval(() => {
      void refresh();
    }, 2e3);
    return () => clearInterval(timer);
  }
  const source = new EventSource(EVENTS_URL);
  source.onopen = () => {
    connected = true;
    emit();
    void refresh();
  };
  source.onmessage = (ev) => {
    let event = null;
    try {
      event = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!event) return;
    switch (event.type) {
      case "board_changed":
        void refresh();
        break;
      case "task_started":
        void refresh();
        break;
      case "task_settled":
        void refresh();
        break;
      case "toast": {
        const payload = event.payload;
        pushToast(payload.kind ?? "info", payload.title ?? "", payload.message ?? "");
        break;
      }
    }
  };
  source.onerror = () => {
    connected = false;
    emit();
    source.close();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connectEvents, 3e3);
  };
  return () => {
    if (retryTimer) clearTimeout(retryTimer);
    source.close();
  };
}
var PRIORITY_BADGE = {
  low: "\u{1F7E2}",
  medium: "\u{1F7E1}",
  high: "\u{1F7E0}",
  critical: "\u{1F534}"
};
var COLUMN_META = {
  todo: { label: "To do", short: "\u{1F4CB}", color: "#94a3b8" },
  doing: { label: "In progress", short: "\u25B6\uFE0F", color: "#3b82f6" },
  review: { label: "In review", short: "\u{1F440}", color: "#f59e0b" },
  done: { label: "Done", short: "\u2705", color: "#22c55e" }
};
function taskBadges(task) {
  const badges = [];
  const last = task.attempts[task.attempts.length - 1];
  if (task.schedule) badges.push("\u23F0");
  if (task.isBlocked) badges.push("\u{1F6AB}");
  if (last?.status === "running") badges.push("\u{1F534}");
  if (last?.status === "pending") badges.push("\u23F3");
  if (task.columnId === "review") badges.push("\u{1F440}");
  if (task.columnId === "done") badges.push("\u2705");
  if (last?.status === "failed" && task.columnId === "todo") badges.push("\u26A0\uFE0F");
  return badges;
}
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(5, 16);
}

// kanban-en/out/client/src/Board.tsx
var import_react = __toESM(require("react"), 1);

// kanban-en/out/client/src/styles.ts
var BOARD_CSS = "/* deepseek-herness-kanban board styles \u2014 injected once at materialization. */\n.hkb-root{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:var(--dsw-specific-conversation-bg,#0f1115);color:var(--dsw-alias-label-primary,#e6e8ec);font-size:14px}\n.hkb-header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-subtle,#262b33);background:var(--dsw-specific-sidebar-fill,#161a21)}\n.hkb-header h1{margin:0;font-size:16px;font-weight:600}\n.hkb-header select,.hkb-header input{background:var(--dsw-alias-interactive-bg,#1c2128);color:inherit;border:1px solid var(--dsw-alias-border-subtle,#2c333d);border-radius:8px;padding:6px 10px;font-size:13px}\n.hkb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-subtle,#2c333d);background:var(--dsw-alias-interactive-bg,#1c2128);color:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}\n.hkb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#232a33)}\n.hkb-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}\n.hkb-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff}\n.hkb-btn.success{background:#16a34a;border-color:#16a34a;color:#fff}\n.hkb-btn:disabled{opacity:.45;cursor:not-allowed}\n.hkb-spacer{flex:1}\n.hkb-body{flex:1;display:flex;gap:12px;padding:12px 16px;overflow-x:auto;overflow-y:hidden;align-items:stretch}\n.hkb-col{display:flex;flex-direction:column;background:var(--dsw-alias-panel-bg,#14181f);border:1px solid var(--dsw-alias-border-subtle,#262b33);border-radius:12px;min-width:280px;max-width:340px;flex:0 0 300px;overflow:hidden}\n.hkb-col.dragover{outline:2px dashed #3b82f6;outline-offset:-2px}\n.hkb-col-head{display:flex;align-items:center;gap:8px;padding:10px 12px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-subtle,#262b33)}\n.hkb-col-dot{width:10px;height:10px;border-radius:50%}\n.hkb-col-count{color:var(--dsw-alias-label-secondary,#8b93a1);font-weight:400;margin-left:auto}\n.hkb-cards{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}\n.hkb-card{background:var(--dsw-alias-panel-bg-l2,#1a2029);border:1px solid var(--dsw-alias-border-subtle,#2c333d);border-radius:10px;padding:10px;cursor:grab;display:flex;flex-direction:column;gap:6px;transition:border-color .12s}\n.hkb-card:hover{border-color:#3b82f6}\n.hkb-card.dragging{opacity:.4}\n.hkb-card-title{font-weight:600;line-height:1.3;word-break:break-word}\n.hkb-card-desc{color:var(--dsw-alias-label-secondary,#8b93a1);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.hkb-card-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#8b93a1);flex-wrap:wrap}\n.hkb-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-subtle,#2c333d);background:var(--dsw-alias-interactive-bg,#1c2128)}\n.hkb-badge.priority{color:#fbbf24}\n.hkb-badge.blocked{color:#f87171}\n.hkb-badge.running{color:#60a5fa}\n.hkb-empty{color:var(--dsw-alias-label-secondary,#8b93a1);font-size:12px;padding:12px;text-align:center}\n.hkb-overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:70;display:flex;align-items:stretch;justify-content:flex-end}\n.hkb-drawer{width:min(680px,100%);background:var(--dsw-specific-conversation-bg,#0f1115);border-left:1px solid var(--dsw-alias-border-subtle,#262b33);display:flex;flex-direction:column;overflow:hidden}\n.hkb-drawer-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-subtle,#262b33)}\n.hkb-drawer-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}\n.hkb-field{display:flex;flex-direction:column;gap:4px}\n.hkb-field label{font-size:12px;color:var(--dsw-alias-label-secondary,#8b93a1)}\n.hkb-field input,.hkb-field textarea,.hkb-field select{background:var(--dsw-alias-interactive-bg,#1c2128);color:inherit;border:1px solid var(--dsw-alias-border-subtle,#2c333d);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit}\n.hkb-field textarea{min-height:90px;resize:vertical}\n.hkb-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-subtle,#262b33);padding:0 16px}\n.hkb-tab{padding:8px 14px;cursor:pointer;border:none;background:none;color:var(--dsw-alias-label-secondary,#8b93a1);font-size:13px;border-bottom:2px solid transparent}\n.hkb-tab.active{color:var(--dsw-alias-label-primary,#e6e8ec);border-bottom-color:#3b82f6}\n.hkb-section-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#8b93a1);margin:0 0 6px}\n.hkb-comment{border:1px solid var(--dsw-alias-border-subtle,#262b33);border-radius:10px;padding:10px;background:var(--dsw-alias-panel-bg,#14181f)}\n.hkb-comment-head{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#8b93a1);margin-bottom:4px}\n.hkb-event{display:flex;gap:8px;font-size:12px;padding:3px 0;color:var(--dsw-alias-label-secondary,#8b93a1)}\n.hkb-event-type{color:var(--dsw-alias-label-primary,#e6e8ec)}\n.hkb-console{background:#0a0c10;border:1px solid var(--dsw-alias-border-subtle,#262b33);border-radius:10px;padding:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}\n.hkb-progress{height:6px;background:var(--dsw-alias-interactive-bg,#1c2128);border-radius:999px;overflow:hidden}\n.hkb-progress>div{height:100%;background:#3b82f6;transition:width .3s}\n.hkb-diff-file{cursor:pointer;padding:5px 10px;border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;display:flex;gap:8px;align-items:center}\n.hkb-diff-file:hover,.hkb-diff-file.active{background:var(--dsw-alias-interactive-bg-hover,#232a33)}\n.hkb-diff-body{background:#0a0c10;border:1px solid var(--dsw-alias-border-subtle,#262b33);border-radius:10px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;max-height:46vh}\n.hkb-diff-line{white-space:pre;padding:0 10px}\n.hkb-diff-line.add{background:rgba(22,163,74,.14);color:#86efac}\n.hkb-diff-line.del{background:rgba(220,38,38,.14);color:#fca5a5}\n.hkb-diff-line.hunk{background:rgba(59,130,246,.1);color:#93c5fd}\n.hkb-diff-line.meta{color:#8b93a1}\n.hkb-toasts{position:fixed;right:16px;bottom:16px;z-index:90;display:flex;flex-direction:column;gap:8px;max-width:380px}\n.hkb-toast{border-radius:10px;padding:10px 14px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);border:1px solid var(--dsw-alias-border-subtle,#2c333d);background:var(--dsw-alias-panel-bg-l2,#1a2029);cursor:pointer}\n.hkb-toast.success{border-left:3px solid #22c55e}\n.hkb-toast.error{border-left:3px solid #ef4444}\n.hkb-toast.info{border-left:3px solid #3b82f6}\n.hkb-toast b{display:block;margin-bottom:2px}\n.hkb-muted{color:var(--dsw-alias-label-secondary,#8b93a1);font-size:12px}\n.hkb-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}\n.hkb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:75;display:flex;align-items:center;justify-content:center}\n.hkb-modal{width:min(560px,92vw);max-height:84vh;overflow-y:auto;background:var(--dsw-specific-conversation-bg,#0f1115);border:1px solid var(--dsw-alias-border-subtle,#2c333d);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px}\n.hkb-modal h3{margin:0;font-size:15px}";

// kanban-en/out/client/src/Board.tsx
var COLUMNS = ["todo", "doing", "review", "done"];
var currentBoardId = null;
var boardListeners = /* @__PURE__ */ new Set();
function getCurrentBoardId() {
  return currentBoardId;
}
function setCurrentBoardId(id) {
  if (currentBoardId === id) return;
  currentBoardId = id;
  for (const fn of boardListeners) fn();
}
function subscribeBoard(fn) {
  boardListeners.add(fn);
  return () => boardListeners.delete(fn);
}
var open = false;
var openListeners = /* @__PURE__ */ new Set();
function isOpen() {
  return open;
}
function setOpen(value) {
  if (open === value) return;
  open = value;
  for (const fn of openListeners) fn();
}
function subscribeOpen(fn) {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
var selectedTaskId = null;
var selectedListeners = /* @__PURE__ */ new Set();
function getSelectedTaskId() {
  return selectedTaskId;
}
function selectTask(id) {
  selectedTaskId = id;
  for (const fn of selectedListeners) fn();
}
function subscribeSelection(fn) {
  selectedListeners.add(fn);
  return () => selectedListeners.delete(fn);
}
function useSnapshot() {
  return (0, import_react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
}
function useOpen() {
  return (0, import_react.useSyncExternalStore)(subscribeOpen, isOpen, isOpen);
}
function useSelected() {
  return (0, import_react.useSyncExternalStore)(subscribeSelection, getSelectedTaskId, getSelectedTaskId);
}
function useToasts() {
  return (0, import_react.useSyncExternalStore)(subscribeToasts, getToasts, getToasts);
}
function useLoading() {
  const [, force] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => subscribe(() => force((n) => n + 1)), []);
  return getLoadingState();
}
function getLoadingState() {
  return getLoading();
}
function useError() {
  const [, force] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => subscribe(() => force((n) => n + 1)), []);
  return getError();
}
function KanbanFooterButton() {
  const openNow = useOpen();
  return import_react.default.createElement("button", {
    className: "hkb-btn",
    title: "Open board",
    onClick: () => setOpen(!openNow)
  }, "\u{1F4CB}", " ", import_react.default.createElement("span", null, "Kanban"));
}
function KanbanOverlay() {
  const openNow = useOpen();
  const snapshot2 = useSnapshot();
  (0, import_react.useEffect)(() => {
    if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css='herness-kanban']")) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "deepseek-herness-kanban";
      tag.dataset.pluginCss = "herness-kanban";
      tag.textContent = BOARD_CSS;
      document.head.appendChild(tag);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    if (openNow) void refresh();
  }, [openNow]);
  if (!openNow) return null;
  return import_react.default.createElement(
    "div",
    { className: "hkb-root" },
    import_react.default.createElement(BoardHeader, { snapshot: snapshot2 }),
    import_react.default.createElement(BoardBody, { snapshot: snapshot2 }),
    import_react.default.createElement(ToastStack, null),
    import_react.default.createElement(TaskDrawerHost, null),
    import_react.default.createElement(DiffHost, null)
  );
}
function BoardHeader({ snapshot: snapshot2 }) {
  const boardId = (0, import_react.useSyncExternalStore)(subscribeBoard, getCurrentBoardId, getCurrentBoardId);
  const [adding, setAdding] = (0, import_react.useState)(false);
  const [deleting, setDeleting] = (0, import_react.useState)(false);
  const error2 = useError();
  const loading2 = useLoading();
  const board = snapshot2.boards.find((b) => b.id === boardId) ?? null;
  (0, import_react.useEffect)(() => {
    if (!boardId && snapshot2.boards[0]) setCurrentBoardId(snapshot2.boards[0].id);
  }, [snapshot2.boards, boardId]);
  const removeBoard = async () => {
    if (!board) return;
    if (!confirm('Delete project "' + board.name + '"?\nAll task cards and run records under this project will be removed permanently.\n(The Git repository itself is kept)')) return;
    setDeleting(true);
    try {
      await call("boards.delete", { boardId: board.id });
      setCurrentBoardId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "hkb-header" },
    import_react.default.createElement("h1", null, "\u{1F4CB} Kanban"),
    import_react.default.createElement(
      "select",
      {
        value: boardId ?? "",
        onChange: (e) => setCurrentBoardId(e.target.value || null)
      },
      snapshot2.boards.length === 0 && import_react.default.createElement("option", { value: "" }, "(No boards)"),
      snapshot2.boards.map((b) => import_react.default.createElement("option", { key: b.id, value: b.id }, b.name))
    ),
    import_react.default.createElement("button", { className: "hkb-btn", onClick: () => setAdding(true) }, "+ Add project"),
    board && import_react.default.createElement("button", { className: "hkb-btn danger", disabled: deleting, onClick: () => void removeBoard() }, deleting ? "Deleting\u2026" : "\u{1F5D1} Delete project"),
    import_react.default.createElement("button", { className: "hkb-btn", onClick: () => void refresh() }, loading2 ? "Refreshing\u2026" : "\u27F3 Refresh"),
    import_react.default.createElement("span", { className: "hkb-muted" }, error2 ?? (isConnected() ? "" : "Not connected")),
    import_react.default.createElement("span", { className: "hkb-spacer" }, null),
    snapshot2.queue > 0 && import_react.default.createElement("span", { className: "hkb-badge" }, "Queued " + snapshot2.queue),
    import_react.default.createElement("button", { className: "hkb-btn", onClick: () => setOpen(false) }, "\u2715 Close"),
    adding && import_react.default.createElement(NewBoardModal, { onClose: () => setAdding(false) })
  );
}
function BoardBody({ snapshot: snapshot2 }) {
  const boardId = (0, import_react.useSyncExternalStore)(subscribeBoard, getCurrentBoardId, getCurrentBoardId);
  const board = snapshot2.boards.find((b) => b.id === boardId) ?? snapshot2.boards[0];
  const [dragTask, setDragTask] = (0, import_react.useState)(null);
  const [overCol, setOverCol] = (0, import_react.useState)(null);
  const [newTask, setNewTask] = (0, import_react.useState)(false);
  if (!board) {
    return import_react.default.createElement(
      "div",
      { className: "hkb-body" },
      import_react.default.createElement("div", { className: "hkb-empty" }, 'No boards yet. Click "+ Add project" and enter a name and a local Git repository path.')
    );
  }
  const tasks = snapshot2.tasks.filter((t) => t.boardId === board.id);
  return import_react.default.createElement(
    "div",
    { className: "hkb-body" },
    COLUMNS.map((col) => {
      const colTasks = tasks.filter((t) => t.columnId === col);
      const running = Object.keys(snapshot2.running).length;
      const meta = COLUMN_META[col];
      return import_react.default.createElement(
        "div",
        {
          key: col,
          className: "hkb-col" + (overCol === col ? " dragover" : ""),
          onDragOver: (e) => {
            e.preventDefault();
            setOverCol(col);
          },
          onDragLeave: () => setOverCol((c) => c === col ? null : c),
          onDrop: (e) => {
            e.preventDefault();
            setOverCol(null);
            const id = dragTask ?? e.dataTransfer.getData("text/plain");
            if (id) {
              const task = tasks.find((t) => t.id === id);
              if (col === "doing") {
                if (!task || task.columnId !== "todo") {
                  alert(task && task.columnId !== "todo" ? "Only todo tasks can be dispatched; current column [" + task.columnId + "]" : "Task not found: " + id);
                } else {
                  void call("exec.dispatch", { taskId: id }).catch((err) => alert(err instanceof Error ? err.message : String(err)));
                }
              } else if (task && task.columnId === "review" && col !== "todo" && col !== "done") {
                alert("A task in review can only be approved and merged, or rejected to todo / rolled back");
              } else if (task && task.columnId === "review") {
                if (col === "done") {
                  alert('Use "\u2705 Approve and merge" to complete a task in review');
                } else {
                  alert('Use "\u21A9 Reject to todo" or "\u23EA Roll back" to return a task in review to todo');
                }
              } else {
                void call("tasks.move", { taskId: id, columnId: col }).catch((err) => alert(err instanceof Error ? err.message : String(err)));
              }
            }
            setDragTask(null);
          }
        },
        import_react.default.createElement(
          "div",
          { className: "hkb-col-head" },
          import_react.default.createElement("span", { className: "hkb-col-dot", style: { background: meta.color } }),
          meta.label,
          import_react.default.createElement("span", { className: "hkb-col-count" }, colTasks.length)
        ),
        import_react.default.createElement(
          "div",
          { className: "hkb-cards" },
          colTasks.map((task) => import_react.default.createElement(CardView, { key: task.id, task, onDrag: setDragTask })),
          colTasks.length === 0 && import_react.default.createElement("div", { className: "hkb-empty" }, "Empty")
        ),
        col === "todo" && import_react.default.createElement("button", { className: "hkb-btn", style: { margin: 8 }, onClick: () => setNewTask(true) }, "+ New task"),
        col === "doing" && running > 0 && import_react.default.createElement("div", { className: "hkb-muted", style: { margin: 8 } }, "Running " + running)
      );
    }),
    newTask && import_react.default.createElement(NewTaskModal, { boardId: board.id, onClose: () => setNewTask(false) })
  );
}
function CardView({ task, onDrag }) {
  const badges = taskBadges(task);
  const last = task.attempts[task.attempts.length - 1];
  return import_react.default.createElement(
    "div",
    {
      className: "hkb-card",
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData("text/plain", task.id);
        onDrag(task.id);
      },
      onDragEnd: () => onDrag(null),
      onClick: () => selectTask(task.id)
    },
    import_react.default.createElement("div", { className: "hkb-card-title" }, badges.join("") + " " + task.title),
    task.description && import_react.default.createElement("div", { className: "hkb-card-desc" }, task.description.slice(0, 140)),
    import_react.default.createElement(
      "div",
      { className: "hkb-card-meta" },
      import_react.default.createElement("span", { className: "hkb-badge priority" }, PRIORITY_BADGE[task.priority] + " " + task.priority),
      task.assignee && import_react.default.createElement("span", { className: "hkb-badge" }, "\u{1F464} " + task.assignee),
      task.schedule && import_react.default.createElement("span", { className: "hkb-badge" }, "\u23F0 " + (task.schedule.type === "interval" ? task.schedule.interval + "min" : task.schedule.dailyTime)),
      task.sessionId && import_react.default.createElement("span", { className: "hkb-badge", title: "session " + task.sessionId }, "\u{1F4AC}"),
      import_react.default.createElement("span", { className: "hkb-spacer" }, null),
      task.id.slice(0, 12)
    ),
    last && last.status === "running" && import_react.default.createElement(
      "div",
      { className: "hkb-progress" },
      import_react.default.createElement("div", { style: { width: (last.progress ?? 0) + "%" } })
    ),
    last && (last.status === "failed" || last.status === "success") && import_react.default.createElement(
      "div",
      { className: "hkb-muted" },
      (last.status === "failed" ? "\u26A0 " : "\u2713 ") + (last.error ?? last.diffSummary ?? last.resultSummary ?? "").slice(0, 80)
    )
  );
}
function NewTaskModal({ boardId, onClose }) {
  const [title, setTitle] = (0, import_react.useState)("");
  const [description, setDescription] = (0, import_react.useState)("");
  const [priority, setPriority] = (0, import_react.useState)("medium");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await call("tasks.create", { boardId, title: title.trim(), description, priority });
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "hkb-modal-bg", onClick: onClose },
    import_react.default.createElement(
      "div",
      { className: "hkb-modal", onClick: (e) => e.stopPropagation() },
      import_react.default.createElement("h3", null, "New task"),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Title"),
        import_react.default.createElement("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: "What needs to be done?", autoFocus: true, onKeyDown: (e) => e.key === "Enter" && void submit() })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Description (Markdown)"),
        import_react.default.createElement("textarea", { value: description, onChange: (e) => setDescription(e.target.value), placeholder: "Goal, acceptance criteria, context\u2026" })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Priority"),
        import_react.default.createElement(
          "select",
          { value: priority, onChange: (e) => setPriority(e.target.value) },
          ["low", "medium", "high", "critical"].map((p) => import_react.default.createElement("option", { key: p, value: p }, PRIORITY_BADGE[p] + " " + p))
        )
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-row" },
        import_react.default.createElement("button", { className: "hkb-btn primary", disabled: busy || !title.trim(), onClick: () => void submit() }, busy ? "Creating\u2026" : "Create"),
        import_react.default.createElement("button", { className: "hkb-btn", onClick: onClose }, "Cancel")
      )
    )
  );
}
function NewBoardModal({ onClose }) {
  const [name, setName] = (0, import_react.useState)("");
  const [repoPath, setRepoPath] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const submit = async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setBusy(true);
    try {
      await call("boards.create", { name: name.trim(), repoPath: repoPath.trim() });
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "hkb-modal-bg", onClick: onClose },
    import_react.default.createElement(
      "div",
      { className: "hkb-modal", onClick: (e) => e.stopPropagation() },
      import_react.default.createElement("h3", null, "Add project"),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Name"),
        import_react.default.createElement("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "e.g. my-project", autoFocus: true })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Local Git repository path"),
        import_react.default.createElement("input", { value: repoPath, onChange: (e) => setRepoPath(e.target.value), placeholder: "/absolute/path/to/repo" }),
        import_react.default.createElement("span", { className: "hkb-muted" }, "Runs git init automatically when missing; when present, the main branch is detected automatically.")
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-row" },
        import_react.default.createElement("button", { className: "hkb-btn primary", disabled: busy || !name.trim() || !repoPath.trim(), onClick: () => void submit() }, busy ? "Creating\u2026" : "Create board"),
        import_react.default.createElement("button", { className: "hkb-btn", onClick: onClose }, "Cancel")
      )
    )
  );
}
function TaskDrawerHost() {
  const selected = useSelected();
  const snapshot2 = useSnapshot();
  const task = selected ? snapshot2.tasks.find((t) => t.id === selected) : null;
  if (!selected) return null;
  if (!task) {
    selectTask(null);
    return null;
  }
  return import_react.default.createElement(TaskDrawer, { key: task.id, task });
}
function TaskDrawer({ task }) {
  const [tab, setTab] = (0, import_react.useState)("detail");
  const [title, setTitle] = (0, import_react.useState)(task.title);
  const [description, setDescription] = (0, import_react.useState)(task.description);
  const [comment, setComment] = (0, import_react.useState)("");
  const [blockReason, setBlockReason] = (0, import_react.useState)(task.blockReason ?? "");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [rejecting, setRejecting] = (0, import_react.useState)(null);
  const [appending, setAppending] = (0, import_react.useState)(false);
  const [catalog, setCatalog] = (0, import_react.useState)(null);
  const [provider, setProvider] = (0, import_react.useState)("");
  const [model, setModel] = (0, import_react.useState)("");
  const [reasoningEffort, setReasoningEffort] = (0, import_react.useState)("");
  const [catalogError, setCatalogError] = (0, import_react.useState)(null);
  const last = task.attempts[task.attempts.length - 1];
  const running = last && (last.status === "running" || last.status === "pending");
  (0, import_react.useEffect)(() => {
    setTitle(task.title);
    setDescription(task.description);
    setBlockReason(task.blockReason ?? "");
  }, [task.id, task.title, task.description, task.blockReason]);
  (0, import_react.useEffect)(() => {
    let alive = true;
    rpc("dispatch.catalog").then((catalog2) => {
      if (!alive) return;
      setCatalog(catalog2);
      const d = catalog2.defaults;
      const nextProvider = d.provider ?? catalog2.providers[0]?.id ?? "";
      const providerObj2 = catalog2.providers.find((p) => p.id === nextProvider);
      const nextModel = d.model ?? providerObj2?.models[0]?.id ?? "";
      const modelObj2 = providerObj2?.models.find((m) => m.id === nextModel);
      setProvider(nextProvider);
      setModel(nextModel);
      setReasoningEffort(d.reasoningEffort ?? modelObj2?.defaultEffort ?? modelObj2?.reasoningEfforts?.[0]?.id ?? "");
      setCatalogError(null);
    }).catch((err) => setCatalogError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await call("tasks.update", { taskId: task.id, title, description });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const postComment = async () => {
    if (!comment.trim()) return;
    await call("tasks.comment", { taskId: task.id, content: comment.trim(), author: "user" });
    setComment("");
  };
  const remove = async () => {
    if (!confirm("Delete task " + task.title + "?")) return;
    await call("tasks.delete", { taskId: task.id });
    selectTask(null);
  };
  const [discussing, setDiscussing] = (0, import_react.useState)(false);
  const [discussion, setDiscussion] = (0, import_react.useState)(null);
  const startDiscussion = async () => {
    setDiscussing(true);
    try {
      const result = await rpc("task.discuss", { taskId: task.id });
      setDiscussion(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscussing(false);
    }
  };
  const discussionSessions = task.events.filter((ev) => ev.type === "discussion_started").map((ev) => String(ev.data?.sessionId ?? "")).filter(Boolean);
  const providerObj = catalog?.providers.find((p) => p.id === provider);
  const modelObj = providerObj?.models.find((m) => m.id === model);
  const efforts = modelObj?.reasoningEfforts ?? [];
  const changeModel = (nextModel) => {
    setModel(nextModel);
    const nextModelObj = providerObj?.models.find((m) => m.id === nextModel);
    setReasoningEffort(nextModelObj?.defaultEffort ?? nextModelObj?.reasoningEfforts?.[0]?.id ?? "");
  };
  const dispatch = async () => {
    setBusy(true);
    const runner = {
      mode: "api",
      ...provider ? { provider } : {},
      ...model ? { model } : {},
      ...reasoningEffort ? { reasoningEffort } : {}
    };
    try {
      await call("exec.dispatch", { taskId: task.id, runner });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const TABS = [
    ["detail", "Details"],
    ["diff", "\u{1F4C4} Diff review"],
    ["comments", "Comments (" + task.comments.length + ")"],
    ["events", "Timeline"],
    ["runs", "Runs (" + task.attempts.length + ")"]
  ];
  return import_react.default.createElement(
    "div",
    { className: "hkb-overlay-bg", onClick: () => selectTask(null) },
    import_react.default.createElement(
      "div",
      { className: "hkb-drawer", onClick: (e) => e.stopPropagation() },
      import_react.default.createElement(
        "div",
        { className: "hkb-drawer-head" },
        import_react.default.createElement("span", null, PRIORITY_BADGE[task.priority]),
        import_react.default.createElement(
          "div",
          { style: { flex: 1, minWidth: 0 } },
          import_react.default.createElement("div", { className: "hkb-muted" }, task.id),
          import_react.default.createElement("b", null, task.title)
        ),
        import_react.default.createElement("button", { className: "hkb-btn", onClick: () => selectTask(null) }, "\u2715")
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-tabs" },
        TABS.map(([key, label]) => import_react.default.createElement("button", { key, className: "hkb-tab" + (tab === key ? " active" : ""), onClick: () => setTab(key) }, label))
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-drawer-body" },
        tab === "detail" && import_react.default.createElement(
          import_react.default.Fragment,
          null,
          import_react.default.createElement(
            "div",
            { className: "hkb-row" },
            running && import_react.default.createElement("button", { className: "hkb-btn danger", onClick: () => void call("exec.stop", { taskId: task.id }) }, "\u23F9 Stop run"),
            // Req 2: only todo cards can be dispatched.
            task.columnId === "todo" && !running && import_react.default.createElement("button", { className: "hkb-btn primary", disabled: busy || !provider || !model, onClick: () => void dispatch() }, busy ? "Dispatching\u2026" : "\u25B6 Dispatch (API)"),
            task.columnId === "review" && import_react.default.createElement("button", { className: "hkb-btn success", onClick: () => void call("review.merge", { taskId: task.id, author: "user" }) }, "\u2705 Approve and merge"),
            task.columnId === "review" && import_react.default.createElement("button", { className: "hkb-btn danger", title: "Reject to todo, keeping the merged code on main; add details and dispatch again later", onClick: () => setRejecting("reject") }, "\u21A9 Reject to todo"),
            task.columnId === "review" && import_react.default.createElement("button", { className: "hkb-btn danger", title: "Undo the merge commit on main and return the task to todo", onClick: () => setRejecting("rollback") }, "\u23EA Roll back"),
            import_react.default.createElement("button", { className: "hkb-btn", onClick: () => setAppending(true) }, "\u270F\uFE0F Add details"),
            import_react.default.createElement("button", { className: "hkb-btn", onClick: () => void remove() }, "\u{1F5D1} Delete"),
            import_react.default.createElement("span", { className: "hkb-spacer" }, null)
          ),
          // Req 3: refine requirements in a task-scoped conversation (todo stage).
          task.columnId === "todo" && !running && import_react.default.createElement(
            "div",
            { className: "hkb-row" },
            import_react.default.createElement("button", { className: "hkb-btn", disabled: discussing, onClick: () => void startDiscussion() }, discussing ? "Starting\u2026" : "\u{1F4AC} Refine requirements (task chat)"),
            (discussion || discussionSessions.length > 0) && import_react.default.createElement(
              "span",
              { className: "hkb-muted", style: { fontSize: 12 } },
              (discussion ? "Created session " + discussion.sessionId : "") + (discussion ? "; " : "") + (discussionSessions.length > 0 ? "Session history: " + discussionSessions.join(", ") : "") + " \u2014 Find this session in the workspace on the left to continue the conversation; its context contains only this task"
            )
          ),
          rejecting && import_react.default.createElement(RejectPanel, { task, mode: rejecting, onClose: () => setRejecting(null) }),
          appending && import_react.default.createElement(AppendDetailModal, { task, onClose: () => setAppending(false) }),
          task.columnId === "todo" && import_react.default.createElement(
            import_react.default.Fragment,
            null,
            import_react.default.createElement(
              "div",
              { className: "hkb-field" },
              import_react.default.createElement("label", null, "Mode"),
              import_react.default.createElement(
                "select",
                { value: "api", disabled: true },
                import_react.default.createElement("option", { value: "api" }, "API")
              )
            ),
            catalogError && import_react.default.createElement("div", { className: "hkb-muted", style: { color: "#f87171" } }, catalogError),
            import_react.default.createElement(
              "div",
              { className: "hkb-field" },
              import_react.default.createElement("label", null, "Model"),
              import_react.default.createElement(
                "select",
                {
                  value: model,
                  onChange: (e) => changeModel(e.target.value)
                },
                (providerObj?.models ?? []).map((m) => import_react.default.createElement("option", { key: m.id, value: m.id }, m.name)),
                (providerObj?.models ?? []).length === 0 && import_react.default.createElement("option", { value: "" }, "(No models available)")
              )
            ),
            import_react.default.createElement(
              "div",
              { className: "hkb-field" },
              import_react.default.createElement("label", null, "Reasoning effort"),
              import_react.default.createElement(
                "select",
                {
                  value: reasoningEffort,
                  onChange: (e) => setReasoningEffort(e.target.value)
                },
                efforts.map((e) => import_react.default.createElement("option", { key: e.id, value: e.id }, e.name)),
                efforts.length === 0 && import_react.default.createElement("option", { value: "" }, "(Follow model default)")
              )
            )
          ),
          import_react.default.createElement(
            "div",
            { className: "hkb-field" },
            import_react.default.createElement("label", null, "Title"),
            import_react.default.createElement("input", { value: title, onChange: (e) => setTitle(e.target.value) })
          ),
          import_react.default.createElement(
            "div",
            { className: "hkb-field" },
            import_react.default.createElement("label", null, "Description (Markdown; accumulates context over time)"),
            import_react.default.createElement("textarea", { value: description, onChange: (e) => setDescription(e.target.value), style: { minHeight: 140 } })
          ),
          import_react.default.createElement(
            "div",
            { className: "hkb-row" },
            import_react.default.createElement("button", { className: "hkb-btn primary", disabled: busy, onClick: () => void save() }, "Save"),
            import_react.default.createElement(
              "label",
              { className: "hkb-badge" },
              import_react.default.createElement("input", { type: "checkbox", checked: !!task.isBlocked, onChange: (e) => void call("tasks.update", { taskId: task.id, isBlocked: e.target.checked, blockReason: e.target.checked ? blockReason : void 0 }) }),
              " \u{1F6AB} Blocked"
            )
          ),
          task.isBlocked && import_react.default.createElement("input", { value: blockReason, placeholder: "Blocked reason", onChange: (e) => setBlockReason(e.target.value), onBlur: () => void call("tasks.update", { taskId: task.id, blockReason }) }),
          task.sessionId && import_react.default.createElement("div", { className: "hkb-muted" }, "Source session: " + task.sessionId + (task.threadId ? " \xB7 Thread: " + task.threadId : ""))
        ),
        tab === "diff" && import_react.default.createElement(DiffPanel, { task }),
        tab === "comments" && import_react.default.createElement(
          import_react.default.Fragment,
          null,
          import_react.default.createElement(
            "div",
            { className: "hkb-row" },
            import_react.default.createElement("input", { style: { flex: 1 }, value: comment, placeholder: "Write discussion, decisions, or review notes\u2026", onChange: (e) => setComment(e.target.value), onKeyDown: (e) => e.key === "Enter" && void postComment() }),
            import_react.default.createElement("button", { className: "hkb-btn primary", onClick: () => void postComment() }, "Comment")
          ),
          task.comments.slice().reverse().map((c) => import_react.default.createElement(
            "div",
            { key: c.id, className: "hkb-comment" },
            import_react.default.createElement(
              "div",
              { className: "hkb-comment-head" },
              import_react.default.createElement("b", null, c.author),
              import_react.default.createElement("span", null, fmtTime(c.createdAt)),
              c.filePath && import_react.default.createElement("span", null, c.filePath + (c.lineNumber ? ":" + c.lineNumber : ""))
            ),
            import_react.default.createElement("div", null, c.content)
          )),
          task.comments.length === 0 && import_react.default.createElement("div", { className: "hkb-empty" }, "No comments yet")
        ),
        tab === "events" && import_react.default.createElement(
          "div",
          null,
          task.events.slice().reverse().map((ev) => import_react.default.createElement(
            "div",
            { key: ev.id, className: "hkb-event" },
            import_react.default.createElement("span", { className: "hkb-event-type" }, ev.type),
            import_react.default.createElement("span", null, fmtTime(ev.timestamp)),
            import_react.default.createElement("span", null, summarizeEventData(ev.data))
          )),
          task.events.length === 0 && import_react.default.createElement("div", { className: "hkb-empty" }, "No events yet")
        ),
        tab === "runs" && import_react.default.createElement(RunsPanel, { task })
      )
    )
  );
}
function summarizeEventData(data) {
  const interesting = [];
  for (const key of ["from", "to", "summary", "error", "commit", "branch", "actor", "author", "reason"]) {
    const value = data[key];
    if (typeof value === "string" && value) interesting.push(key + "=" + value.slice(0, 60));
  }
  return interesting.join(" ");
}
function RejectPanel({ task, mode, onClose }) {
  const [reason, setReason] = (0, import_react.useState)("");
  const [extra, setExtra] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (extra.trim()) {
        await call("tasks.appendDetail", { taskId: task.id, content: extra.trim(), author: "user" });
      }
      if (mode === "rollback") {
        await call("review.revert", { taskId: task.id, reason: reason.trim() || "No reason given", author: "user" });
      } else {
        await call("review.reject", { taskId: task.id, reason: reason.trim() || "No reason given", author: "user" });
      }
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const rollback = mode === "rollback";
  return import_react.default.createElement(
    "div",
    { className: "hkb-modal-bg", onClick: onClose },
    import_react.default.createElement(
      "div",
      { className: "hkb-modal", onClick: (e) => e.stopPropagation() },
      import_react.default.createElement("h3", null, rollback ? "Roll back to todo" : "Reject to todo"),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Review notes (recorded on the card)"),
        import_react.default.createElement("textarea", { value: reason, onChange: (e) => setReason(e.target.value), autoFocus: true })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "New requirements (optional, appended directly to the card description)"),
        import_react.default.createElement("textarea", { value: extra, onChange: (e) => setExtra(e.target.value), placeholder: "e.g. also support scenario X\u2026" })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-row" },
        import_react.default.createElement("button", { className: "hkb-btn danger", disabled: busy, onClick: () => void submit() }, busy ? rollback ? "Rolling back\u2026" : "Processing\u2026" : rollback ? "\u23EA Confirm roll back" : "\u21A9 Confirm reject"),
        import_react.default.createElement("button", { className: "hkb-btn", onClick: onClose }, "Cancel")
      )
    )
  );
}
function AppendDetailModal({ task, onClose }) {
  const [content, setContent] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await call("tasks.appendDetail", { taskId: task.id, content: content.trim(), author: "user" });
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "hkb-modal-bg", onClick: onClose },
    import_react.default.createElement(
      "div",
      { className: "hkb-modal", onClick: (e) => e.stopPropagation() },
      import_react.default.createElement("h3", null, "\u270F\uFE0F Add details"),
      import_react.default.createElement(
        "div",
        { className: "hkb-field" },
        import_react.default.createElement("label", null, "Content to add (Markdown; appended to the card description without overwriting existing content)"),
        import_react.default.createElement("textarea", { value: content, onChange: (e) => setContent(e.target.value), autoFocus: true, style: { minHeight: 120 }, placeholder: "e.g. extra acceptance criteria, new requirement details\u2026" })
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-row" },
        import_react.default.createElement("button", { className: "hkb-btn primary", disabled: busy || !content.trim(), onClick: () => void submit() }, busy ? "Appending\u2026" : "Append to description"),
        import_react.default.createElement("button", { className: "hkb-btn", onClick: onClose }, "Cancel")
      )
    )
  );
}
function RunsPanel({ task }) {
  return import_react.default.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 10 } },
    task.attempts.slice().reverse().map((attempt) => import_react.default.createElement(
      "div",
      { key: attempt.id, className: "hkb-comment" },
      import_react.default.createElement(
        "div",
        { className: "hkb-comment-head" },
        import_react.default.createElement("b", null, attempt.status),
        import_react.default.createElement("span", null, fmtTime(attempt.startedAt)),
        attempt.branchName && import_react.default.createElement("span", null, "\u{1F33F} " + attempt.branchName),
        attempt.worktreePath && import_react.default.createElement("span", null, attempt.worktreePath)
      ),
      attempt.status === "running" && import_react.default.createElement(
        "div",
        { className: "hkb-progress" },
        import_react.default.createElement("div", { style: { width: (attempt.progress ?? 0) + "%" } })
      ),
      attempt.error && import_react.default.createElement("div", { className: "hkb-muted" }, "\u26A0 " + attempt.error),
      attempt.diffSummary && import_react.default.createElement("div", { className: "hkb-muted" }, "Changes: " + attempt.diffSummary),
      attempt.progressLogs.length > 0 && import_react.default.createElement("div", { className: "hkb-console" }, attempt.progressLogs.slice(-50).join("\n"))
    )),
    task.attempts.length === 0 && import_react.default.createElement("div", { className: "hkb-empty" }, "No runs yet")
  );
}
function DiffHost() {
  return null;
}
function DiffPanel({ task }) {
  const [summary, setSummary] = (0, import_react.useState)(null);
  const [active, setActive] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(true);
  const [error2, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const diff = await rpc("review.diff", { taskId: task.id });
        if (!cancelled) {
          setSummary(diff);
          setActive(diff.files[0]?.path ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id]);
  if (busy) return import_react.default.createElement("div", { className: "hkb-empty" }, "Generating diff\u2026");
  if (error2) return import_react.default.createElement("div", { className: "hkb-empty" }, "\u26A0 " + error2);
  if (!summary || summary.files.length === 0) return import_react.default.createElement("div", { className: "hkb-empty" }, "No code changes.");
  const file = summary.files.find((f) => f.path === active) ?? summary.files[0];
  return import_react.default.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 10 } },
    import_react.default.createElement(
      "div",
      { className: "hkb-row" },
      import_react.default.createElement("span", { className: "hkb-badge" }, summary.filesChanged + " files"),
      import_react.default.createElement("span", { className: "hkb-badge", style: { color: "#86efac" } }, "+" + summary.additions),
      import_react.default.createElement("span", { className: "hkb-badge", style: { color: "#fca5a5" } }, "-" + summary.deletions),
      import_react.default.createElement("span", { className: "hkb-spacer" }, null),
      import_react.default.createElement("button", { className: "hkb-btn success", onClick: () => void call("review.merge", { taskId: task.id, author: "user" }) }, "\u2705 Approve and merge"),
      import_react.default.createElement("button", { className: "hkb-btn danger", title: "Reject to todo, keeping the merged code on main", onClick: () => {
        const reason = prompt("Rejection reason (reject to todo, no code rollback):");
        if (reason !== null) void call("review.reject", { taskId: task.id, reason, author: "user" });
      } }, "\u21A9 Reject to todo"),
      import_react.default.createElement("button", { className: "hkb-btn danger", title: "Undo the merge commit on main and return the task to todo", onClick: () => {
        const reason = prompt("Rollback reason (undo the merge and return to todo):");
        if (reason !== null) void call("review.revert", { taskId: task.id, reason, author: "user" });
      } }, "\u23EA Roll back")
    ),
    import_react.default.createElement(
      "div",
      { style: { display: "flex", gap: 10, minHeight: 0 } },
      import_react.default.createElement(
        "div",
        { style: { width: 230, flexShrink: 0, maxHeight: 46 * 6, overflowY: "auto" } },
        summary.files.map((f) => import_react.default.createElement(
          "div",
          { key: f.path, className: "hkb-diff-file" + (f.path === file.path ? " active" : ""), onClick: () => setActive(f.path) },
          import_react.default.createElement("span", null, f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : f.kind === "renamed" ? "R" : "M"),
          import_react.default.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.path)
        ))
      ),
      import_react.default.createElement(
        "div",
        { className: "hkb-diff-body", style: { flex: 1 } },
        renderDiffLines(file.diff).map((line, index) => import_react.default.createElement("div", { key: index, className: "hkb-diff-line " + line.kind }, line.text || " "))
      )
    ),
    import_react.default.createElement("div", { className: "hkb-muted" }, "Double-click any code line to add a line-level review comment for that file (CR-05)")
  );
}
function renderDiffLines(diff) {
  return diff.split("\n").map((line) => {
    let kind = "plain";
    if (line.startsWith("+++") || line.startsWith("---")) kind = "meta";
    else if (line.startsWith("@@")) kind = "hunk";
    else if (line.startsWith("+")) kind = "add";
    else if (line.startsWith("-")) kind = "del";
    else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity") || line.startsWith("rename")) kind = "meta";
    return { kind, text: line };
  });
}
function ToastStack() {
  const toasts2 = useToasts();
  return import_react.default.createElement(
    "div",
    { className: "hkb-toasts" },
    toasts2.map((t) => import_react.default.createElement(
      "div",
      { key: t.id, className: "hkb-toast " + t.kind, onClick: () => dismissToast(t.id) },
      import_react.default.createElement("b", null, t.title),
      import_react.default.createElement("div", null, t.message)
    ))
  );
}

// kanban-en/out/client/src/entry.tsx
var inject = ["slots", "locale"];
var NS = "herness-kanban";
var dict = {
  en: { "board.toggle": "Kanban", "board.title": "Kanban Board" },
  zh: { "board.toggle": "Kanban", "board.title": "Kanban Board" }
};
function apply(ctx) {
  ctx.effect(() => connectEvents(), "herness-kanban: events");
  ctx.effect(() => ctx.locale?.register(NS, dict) ?? (() => {
  }), "herness-kanban: locale");
  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: NS,
    locale: NS,
    inject: () => ({})
  }, KanbanOverlay)), "herness-kanban: overlay registration");
  ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: NS,
    locale: NS,
    inject: () => ({})
  }, KanbanFooterButton)), "herness-kanban: footer toggle registration");
}
    return module.exports;
  }
});
