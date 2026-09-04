/* global window */

(function attachUndoRuntimeModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityUndoRuntimeModule requires dependency: ${name}`);
    }
  }

  function createUndoRuntimeModule(deps = {}) {
    const {
      UNDO_HISTORY_LIMIT = 60,
      UNDO_MERGE_WINDOW_MS = 320,
      getEntries,
      setEntries,
      getTodos,
      setTodos,
      getSelectedTodoId,
      setSelectedTodoId,
      normalizeTodo,
      saveEntries,
      saveTodos,
      cancelPendingAutoSync,
      isSyncRunning,
      setCalendarSyncStatus,
      clearTodoDetailSubmitState,
      render,
    } = deps;

    [
      ["getEntries", getEntries],
      ["setEntries", setEntries],
      ["getTodos", getTodos],
      ["setTodos", setTodos],
      ["getSelectedTodoId", getSelectedTodoId],
      ["setSelectedTodoId", setSelectedTodoId],
      ["normalizeTodo", normalizeTodo],
      ["saveEntries", saveEntries],
      ["saveTodos", saveTodos],
      ["cancelPendingAutoSync", cancelPendingAutoSync],
      ["isSyncRunning", isSyncRunning],
      ["setCalendarSyncStatus", setCalendarSyncStatus],
      ["clearTodoDetailSubmitState", clearTodoDetailSubmitState],
      ["render", render],
    ].forEach(([name, value]) => assertFunction(name, value));

    let entries = [];
    let todos = [];
    let undoHistoryReady = false;
    let undoHistory = [];
    let undoHistoryIndex = -1;
    let undoLastCommitAt = 0;
    let undoLastCommitWasSeparate = false;
    let isApplyingUndo = false;

    function refreshDataRefs() {
      const nextEntries = getEntries();
      const nextTodos = getTodos();
      entries = Array.isArray(nextEntries) ? nextEntries : [];
      todos = Array.isArray(nextTodos) ? nextTodos : [];
    }

    function cloneEntriesForHistory(value) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => ({ ...item }));
    }

    function cloneTodosForHistory(value) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => normalizeTodo(item));
    }

    function buildUndoSnapshot() {
      refreshDataRefs();
      const entriesSnapshot = cloneEntriesForHistory(entries);
      const todosSnapshot = cloneTodosForHistory(todos);
      const selectedId = String(getSelectedTodoId() || "");
      return {
        entries: entriesSnapshot,
        todos: todosSnapshot,
        selectedTodoId: selectedId,
        signature: `${JSON.stringify(entriesSnapshot)}|${JSON.stringify(todosSnapshot)}`,
      };
    }

    function initializeUndoHistory() {
      const snapshot = buildUndoSnapshot();
      undoHistory = [snapshot];
      undoHistoryIndex = 0;
      undoLastCommitAt = Date.now();
      undoLastCommitWasSeparate = false;
      undoHistoryReady = true;
    }

    function commitUndoSnapshot(options = {}) {
      if (!undoHistoryReady || isApplyingUndo) return;
      const nextSnapshot = buildUndoSnapshot();
      const currentSnapshot = undoHistory[undoHistoryIndex];
      if (currentSnapshot && currentSnapshot.signature === nextSnapshot.signature) return;

      const now = Date.now();
      const canMerge = undoHistoryIndex > 0
        && !options.separate && !undoLastCommitWasSeparate
        && undoHistoryIndex === undoHistory.length - 1
        && now - undoLastCommitAt <= UNDO_MERGE_WINDOW_MS;
      if (canMerge) {
        undoHistory[undoHistoryIndex] = nextSnapshot;
        undoLastCommitAt = now;
        return;
      }

      undoHistory = undoHistory.slice(0, undoHistoryIndex + 1);
      undoHistory.push(nextSnapshot);
      if (undoHistory.length > UNDO_HISTORY_LIMIT) {
        const overflow = undoHistory.length - UNDO_HISTORY_LIMIT;
        undoHistory.splice(0, overflow);
        undoHistoryIndex = Math.max(0, undoHistoryIndex - overflow);
      }
      undoHistoryIndex = undoHistory.length - 1;
      undoLastCommitAt = now;
      undoLastCommitWasSeparate = Boolean(options.separate);
    }

    function isNativeUndoEditableTarget(target) {
      const ElementCtor = globalScope.Element;
      if (typeof ElementCtor !== "function" || !(target instanceof ElementCtor)) return false;
      const editableTarget = typeof target.closest === "function"
        ? target.closest('textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
        : null;
      if (!editableTarget) return false;

      const TextAreaCtor = globalScope.HTMLTextAreaElement;
      if (typeof TextAreaCtor === "function" && editableTarget instanceof TextAreaCtor) {
        return !editableTarget.readOnly && !editableTarget.disabled;
      }

      const InputCtor = globalScope.HTMLInputElement;
      if (typeof InputCtor === "function" && editableTarget instanceof InputCtor) {
        if (editableTarget.readOnly || editableTarget.disabled) return false;
        const type = String(editableTarget.type || "text").toLowerCase();
        return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
      }

      return true;
    }

    function applyUndoSnapshot(snapshot) {
      if (!snapshot) return;
      cancelPendingAutoSync();
      isApplyingUndo = true;
      try {
        const nextEntries = cloneEntriesForHistory(snapshot.entries);
        const nextTodos = cloneTodosForHistory(snapshot.todos);
        setEntries(nextEntries);
        setTodos(nextTodos);
        entries = nextEntries;
        todos = nextTodos;
        const preferredTodoId = String(snapshot.selectedTodoId || "");
        if (preferredTodoId && todos.some((item) => String(item.id) === preferredTodoId)) {
          setSelectedTodoId(preferredTodoId);
        } else {
          setSelectedTodoId(null);
        }
        saveEntries(entries, { skipUndoSnapshot: true });
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      } finally {
        isApplyingUndo = false;
      }
      clearTodoDetailSubmitState();
      render();
    }

    function handleGlobalUndoKeydown(event) {
      const undoKey = (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && String(event.key || "").toLowerCase() === "z";
      if (!undoKey) return;
      if (isNativeUndoEditableTarget(event.target)) return;
      if (isSyncRunning()) {
        event.preventDefault();
        setCalendarSyncStatus("同步进行中，稍后再撤销。", "warning");
        return;
      }
      if (undoHistoryIndex <= 0) return;

      event.preventDefault();
      undoHistoryIndex -= 1;
      const snapshot = undoHistory[undoHistoryIndex];
      applyUndoSnapshot(snapshot);
    }

    return {
      initializeUndoHistory,
      commitUndoSnapshot,
      isNativeUndoEditableTarget,
      handleGlobalUndoKeydown,
      isApplyingUndo: () => isApplyingUndo,
    };
  }

  globalScope.TimeQualityUndoRuntimeModule = {
    createUndoRuntimeModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
