const appConfig = (typeof window !== "undefined" && window.TimeQualityConfig) || {};
if (
  !Object.prototype.hasOwnProperty.call(appConfig, "STORAGE_KEY") ||
  !Object.prototype.hasOwnProperty.call(appConfig, "DATA_EXPORT_STORAGE_PREFIX")
) {
  throw new Error("TimeQualityConfig is missing required settings. Ensure app-config.js is loaded before app.js.");
}

const {
  STORAGE_KEY, QUOTE_POOL_KEY, QUOTE_LIBRARY_KEY, CACHE_RESET_ONCE_KEY, DATA_EXPORT_SCHEMA,
  DATA_EXPORT_STORAGE_PREFIX, CATEGORY_STORAGE_KEY, CALENDAR_SAMPLE_16_SEEDED_KEY, CALENDAR_SAMPLE_16_MARKER,
  EXTERNAL_CALENDAR_SYNC_URL, EXTERNAL_CALENDAR_SYNC_TRIGGER_URL, EXTERNAL_CALENDAR_PUSH_URL,
  EXTERNAL_CALENDAR_LIST_URL, EXTERNAL_REMINDER_LIST_URL, EXTERNAL_TASK_SYNC_URL, EXTERNAL_TASK_DELETE_URL,
  EXTERNAL_TASK_PULL_URL, EXTERNAL_TASK_REMINDER_SYNC_URL, EXTERNAL_TASK_REMINDER_COMPLETE_URL,
  INTERNAL_UPDATE_STATUS_URL, INTERNAL_UPDATE_CHECK_URL, INTERNAL_UPDATE_APPLY_URL, INTERNAL_UPDATE_FORCE_APPLY_URL,
  INTERNAL_UPDATE_BACKUPS_URL, INTERNAL_UPDATE_BACKUP_RESTORE_URL, RUNTIME_CONFIG_URL,
  INSTALL_GUIDE_DISMISSED_KEY,
  LOCAL_DATA_BACKUP_URL, LOCAL_DATA_LATEST_URL, LOCAL_DATA_SNAPSHOTS_URL, LOCAL_DATA_RESTORE_URL,
  EXTERNAL_CALENDAR_SOURCE, EXTERNAL_CALENDAR_IGNORED_KEY, EXTERNAL_CALENDAR_DEFAULT_CATEGORY,
  EXTERNAL_CALENDAR_AUTO_TODO_ENABLED, EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS,
  DEFAULT_SYNC_TARGET_SOURCE_NAME, DEFAULT_SYNC_TARGET_CALENDAR_NAME, DEFAULT_SYNC_TARGET_GROUP,
  DEFAULT_REMINDER_TARGET_SOURCE_NAME, DEFAULT_REMINDER_TARGET_LIST_NAME, DEFAULT_REMINDER_TARGET_GROUP,
  SYNC_CALENDAR_TARGET_STORAGE_KEY, SYNC_CALENDAR_TARGET_CONFIRMED_KEY, SYNC_REMINDER_TARGET_STORAGE_KEY,
  TODO_STORAGE_KEY, TODO_DELETE_QUEUE_STORAGE_KEY, TODO_REMINDER_DISABLE_QUEUE_STORAGE_KEY,
  TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY, TODO_REMINDER_DEFAULT_LEAD_MINUTES, TODO_REMINDER_DEFAULT_LEAD_OPTIONS,
  TODO_PLAN_ENTRY_ID_PREFIX, TODO_PLAN_DAY_FIRST_START_MINUTES, TODO_PLAN_DAY_FIRST_DURATION_MINUTES,
  TODO_PLAN_DAY_NEXT_DURATION_MINUTES, TODO_PLAN_NEW_TODO_DURATION_MINUTES, TODO_PLAN_DAY_GAP_MINUTES,
  TODO_COMPLETION_KEEP_VISIBLE_MS, TODO_NOTE_HELPER_TEXT, TODO_PROJECT_MAX_LEVEL, TODO_PROJECT_LEVEL_SEPARATOR,
  DEFAULT_SCORE, DEFAULT_POMODORO_MINUTES, POMODORO_DIAL_START_DEG, POMODORO_DIAL_RUNNING_CLASS,
  SCATTER_PADDING_PERCENT, HARD_SNAP_GUTTER, SCATTER_BASE_DURATION_HOURS, SCATTER_BASE_DIAMETER,
  SCATTER_MIN_DIAMETER, SCATTER_MAX_DIAMETER, SCORE_INPUT_WHEEL_PIXEL_THRESHOLD, SCORE_INPUT_WHEEL_LINE_THRESHOLD,
  SCORE_INPUT_WHEEL_RESET_MS, SCORE_WHEEL_ITEM_SPACING_PX, SCORE_WHEEL_DRAG_STEP_PX,
  SCORE_WHEEL_SCROLL_THRESHOLD_PX, SCORE_WHEEL_ITEM_VISIBLE_RADIUS, SCORE_WHEEL_INERTIA_MIN_VELOCITY,
  SCORE_WHEEL_INERTIA_FRICTION_PER_FRAME, SCORE_WHEEL_INERTIA_MAX_DT_MS, SCORE_WHEEL_MAX_BOUNCES,
  SCORE_WHEEL_BOUNCE_CLASS_HOLD_MS, CALENDAR_DEFAULT_CENTER_HOUR, CALENDAR_DEFAULT_HIDE_BEFORE_HOUR,
  CALENDAR_CLICK_MINUTE_STEP, CALENDAR_NEW_EVENT_DEFAULT_DURATION_MINUTES, CALENDAR_DIRECT_EDIT_MINUTES_STEP,
  CALENDAR_DIRECT_EDIT_MIN_DURATION_MINUTES, CALENDAR_DIRECT_EDIT_DRAG_SLOP_PX, CALENDAR_DIRECT_EDIT_CLICK_SUPPRESS_MS,
  CALENDAR_NOW_LINE_REFRESH_MS, GLOBAL_SEARCH_RESULT_LIMIT, GLOBAL_SEARCH_TARGET_HIGHLIGHT_MS,
  REVIEW_VISUAL_LOOKBACK_DAYS, AUTO_BIDIRECTIONAL_SYNC_ENABLED, AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS,
  AUTO_BIDIRECTIONAL_SYNC_PULL_INTERVAL_MS, AUTO_BIDIRECTIONAL_SYNC_START_DELAY_MS, SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY, TODO_DETAIL_WIDTH_STORAGE_KEY, SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY,
  SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY, TODO_PROJECT_TREE_COLLAPSE_STORAGE_KEY,
  SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, TODO_DETAIL_MIN_WIDTH, TODO_DETAIL_MAX_WIDTH, TODO_LIST_MIN_WIDTH,
  UNDO_HISTORY_LIMIT, UNDO_MERGE_WINDOW_MS,
} = appConfig;

const coreUtils = (typeof window !== "undefined" && window.TimeQualityCoreUtils) || {};
const {
  addDays,
  calcDurationHours,
  formatClock,
  formatDateForInput,
  formatMinutesForInput,
  formatMinutesLabel,
  formatTimeForInput,
  getStartOfWeek,
  getWeekDates,
  isSameDay,
  isValidClockInput,
  isValidDateInput,
  parseClockToMinutes,
  parseOptionalScore,
} = coreUtils;

if (
  [
    addDays,
    calcDurationHours,
    formatClock,
    formatDateForInput,
    formatMinutesForInput,
    formatMinutesLabel,
    formatTimeForInput,
    getStartOfWeek,
    getWeekDates,
    isSameDay,
    isValidClockInput,
    isValidDateInput,
    parseClockToMinutes,
    parseOptionalScore,
  ].some((item) => typeof item !== "function")
) {
  throw new Error("TimeQualityCoreUtils is missing required helpers. Ensure app-core-utils.js is loaded before app.js.");
}

const syncModuleSource = (typeof window !== "undefined" && window.TimeQualitySyncModule) || {};
const { createSyncModule } = syncModuleSource;

if (typeof createSyncModule !== "function") {
  throw new Error("TimeQualitySyncModule is missing createSyncModule. Ensure app-sync.js is loaded before app.js.");
}

const todoSyncBridgeModuleSource =
  (typeof window !== "undefined" && window.TimeQualityTodoSyncBridgeModule) || {};
const { createTodoSyncBridgeModule } = todoSyncBridgeModuleSource;

if (typeof createTodoSyncBridgeModule !== "function") {
  throw new Error(
    "TimeQualityTodoSyncBridgeModule is missing createTodoSyncBridgeModule. Ensure app-todo-sync-bridge.js is loaded before app.js.",
  );
}

const externalCalendarImportModuleSource =
  (typeof window !== "undefined" && window.TimeQualityExternalCalendarImportModule) || {};
const { createExternalCalendarImportModule } = externalCalendarImportModuleSource;

if (typeof createExternalCalendarImportModule !== "function") {
  throw new Error(
    "TimeQualityExternalCalendarImportModule is missing createExternalCalendarImportModule. Ensure app-external-calendar-import.js is loaded before app.js.",
  );
}

const syncRuntimeModuleSource = (typeof window !== "undefined" && window.TimeQualitySyncRuntimeModule) || {};
const { createSyncRuntimeModule } = syncRuntimeModuleSource;

if (typeof createSyncRuntimeModule !== "function") {
  throw new Error(
    "TimeQualitySyncRuntimeModule is missing createSyncRuntimeModule. Ensure app-sync-runtime.js is loaded before app.js.",
  );
}

const todoActionsModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoActionsModule) || {};
const { createTodoActionsModule } = todoActionsModuleSource;

if (typeof createTodoActionsModule !== "function") {
  throw new Error(
    "TimeQualityTodoActionsModule is missing createTodoActionsModule. Ensure app-todo-actions.js is loaded before app.js.",
  );
}

const calendarActionsModuleSource = (typeof window !== "undefined" && window.TimeQualityCalendarActionsModule) || {};
const { createCalendarActionsModule } = calendarActionsModuleSource;

if (typeof createCalendarActionsModule !== "function") {
  throw new Error(
    "TimeQualityCalendarActionsModule is missing createCalendarActionsModule. Ensure app-calendar-actions.js is loaded before app.js.",
  );
}

const dataStoreModuleSource = (typeof window !== "undefined" && window.TimeQualityDataStoreModule) || {};
const { createDataStoreModule } = dataStoreModuleSource;

if (typeof createDataStoreModule !== "function") {
  throw new Error(
    "TimeQualityDataStoreModule is missing createDataStoreModule. Ensure app-data-store.js is loaded before app.js.",
  );
}

const localDataBackupModuleSource =
  (typeof window !== "undefined" && window.TimeQualityLocalDataBackupModule) || {};
const { createLocalDataBackupModule } = localDataBackupModuleSource;

if (typeof createLocalDataBackupModule !== "function") {
  throw new Error(
    "TimeQualityLocalDataBackupModule is missing createLocalDataBackupModule. Ensure app-local-data-backup.js is loaded before app.js.",
  );
}

const undoRuntimeModuleSource = (typeof window !== "undefined" && window.TimeQualityUndoRuntimeModule) || {};
const { createUndoRuntimeModule } = undoRuntimeModuleSource;

if (typeof createUndoRuntimeModule !== "function") {
  throw new Error(
    "TimeQualityUndoRuntimeModule is missing createUndoRuntimeModule. Ensure app-undo-runtime.js is loaded before app.js.",
  );
}

const calendarSamplesModuleSource = (typeof window !== "undefined" && window.TimeQualityCalendarSamplesModule) || {};
const { createCalendarSamplesModule } = calendarSamplesModuleSource;

if (typeof createCalendarSamplesModule !== "function") {
  throw new Error(
    "TimeQualityCalendarSamplesModule is missing createCalendarSamplesModule. Ensure app-calendar-samples.js is loaded before app.js.",
  );
}

const todoModelModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoModelModule) || {};
const { createTodoModelModule } = todoModelModuleSource;

if (typeof createTodoModelModule !== "function") {
  throw new Error(
    "TimeQualityTodoModelModule is missing createTodoModelModule. Ensure app-todo-model.js is loaded before app.js.",
  );
}

const todoPlanModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoPlanModule) || {};
const { createTodoPlanModule } = todoPlanModuleSource;

if (typeof createTodoPlanModule !== "function") {
  throw new Error(
    "TimeQualityTodoPlanModule is missing createTodoPlanModule. Ensure app-todo-plan.js is loaded before app.js.",
  );
}

const todoDetailModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoDetailModule) || {};
const { createTodoDetailModule } = todoDetailModuleSource;

if (typeof createTodoDetailModule !== "function") {
  throw new Error(
    "TimeQualityTodoDetailModule is missing createTodoDetailModule. Ensure app-todo-detail.js is loaded before app.js.",
  );
}

const todoListModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoListModule) || {};
const { createTodoListModule } = todoListModuleSource;

if (typeof createTodoListModule !== "function") {
  throw new Error(
    "TimeQualityTodoListModule is missing createTodoListModule. Ensure app-todo-list.js is loaded before app.js.",
  );
}

const sidebarTaxonomyModuleSource =
  (typeof window !== "undefined" && window.TimeQualitySidebarTaxonomyModule) || {};
const { createSidebarTaxonomyModule } = sidebarTaxonomyModuleSource;

if (typeof createSidebarTaxonomyModule !== "function") {
  throw new Error(
    "TimeQualitySidebarTaxonomyModule is missing createSidebarTaxonomyModule. Ensure app-sidebar-taxonomy.js is loaded before app.js.",
  );
}

const reviewModuleSource = (typeof window !== "undefined" && window.TimeQualityReviewModule) || {};
const { createReviewModule } = reviewModuleSource;

if (typeof createReviewModule !== "function") {
  throw new Error(
    "TimeQualityReviewModule is missing createReviewModule. Ensure app-review.js is loaded before app.js.",
  );
}

const searchModuleSource = (typeof window !== "undefined" && window.TimeQualitySearchModule) || {};
const { createSearchModule } = searchModuleSource;

if (typeof createSearchModule !== "function") {
  throw new Error(
    "TimeQualitySearchModule is missing createSearchModule. Ensure app-search.js is loaded before app.js.",
  );
}

const scoreWheelModuleSource = (typeof window !== "undefined" && window.TimeQualityScoreWheelModule) || {};
const { createScoreWheelModule } = scoreWheelModuleSource;

if (typeof createScoreWheelModule !== "function") {
  throw new Error(
    "TimeQualityScoreWheelModule is missing createScoreWheelModule. Ensure app-score-wheel.js is loaded before app.js.",
  );
}

const pomodoroModuleSource = (typeof window !== "undefined" && window.TimeQualityPomodoroModule) || {};
const { createPomodoroModule } = pomodoroModuleSource;

if (typeof createPomodoroModule !== "function") {
  throw new Error(
    "TimeQualityPomodoroModule is missing createPomodoroModule. Ensure app-pomodoro.js is loaded before app.js.",
  );
}

const pomodoroTodoLinkModuleSource =
  (typeof window !== "undefined" && window.TimeQualityPomodoroTodoLinkModule) || {};
const { createPomodoroTodoLinkModule } = pomodoroTodoLinkModuleSource;

if (typeof createPomodoroTodoLinkModule !== "function") {
  throw new Error(
    "TimeQualityPomodoroTodoLinkModule is missing createPomodoroTodoLinkModule. Ensure app-pomodoro-todo-link.js is loaded before app.js.",
  );
}

const settingsModuleSource = (typeof window !== "undefined" && window.TimeQualitySettingsModule) || {};
const { createSettingsModule } = settingsModuleSource;

if (typeof createSettingsModule !== "function") {
  throw new Error(
    "TimeQualitySettingsModule is missing createSettingsModule. Ensure app-settings.js is loaded before app.js.",
  );
}

const aiSettingsModuleSource = (typeof window !== "undefined" && window.TimeQualityAiSettingsModule) || {};
const { createAiSettingsModule } = aiSettingsModuleSource;

if (typeof createAiSettingsModule !== "function") {
  throw new Error(
    "TimeQualityAiSettingsModule is missing createAiSettingsModule. Ensure app-ai-settings.js is loaded before app.js.",
  );
}

const installGuideModuleSource = (typeof window !== "undefined" && window.TimeQualityInstallGuideModule) || {};
const { createInstallGuideModule } = installGuideModuleSource;

if (typeof createInstallGuideModule !== "function") {
  throw new Error(
    "TimeQualityInstallGuideModule is missing createInstallGuideModule. Ensure app-install-guide.js is loaded before app.js.",
  );
}

const internalUpdateModuleSource =
  (typeof window !== "undefined" && window.TimeQualityInternalUpdateModule) || {};
const { createInternalUpdateModule } = internalUpdateModuleSource;

if (typeof createInternalUpdateModule !== "function") {
  throw new Error(
    "TimeQualityInternalUpdateModule is missing createInternalUpdateModule. Ensure app-internal-update.js is loaded before app.js.",
  );
}

const syncSettingsModuleSource = (typeof window !== "undefined" && window.TimeQualitySyncSettingsModule) || {};
const { createSyncSettingsModule } = syncSettingsModuleSource;

if (typeof createSyncSettingsModule !== "function") {
  throw new Error(
    "TimeQualitySyncSettingsModule is missing createSyncSettingsModule. Ensure app-sync-settings.js is loaded before app.js.",
  );
}

const todoReminderModuleSource = (typeof window !== "undefined" && window.TimeQualityTodoReminderModule) || {};
const { createTodoReminderModule } = todoReminderModuleSource;

if (typeof createTodoReminderModule !== "function") {
  throw new Error(
    "TimeQualityTodoReminderModule is missing createTodoReminderModule. Ensure app-todo-reminder.js is loaded before app.js.",
  );
}

const calendarUiModuleSource = (typeof window !== "undefined" && window.TimeQualityCalendarUiModule) || {};
const { createCalendarUiModule } = calendarUiModuleSource;

if (typeof createCalendarUiModule !== "function") {
  throw new Error(
    "TimeQualityCalendarUiModule is missing createCalendarUiModule. Ensure app-calendar-ui.js is loaded before app.js.",
  );
}

const calendarModalModuleSource = (typeof window !== "undefined" && window.TimeQualityCalendarModalModule) || {};
const { createCalendarModalModule } = calendarModalModuleSource;

if (typeof createCalendarModalModule !== "function") {
  throw new Error(
    "TimeQualityCalendarModalModule is missing createCalendarModalModule. Ensure app-calendar-modal.js is loaded before app.js.",
  );
}

const domRefsModuleSource = (typeof window !== "undefined" && window.TimeQualityDomRefsModule) || {};
const { createDomRefsModule } = domRefsModuleSource;

if (typeof createDomRefsModule !== "function") {
  throw new Error(
    "TimeQualityDomRefsModule is missing createDomRefsModule. Ensure app-dom-refs.js is loaded before app.js.",
  );
}

const startupModuleSource = (typeof window !== "undefined" && window.TimeQualityStartupModule) || {};
const { createStartupModule } = startupModuleSource;

if (typeof createStartupModule !== "function") {
  throw new Error(
    "TimeQualityStartupModule is missing createStartupModule. Ensure app-startup.js is loaded before app.js.",
  );
}

const overviewModuleSource = (typeof window !== "undefined" && window.TimeQualityOverviewModule) || {};
const { createOverviewModule } = overviewModuleSource;

if (typeof createOverviewModule !== "function") {
  throw new Error(
    "TimeQualityOverviewModule is missing createOverviewModule. Ensure app-overview.js is loaded before app.js.",
  );
}

const layoutShellModuleSource = (typeof window !== "undefined" && window.TimeQualityLayoutShellModule) || {};
const { createLayoutShellModule } = layoutShellModuleSource;

if (typeof createLayoutShellModule !== "function") {
  throw new Error(
    "TimeQualityLayoutShellModule is missing createLayoutShellModule. Ensure app-layout-shell.js is loaded before app.js.",
  );
}

const aiSidebarModuleSource = (typeof window !== "undefined" && window.TimeQualityAiSidebarModule) || {};
const { createAiSidebarModule } = aiSidebarModuleSource;

if (typeof createAiSidebarModule !== "function") {
  throw new Error(
    "TimeQualityAiSidebarModule is missing createAiSidebarModule. Ensure app-ai-sidebar.js is loaded before app.js.",
  );
}

const renderCoordinatorModuleSource =
  (typeof window !== "undefined" && window.TimeQualityRenderCoordinatorModule) || {};
const { createRenderCoordinatorModule } = renderCoordinatorModuleSource;

if (typeof createRenderCoordinatorModule !== "function") {
  throw new Error(
    "TimeQualityRenderCoordinatorModule is missing createRenderCoordinatorModule. Ensure app-render-coordinator.js is loaded before app.js.",
  );
}

const domRefs = createDomRefsModule({ documentRef: document });
const {
  rangeSwitch, reviewRangeSwitch, recordsPanel, emptyTip, calendarRangeLabel, calendarWeekdays,
  calendarScroll, calendarCustomScrollbar, calendarCustomThumb, calendarTimeAxis, calendarDayColumns,
  calendarUnratedJumpBtn, calendarUnratedCount, calendarPrevWeekBtn, calendarTodayBtn, calendarNextWeekBtn,
  calendarSyncStatus, calendarEventModal, calendarEventTitle, calendarEventForm, calendarEventEditCategory,
  calendarEventEditDate, calendarEventEditStart, calendarEventEditEnd, calendarEventEditQuality,
  calendarEventEditHappiness, calendarEventEditNote, scoreWheelPopover, scoreWheelTrack, barsWrap,
  scatterWrap, insight, heroQuote, overviewJudgment, firstScreenPanels, metricHours, metricQuality, metricHappiness,
  metricGolden, qualityIndex, pomodoroMinutesInput, pomodoroCategory, pomodoroDial, pomodoroDisplay,
  pomodoroRange, pomodoroMinusFiveBtn, pomodoroPlusFiveBtn, pomodoroStartBtn, pomodoroPauseBtn,
  pomodoroResetBtn, pomodoroScoreModal, pomodoroScoreTitle, pomodoroScoreDescription,
  pomodoroQualityScoreSlider, pomodoroHappinessScoreSlider, pomodoroScoreConfirmBtn,
  pomodoroScoreIncompleteBtn, pomodoroScoreCancelBtn, globalSearchWrap, globalSearchInput,
  globalSearchResultsPanel, globalSearchResultsList, globalSearchResultsEmpty, sidebarToggleBtn, topSyncRefreshBtn, topSyncHub,
  sidebar, sidebarResizer, sidebarProjectList, sidebarTagList, sidebarTaxonomyRangeControl,
  sidebarAiDockButton, sidebarAiPanel, sidebarAiCloseBtn, sidebarAiForm, sidebarAiInput, sidebarAiStatus,
  sidebarAiActionButtons,
  todoNativeInputIcons, sidebarNavItems, appViews, todoSortMenu, todoSortCurrent, todoFilterBar, todoScopeMenu,
  todoScopeCurrent, todoScopeAllBtn, todoLayout, todoDetailResizer, todoGroups, todoHistoryGroups,
  todoHistoryToggleBtn, todoRecurringToggleBtn, todoAddButton, todoDetailForm, todoDetailPanel,
  todoDetailId, todoTitleInput, todoDueDateInput, todoProjectSuggestWrap,
  todoProjectInput, todoProjectSuggestionMenu, todoCategorySuggestWrap, todoCategoryTrigger,
  todoCategoryTriggerLabel, todoCategorySuggestionMenu, todoCategoryInput, todoRepeatSuggestWrap,
  todoRepeatTrigger, todoRepeatTriggerLabel, todoRepeatSuggestionMenu, todoTagSuggestWrap, todoTagsInput,
  todoTagSuggestionMenu, todoNoteInput, todoQualityInput, todoHappinessInput, todoStartTimeInput,
  todoEndTimeInput, todoEstimateInput, todoReminderInput, todoRepeatInput, todoPlanLockBtn, todoFocusBtn,
  todoDeleteBtn,
  todoSyncMessage, reviewSummary, reviewList, reviewDebugSummary, reviewDebugTbody, reviewLegacyToggleBtn,
  reviewLegacySections, reviewVisualSummary, reviewVisualKpis, reviewChartTrend, reviewChartCategory,
  reviewChartTimeband, reviewChartMatrix, settingsCategoryList, settingsCategoryAddInput, settingsCategoryAddBtn,
  settingsCategoryResetBtn, settingsSyncAllRefreshBtn, settingsSyncCalendarSelect, settingsSyncCalendarHint,
  settingsSyncReminderSelect, settingsSyncReminderHint, settingsReminderLeadSelect, settingsReminderLeadHint,
  settingsQuoteEditor, settingsQuoteSaveBtn, settingsQuoteResetBtn, settingsQuoteStatus, settingsDataExportBtn,
  settingsDataImportBtn, settingsDataImportInput, settingsDataStatus, settingsDataSnapshotSelect,
  settingsDataSnapshotRefreshBtn, settingsDataSnapshotPreviewBtn, settingsDataSnapshotRestoreBtn,
  settingsDataSnapshotDeleteBtn, settingsDataSnapshotStatus, settingsRuntimePortInput,
  settingsRuntimePortSaveBtn, settingsRuntimePortStatus, settingsInstallMode, settingsInstallBtn,
  settingsInstallCopyBtn, settingsInstallStatus, settingsEnvPlatform, settingsEnvNode, settingsEnvChrome, settingsEnvGit,
  settingsUpdateCurrent, settingsUpdateLatest, settingsUpdateWorktree, settingsUpdateRemote, settingsUpdateDetails,
  settingsUpdateCheckBtn, settingsUpdateApplyBtn, settingsUpdateForceApplyBtn, settingsUpdateBackupSelect,
  settingsUpdateBackupExportBtn, settingsUpdateBackupRestoreBtn, settingsUpdateBackupDeleteBtn,
  settingsUpdateBackupStatus, settingsUpdateStatus,
  installGuideBanner, installGuideBannerInstallBtn, installGuideBannerSettingsBtn, installGuideBannerDismissBtn,
  syncErrorModal, syncErrorSummary, syncErrorDetail,
  syncErrorCopyStatus, syncErrorCopyBtn,
} = domRefs;

const DEFAULT_CATEGORIES = ["工作", "学习", "运动", "休息", "社交", "兴趣", "家务", "通勤"];
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function getWeekdayLabelForDate(dateText) {
  if (!isValidDateInput(dateText)) return "";
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return WEEKDAY_LABELS[date.getDay()] || "";
}

const MOTIVATION_QUOTES = [
  { text: "卓越不是一次行为，而是一种习惯。", author: "亚里士多德" },
  { text: "知之者不如好之者，好之者不如乐之者。", author: "孔子" },
  { text: "合抱之木，生于毫末；九层之台，起于累土。", author: "老子" },
  { text: "天下事，困于想，破于行。", author: "曾国藩" },
  { text: "知是行之始，行是知之成。", author: "王阳明" },
  { text: "我走得很慢，但我从不后退。", author: "亚伯拉罕·林肯" },
  { text: "不是时间不够，而是我们利用得不够好。", author: "本杰明·富兰克林" },
  { text: "你现在能做的，就从现在开始做。", author: "歌德" },
  { text: "知道为何而活的人，几乎可以承受任何生活。", author: "尼采" },
  { text: "生活中没有可怕的东西，只有需要理解的东西。", author: "居里夫人" },
  { text: "每个人都想改变世界，却很少想到改变自己。", author: "列夫·托尔斯泰" },
  { text: "做你自己，因为其他人都已经有人做了。", author: "奥斯卡·王尔德" },
  { text: "成功是从失败走向失败，也不失热情。", author: "温斯顿·丘吉尔" },
  { text: "想要看见变化，就先成为那个变化。", author: "圣雄甘地" },
  { text: "在黑暗中抱怨，不如点亮一盏灯。", author: "刘彝" },
  { text: "真正的幸福，来自有意义地度过今天。", author: "威廉·詹姆斯" },
];

const localDataBackupModule = createLocalDataBackupModule({
  DATA_EXPORT_SCHEMA,
  DATA_EXPORT_STORAGE_PREFIX,
  LOCAL_DATA_BACKUP_URL,
  LOCAL_DATA_LATEST_URL,
  LOCAL_DATA_SNAPSHOTS_URL,
  LOCAL_DATA_RESTORE_URL,
  STORAGE_KEY,
  TODO_STORAGE_KEY,
  CATEGORY_STORAGE_KEY,
  localStorageRef: typeof window !== "undefined" && window.localStorage ? window.localStorage : null,
  windowRef: window,
  documentRef: document,
  settingsDataSnapshotSelect,
  settingsDataSnapshotRefreshBtn,
  settingsDataSnapshotPreviewBtn,
  settingsDataSnapshotRestoreBtn,
  settingsDataSnapshotDeleteBtn,
  settingsDataSnapshotStatus,
});

const settingsModule = createSettingsModule({
  CATEGORY_STORAGE_KEY,
  QUOTE_POOL_KEY,
  QUOTE_LIBRARY_KEY,
  DATA_EXPORT_SCHEMA,
  DATA_EXPORT_STORAGE_PREFIX,
  RUNTIME_CONFIG_URL,
  CACHE_RESET_ONCE_KEY,
  DEFAULT_CATEGORIES,
  MOTIVATION_QUOTES,
  documentRef: document,
  windowRef: window,
  localStorageRef: typeof window !== "undefined" && window.localStorage ? window.localStorage : null,
  heroQuote,
  pomodoroCategory,
  todoCategoryInput,
  calendarEventEditCategory,
  settingsCategoryList,
  settingsCategoryAddInput,
  settingsCategoryAddBtn,
  settingsCategoryResetBtn,
  settingsQuoteEditor,
  settingsQuoteSaveBtn,
  settingsQuoteResetBtn,
  settingsQuoteStatus,
  settingsDataExportBtn,
  settingsDataImportBtn,
  settingsDataImportInput,
  settingsDataStatus,
  settingsRuntimePortInput,
  settingsRuntimePortSaveBtn,
  settingsRuntimePortStatus,
  escapeHtml,
  getActiveView: () => activeView,
  getCategories: () => categories,
  setCategories: (value) => {
    categories = Array.isArray(value) ? value : [];
  },
  getMotivationQuotes: () => motivationQuotes,
  setMotivationQuotes: (value) => {
    motivationQuotes = Array.isArray(value) ? value : [];
  },
  getQuoteState: () => quoteState,
  setQuoteState: (value) => {
    quoteState = value && typeof value === "object" ? value : { pool: [], lastIndex: null };
  },
  getEntries: () => entries,
  getTodos: () => todos,
  render,
  syncTodoCategoryTriggerLabel,
  updateTodoCategorySuggestionOptions,
  isTodoCategorySuggestionMenuOpen,
  scheduleLocalDataBackup: (reason) => localDataBackupModule.scheduleBackup(reason),
  backupLocalDataNow: (reason) => localDataBackupModule.backupNow(reason),
});
const aiSettingsModule = createAiSettingsModule({
  documentRef: document,
  windowRef: window,
  locationRef: window.location,
  navigatorRef: navigator,
});
const internalUpdateModule = createInternalUpdateModule({
  INTERNAL_UPDATE_STATUS_URL,
  INTERNAL_UPDATE_CHECK_URL,
  INTERNAL_UPDATE_APPLY_URL,
  INTERNAL_UPDATE_FORCE_APPLY_URL,
  INTERNAL_UPDATE_BACKUPS_URL,
  INTERNAL_UPDATE_BACKUP_RESTORE_URL,
  windowRef: window,
  settingsEnvPlatform,
  settingsEnvNode,
  settingsEnvChrome,
  settingsEnvGit,
  settingsUpdateCurrent,
  settingsUpdateLatest,
  settingsUpdateWorktree,
  settingsUpdateRemote,
  settingsUpdateDetails,
  settingsUpdateCheckBtn,
  settingsUpdateApplyBtn,
  settingsUpdateForceApplyBtn,
  settingsUpdateBackupSelect,
  settingsUpdateBackupExportBtn,
  settingsUpdateBackupRestoreBtn,
  settingsUpdateBackupDeleteBtn,
  settingsUpdateBackupStatus,
  settingsUpdateStatus,
});
const installGuideModule = createInstallGuideModule({
  INSTALL_GUIDE_DISMISSED_KEY,
  windowRef: window,
  navigatorRef: navigator,
  localStorageRef: localStorage,
  locationRef: window.location,
  setActiveView: (view) => setActiveView(view),
  installGuideBanner,
  installGuideBannerInstallBtn,
  installGuideBannerSettingsBtn,
  installGuideBannerDismissBtn,
  settingsInstallMode,
  settingsInstallBtn,
  settingsInstallCopyBtn,
  settingsInstallStatus,
});
const overviewModule = createOverviewModule({
  documentRef: document,
  windowRef: window,
  metricHours,
  metricQuality,
  metricHappiness,
  metricGolden,
  qualityIndex,
  overviewJudgment,
  insight,
  barsWrap,
  scatterWrap,
  SCATTER_PADDING_PERCENT,
  SCATTER_BASE_DURATION_HOURS,
  SCATTER_BASE_DIAMETER,
  SCATTER_MIN_DIAMETER,
  SCATTER_MAX_DIAMETER,
});
const layoutShellModule = createLayoutShellModule({
  documentRef: document,
  windowRef: window,
  recordsPanel,
  firstScreenPanels,
  sidebar,
  sidebarResizer,
  sidebarToggleBtn,
  todoLayout,
  todoDetailResizer,
  HARD_SNAP_GUTTER,
  loadSidebarWidth,
  saveSidebarWidth,
  clampSidebarWidth,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
  loadTodoDetailWidth,
  saveTodoDetailWidth,
  clampTodoDetailWidth,
  TODO_DETAIL_MIN_WIDTH,
  TODO_DETAIL_MAX_WIDTH,
  TODO_LIST_MIN_WIDTH,
});
const aiSidebarModule = createAiSidebarModule({
  documentRef: document,
  windowRef: window,
  sidebar,
  sidebarAiDockButton,
  sidebarAiPanel,
  sidebarAiCloseBtn,
  sidebarAiForm,
  sidebarAiInput,
  sidebarAiStatus,
  sidebarAiActionButtons,
  getTodos: () => todos,
  setTodos: (value) => {
    todos = Array.isArray(value) ? value : [];
  },
  getEntries: () => entries,
  getSelectedTodo,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = todoId ? String(todoId) : null;
  },
  setAiHighlightedTodoIds: (todoIds) => {
    aiHighlightedTodoIds = new Set(Array.isArray(todoIds) ? todoIds.map((id) => String(id)).filter(Boolean) : []);
  },
  getCategories: () => categories,
  getTodayDateInputValue,
  createTodoDraft,
  normalizeTodo,
  getNextTodoOrderForDate,
  markTodoPlanningDirty,
  normalizeTodoOrderByClockForDate,
  saveTodos,
  setActiveView,
  render,
});
const todoReminderModule = createTodoReminderModule({
  TODO_PLAN_DAY_FIRST_START_MINUTES,
  TODO_REMINDER_DEFAULT_LEAD_MINUTES,
  TODO_REMINDER_DEFAULT_LEAD_OPTIONS,
  addDays,
  formatDateForInput,
  formatTimeForInput,
  formatMinutesForInput,
  isValidDateInput,
  isValidClockInput,
  parseClockToMinutes,
  getReminderDefaultLeadMinutes: getTodoReminderDefaultLeadMinutes,
});
const syncSettingsModule = createSyncSettingsModule({
  SYNC_CALENDAR_TARGET_STORAGE_KEY,
  SYNC_CALENDAR_TARGET_CONFIRMED_KEY,
  DEFAULT_SYNC_TARGET_SOURCE_NAME,
  DEFAULT_SYNC_TARGET_CALENDAR_NAME,
  DEFAULT_SYNC_TARGET_GROUP,
  DEFAULT_REMINDER_TARGET_SOURCE_NAME,
  DEFAULT_REMINDER_TARGET_LIST_NAME,
  DEFAULT_REMINDER_TARGET_GROUP,
  TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY,
  TODO_REMINDER_DEFAULT_LEAD_MINUTES,
  TODO_REMINDER_DEFAULT_LEAD_OPTIONS,
  EXTERNAL_CALENDAR_LIST_URL,
  EXTERNAL_REMINDER_LIST_URL,
  documentRef: document,
  windowRef: window,
  localStorageRef: typeof window !== "undefined" && window.localStorage ? window.localStorage : null,
  settingsSyncAllRefreshBtn,
  settingsSyncCalendarSelect,
  settingsSyncCalendarHint,
  settingsSyncReminderSelect,
  settingsSyncReminderHint,
  settingsReminderLeadSelect,
  settingsReminderLeadHint,
  escapeHtml,
  normalizeExternalCalendarGroupValue,
  setCalendarSyncStatus,
  scheduleAutoBidirectionalSync,
  setActiveView,
  renderTopTodoSyncHub,
  getSelectedTodo,
  getTodos: () => todos,
  saveTodos,
  render,
  isTodoEligibleForReminderSync,
  normalizeTodoReminderRepeatValue,
  todoUsesExplicitReminderDateTime,
  normalizeTodoReminderDefaultLeadMinutes,
  getTodoReminderLeadLabel,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

const todoModelModule = createTodoModelModule({
  TODO_PLAN_NEW_TODO_DURATION_MINUTES,
  TODO_PROJECT_MAX_LEVEL,
  TODO_PROJECT_LEVEL_SEPARATOR,
  addDays,
  formatDateForInput,
  parseOptionalScore,
  normalizeTodoCategoryValue,
  normalizeTodoNoteValue,
  normalizeTodoReminderRepeatValue,
  isRecurringTodoRepeatMode,
});

const syncModule = createSyncModule({
  createTodoSyncBridgeModule,
  TODO_PLAN_DAY_FIRST_START_MINUTES,
  TODO_REMINDER_DEFAULT_LEAD_MINUTES,
  EXTERNAL_TASK_SYNC_URL,
  EXTERNAL_TASK_DELETE_URL,
  EXTERNAL_TASK_PULL_URL,
  EXTERNAL_TASK_REMINDER_SYNC_URL,
  EXTERNAL_TASK_REMINDER_COMPLETE_URL,
  EXTERNAL_CALENDAR_PUSH_URL,
  TODO_DELETE_QUEUE_STORAGE_KEY,
  localStorageRef: typeof window !== "undefined" && window.localStorage ? window.localStorage : null,
  formatMinutesForInput,
  calcDurationHours,
  addMinutesToClock,
  getSyncCalendarTargetPayload,
  getSyncReminderTargetPayload,
  getTodoReminderDefaultLeadMinutes,
  getTodoCategory,
  parseOptionalScore,
  isValidDateInput,
  isValidClockInput,
  normalizeScoreForInput,
  buildTodoCalendarNote,
  deleteTodoByTaskId,
  hasDirtyLocalChanges,
  saveTodos,
  render,
  setCalendarSyncStatus,
  scheduleAutoBidirectionalSync,
  normalizeTodoOrderByClockForDate,
  normalizeTodoReminderDisableItem,
  saveTodoReminderDisableQueue,
  getTodos: () => todos,
  getPendingTodoCalendarDeletes: () => pendingTodoCalendarDeletes,
  setPendingTodoCalendarDeletes: (value) => {
    pendingTodoCalendarDeletes = Array.isArray(value) ? value : [];
  },
  getPendingTodoReminderDisables: () => pendingTodoReminderDisables,
});

const todoPlanModule = createTodoPlanModule({
  TODO_PLAN_ENTRY_ID_PREFIX,
  TODO_PLAN_DAY_FIRST_START_MINUTES,
  TODO_PLAN_DAY_FIRST_DURATION_MINUTES,
  TODO_PLAN_DAY_NEXT_DURATION_MINUTES,
  TODO_PLAN_NEW_TODO_DURATION_MINUTES,
  TODO_PLAN_DAY_GAP_MINUTES,
  parseClockToMinutes,
  formatMinutesForInput,
  isValidDateInput,
  calcDurationHours,
  normalizeEntryTitle,
  getTodoCategory,
  normalizeScoreForInput,
  buildEntryDateRange,
  saveTodos,
  render,
  getTodayDateInputValue,
  getCurrentClockMinutes,
  getTodos: () => todos,
  getEntries: () => entries,
  getCategories: () => categories,
});

const todoDetailModule = createTodoDetailModule({
  TODO_NOTE_HELPER_TEXT,
  documentRef: document,
  windowRef: window,
  setTimeoutFn: window.setTimeout.bind(window),
  clearTimeoutFn: window.clearTimeout.bind(window),
  todoNativeInputIcons,
  todoDetailForm,
  todoDetailPanel,
  todoDetailId,
  todoTitleInput,
  todoDueDateInput,
  todoProjectSuggestWrap,
  todoProjectInput,
  todoProjectSuggestionMenu,
  todoCategorySuggestWrap,
  todoCategoryTrigger,
  todoCategoryTriggerLabel,
  todoCategorySuggestionMenu,
  todoCategoryInput,
  todoRepeatSuggestWrap,
  todoRepeatTrigger,
  todoRepeatTriggerLabel,
  todoRepeatSuggestionMenu,
  todoTagSuggestWrap,
  todoTagsInput,
  todoTagSuggestionMenu,
  todoNoteInput,
  todoQualityInput,
  todoHappinessInput,
  todoStartTimeInput,
  todoEndTimeInput,
  todoEstimateInput,
  todoReminderInput,
  todoRepeatInput,
  todoPlanLockBtn,
  todoFocusBtn,
  todoDeleteBtn,
  scoreWheelPopover,
  escapeHtml,
  normalizeProjectName,
  normalizeTodoCategoryValue,
  normalizeTodoTags,
  normalizeTodoNoteValue,
  parseOptionalScore,
  isValidDateInput,
  getTodoCategory,
  normalizeTodoReminderRepeatValue,
  isRecurringTodoRepeatMode,
  renderTopTodoSyncHub,
  render,
  getSelectedTodo,
  getTodos: () => todos,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = String(todoId || "");
  },
  getActiveView: () => activeView,
  submitTodoDetailFromForm,
  handleTodoFocusStart,
  handleTodoDelete,
  getCategories: () => categories,
  getProjectLibrary: () => projectLibrary,
  getTagLibrary: () => tagLibrary,
});

const searchModule = createSearchModule({
  GLOBAL_SEARCH_RESULT_LIMIT,
  GLOBAL_SEARCH_TARGET_HIGHLIGHT_MS,
  documentRef: document,
  globalSearchWrap,
  globalSearchInput,
  globalSearchResultsPanel,
  globalSearchResultsList,
  globalSearchResultsEmpty,
  todoGroups,
  calendarDayColumns,
  requestAnimationFrameFn: window.requestAnimationFrame.bind(window),
  setTimeoutFn: window.setTimeout.bind(window),
  clearTimeoutFn: window.clearTimeout.bind(window),
  getTodos: () => todos,
  getEntries: () => entries,
  normalizeTodo,
  normalizeProjectName,
  getTodoCategory,
  isValidDateInput,
  isValidClockInput,
  formatDate,
  getWeekdayLabelForDate,
  getEntryDisplayTitle,
  escapeHtml,
  escapeCssAttributeSelectorValue,
  setActiveView,
  render,
  renderTodos,
  renderCalendar,
  getStartOfWeek,
  parseClockToMinutes,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = String(todoId || "");
  },
  setCalendarWeekStart: (value) => {
    calendarWeekStart = value;
  },
  setCalendarNeedsViewportReset: (value) => {
    calendarNeedsViewportReset = Boolean(value);
  },
  setCalendarPendingFocusMinutes: (value) => {
    calendarPendingFocusMinutes = value;
  },
});

function getGlobalSearchTerm() {
  return searchModule.getTerm();
}

const reviewModule = createReviewModule({
  REVIEW_VISUAL_LOOKBACK_DAYS,
  getEntries: () => entries,
  getTodos: () => todos,
  getGlobalSearchTerm,
  calcDurationHours,
  getEntryDisplayTitle,
  parseOptionalScore,
  sumBy,
  isValidDateInput,
  formatDateForInput,
  formatDate,
  escapeHtml,
  reviewVisualSummary,
  reviewVisualKpis,
  reviewChartTrend,
  reviewChartCategory,
  reviewChartTimeband,
  reviewChartMatrix,
  reviewList,
  reviewSummary,
  reviewDebugTbody,
  reviewDebugSummary,
  formatScoreLabel,
  isImportedExternalEntry,
  getTodoCategory,
  getCurrentRange: () => currentRange,
  getRangeEntries,
  setReviewLegacyVisible,
  getReviewLegacyVisible: () => reviewLegacyVisible,
});

let undoRuntimeModule = null;

const dataStoreModule = createDataStoreModule({
  STORAGE_KEY,
  TODO_STORAGE_KEY,
  TODO_REMINDER_DISABLE_QUEUE_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  TODO_DETAIL_WIDTH_STORAGE_KEY,
  EXTERNAL_CALENDAR_IGNORED_KEY,
  CACHE_RESET_ONCE_KEY,
  QUOTE_LIBRARY_KEY,
  QUOTE_POOL_KEY,
  TODO_DELETE_QUEUE_STORAGE_KEY,
  CALENDAR_SAMPLE_16_SEEDED_KEY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  TODO_DETAIL_MIN_WIDTH,
  TODO_DETAIL_MAX_WIDTH,
  TODO_PROJECT_LEVEL_SEPARATOR,
  localStorageRef: localStorage,
  normalizeTodo,
  normalizeProjectName,
  commitUndoSnapshot,
  scheduleAutoBidirectionalSync,
  scheduleLocalDataBackup: (reason) => localDataBackupModule.scheduleBackup(reason),
  getIsApplyingUndo: isApplyingUndoActive,
  getPendingTodoReminderDisables: () => pendingTodoReminderDisables,
  setPendingTodoReminderDisables: (value) => {
    pendingTodoReminderDisables = Array.isArray(value) ? value : [];
  },
});

runOneTimeCacheResetIfNeeded();

let currentRange = "7";
let entries = loadEntries();
let categories = settingsModule.loadCategories();
let todos = loadTodos();
let motivationQuotes = settingsModule.loadMotivationQuotes();
let quoteState = settingsModule.loadQuoteState();
let activeView = "overview";
let currentTodoDimension = "time";
let showTodoHistoryInMainList = false;
let showRecurringReminderOnlyInMainList = false;
let selectedTodoId = todos[0]?.id ?? null;
let aiHighlightedTodoIds = new Set();
let reviewLegacyVisible = false;

let calendarWeekStart = getStartOfWeek(new Date());
let calendarNeedsViewportReset = true;
let editingCalendarEntryId = null;
let calendarPendingFocusMinutes = null;
let ignoredExternalCalendarIds = loadIgnoredExternalCalendarIds();
let pendingTodoCalendarDeletes = loadTodoCalendarDeleteQueue();
let pendingTodoReminderDisables = loadTodoReminderDisableQueue();
let projectLibrary = [];
let tagLibrary = [];
let todoProjectTreeCollapsedPaths = loadCollapsedProjectPathSet(TODO_PROJECT_TREE_COLLAPSE_STORAGE_KEY);
const recentlyCompletedTodoDisplayMap = new Map();
const calendarSamplesModule = createCalendarSamplesModule({
  CALENDAR_SAMPLE_16_SEEDED_KEY,
  CALENDAR_SAMPLE_16_MARKER,
  localStorageRef: localStorage,
  getEntries: () => entries,
  setEntries: (value) => {
    entries = Array.isArray(value) ? value : [];
  },
  getTodos: () => todos,
  setTodos: (value) => {
    todos = Array.isArray(value) ? value : [];
  },
  getCalendarWeekStart: () => calendarWeekStart,
  setCalendarWeekStart: (value) => {
    calendarWeekStart = value;
  },
  setCalendarNeedsViewportReset: (value) => {
    calendarNeedsViewportReset = Boolean(value);
  },
  createUniqueEntryId,
  normalizeTodo,
  getNextTodoOrderForDate,
  saveEntries,
  saveTodos,
  calcDurationHours,
  getStartOfWeek,
  getWeekDates,
  formatDateForInput,
});
const sidebarTaxonomyModule = createSidebarTaxonomyModule({
  SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY,
  SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY,
  localStorageRef: localStorage,
  sidebarProjectList,
  sidebarTagList,
  sidebarTaxonomyRangeControl,
  escapeHtml,
  normalizeProjectName,
  normalizeTodoTags,
  getProjectPathSegments,
  buildProjectPathFromSegments,
  getTodayDateInputValue,
  formatDateForInput,
  addDays,
  isValidDateInput,
  loadCollapsedProjectPathSet,
  toggleCollapsedProjectPath,
  isProjectPathHiddenByCollapsed,
  getTodos: () => todos,
  getEntries: () => entries,
  setProjectLibrary: (value) => {
    projectLibrary = Array.isArray(value) ? value : [];
  },
  setTagLibrary: (value) => {
    tagLibrary = Array.isArray(value) ? value : [];
  },
  renderProjectTagSuggestions,
});
const todoListModule = createTodoListModule({
  TODO_PROJECT_MAX_LEVEL,
  TODO_PLAN_NEW_TODO_DURATION_MINUTES,
  TODO_PROJECT_LEVEL_SEPARATOR,
  todoSortMenu,
  todoSortCurrent,
  todoFilterBar,
  todoScopeMenu,
  todoScopeCurrent,
  todoScopeAllBtn,
  todoGroups,
  todoHistoryGroups,
  todoHistoryToggleBtn,
  todoRecurringToggleBtn,
  getTodos: () => todos,
  saveTodos,
  normalizeTodoTags,
  markTodoPlanningDirty,
  escapeHtml,
  formatDate,
  getTodayDateInputValue,
  getWeekdayLabelForDate,
  isValidDateInput,
  normalizeProjectName,
  normalizeProjectSegmentName,
  buildProjectPathFromSegments,
  getProjectPathSegments,
  getTodoCategory,
  getTodoDurationMinutes,
  formatTodoDurationMinutesLabel,
  formatTodoReminderLabel,
  compactTodoNotePreview,
  getIncompleteTodosByDate,
  getVisibleTodos,
  getTodoHistoryRecords,
  getGlobalSearchTerm,
  renderTodoDetail,
  getSelectedTodoId: () => selectedTodoId,
  isTodoAiHighlighted: (todoId) => aiHighlightedTodoIds.has(String(todoId || "")),
  setSelectedTodoId: (todoId) => {
    selectedTodoId = String(todoId || "");
  },
  getCurrentTodoDimension: () => currentTodoDimension,
  setCurrentTodoDimension: (dimension) => {
    currentTodoDimension = String(dimension || "time");
  },
  getShowTodoHistoryInMainList: () => showTodoHistoryInMainList,
  setShowTodoHistoryInMainList: (value) => {
    showTodoHistoryInMainList = Boolean(value);
  },
  getShowRecurringReminderOnlyInMainList: () => showRecurringReminderOnlyInMainList,
  setShowRecurringReminderOnlyInMainList: (value) => {
    showRecurringReminderOnlyInMainList = Boolean(value);
  },
  getTodoProjectTreeCollapsedPaths: () => todoProjectTreeCollapsedPaths,
  clearAllRecentlyCompletedForDisplay,
  toggleCollapsedTodoProjectPath: (path) => {
    toggleCollapsedProjectPath(todoProjectTreeCollapsedPaths, TODO_PROJECT_TREE_COLLAPSE_STORAGE_KEY, path);
  },
  moveTodoOrder,
  moveTodoToOrder,
  moveTodoToDateOrder,
  restoreHistoryItemToTodo,
  openTodoHistoryRecord,
  toggleTodoCompleted,
});
const scoreWheelModule = createScoreWheelModule({
  DEFAULT_SCORE,
  SCORE_INPUT_WHEEL_PIXEL_THRESHOLD,
  SCORE_INPUT_WHEEL_LINE_THRESHOLD,
  SCORE_INPUT_WHEEL_RESET_MS,
  SCORE_WHEEL_ITEM_SPACING_PX,
  SCORE_WHEEL_DRAG_STEP_PX,
  SCORE_WHEEL_SCROLL_THRESHOLD_PX,
  SCORE_WHEEL_ITEM_VISIBLE_RADIUS,
  SCORE_WHEEL_INERTIA_MIN_VELOCITY,
  SCORE_WHEEL_INERTIA_FRICTION_PER_FRAME,
  SCORE_WHEEL_INERTIA_MAX_DT_MS,
  SCORE_WHEEL_MAX_BOUNCES,
  SCORE_WHEEL_BOUNCE_CLASS_HOLD_MS,
  documentRef: document,
  windowRef: window,
  scoreWheelPopover,
  scoreWheelTrack,
});
const pomodoroTodoLinkModule = createPomodoroTodoLinkModule({
  TODO_PLAN_DAY_GAP_MINUTES,
  getCategories: () => categories,
  getTodos: () => todos,
  isValidDateInput,
  getIncompleteTodosByDate,
  getTodoCategory,
  normalizeEntryTitle,
  normalizeScoreForInput,
  getNextTodoOrderForDate,
  markTodoPlanningDirty,
  reflowTodoDayFromIndex,
  toggleTodoCompleted,
  savePomodoroEntry,
  formatDateForInput,
  moveTodoToDateOrder,
  reflowTodoDayAfterAnchor,
  saveTodos,
  render,
});
const pomodoroModule = createPomodoroModule({
  DEFAULT_POMODORO_MINUTES,
  DEFAULT_SCORE,
  POMODORO_DIAL_RUNNING_CLASS,
  POMODORO_DIAL_START_DEG,
  documentRef: document,
  windowRef: window,
  alertFn: window.alert.bind(window),
  promptFn: window.prompt.bind(window),
  scoreWheelModule,
  pomodoroMinutesInput,
  pomodoroCategory,
  pomodoroDial,
  pomodoroDisplay,
  pomodoroRange,
  pomodoroMinusFiveBtn,
  pomodoroPlusFiveBtn,
  pomodoroStartBtn,
  pomodoroPauseBtn,
  pomodoroResetBtn,
  pomodoroScoreModal,
  pomodoroScoreTitle,
  pomodoroScoreDescription,
  pomodoroQualityScoreSlider,
  pomodoroHappinessScoreSlider,
  pomodoroScoreConfirmBtn,
  pomodoroScoreIncompleteBtn,
  pomodoroScoreCancelBtn,
  formatClock,
  formatDateForInput,
  formatTimeForInput,
  validateEntryInput,
  normalizeEntryTitle,
  updateBodyModalState,
  savePomodoroEntry,
  getCategories: () => categories,
  getLinkedTodoById: (todoId) => todos.find((item) => String(item.id) === String(todoId)) || null,
  getLinkedTodoTitleFallback: (todo) => (
    normalizeEntryTitle(todo?.title, todo?.project || getTodoCategory(todo, todo?.project))
  ),
  completeLinkedTodoSession: completeLinkedTodoByPomodoroSession,
  recordLinkedTodoSession: recordLinkedTodoPomodoroSession,
});

const calendarUiModule = createCalendarUiModule({
  CALENDAR_DEFAULT_CENTER_HOUR,
  CALENDAR_DEFAULT_HIDE_BEFORE_HOUR,
  CALENDAR_CLICK_MINUTE_STEP,
  CALENDAR_NEW_EVENT_DEFAULT_DURATION_MINUTES,
  CALENDAR_DIRECT_EDIT_MINUTES_STEP,
  CALENDAR_DIRECT_EDIT_MIN_DURATION_MINUTES,
  CALENDAR_DIRECT_EDIT_DRAG_SLOP_PX,
  CALENDAR_DIRECT_EDIT_CLICK_SUPPRESS_MS,
  CALENDAR_NOW_LINE_REFRESH_MS,
  WEEKDAY_LABELS,
  documentRef: document,
  windowRef: window,
  alertFn: window.alert.bind(window),
  recordsPanel,
  emptyTip,
  calendarRangeLabel,
  calendarWeekdays,
  calendarScroll,
  calendarCustomScrollbar,
  calendarCustomThumb,
  calendarTimeAxis,
  calendarDayColumns,
  calendarUnratedJumpBtn,
  calendarUnratedCount,
  getEntries: () => entries,
  getCalendarWeekStart: () => calendarWeekStart,
  setCalendarWeekStart: (value) => {
    calendarWeekStart = value;
  },
  getCalendarNeedsViewportReset: () => calendarNeedsViewportReset,
  setCalendarNeedsViewportReset: (value) => {
    calendarNeedsViewportReset = Boolean(value);
  },
  getCalendarPendingFocusMinutes: () => calendarPendingFocusMinutes,
  setCalendarPendingFocusMinutes: (value) => {
    calendarPendingFocusMinutes = value;
  },
  getCalendarRenderEntries,
  findCalendarRenderableById,
  doesCalendarEntryMatchSearch,
  getGlobalSearchTerm,
  isAnalyzableEntry,
  isValidDateInput,
  parseClockToMinutes,
  getTodayDateInputValue,
  formatDate,
  formatDateForInput,
  formatMinutesLabel,
  formatTimeForInput,
  getWeekDates,
  getStartOfWeek,
  addDays,
  isSameDay,
  buildEntryDateRange,
  validateEntryInput,
  findOverlappingCalendarItem,
  getOverlapMessage,
  getEntryDisplayTitle,
  canDirectEditEntry,
  isEntryNotEditableYet,
  escapeHtml,
  commitDirectEditDraft: commitCalendarDirectEditDraft,
});

const calendarModalModule = createCalendarModalModule({
  documentRef: document,
  windowRef: window,
  DEFAULT_SCORE,
  calendarEventModal,
  calendarEventTitle,
  calendarEventForm,
  calendarEventEditCategory,
  calendarEventEditDate,
  calendarEventEditStart,
  calendarEventEditEnd,
  calendarEventEditQuality,
  calendarEventEditHappiness,
  calendarEventEditNote,
  scoreWheelModule,
  getCategories: () => categories,
  setEditingCalendarEntryId: (entryId) => {
    editingCalendarEntryId = entryId;
  },
  getTodayDateInputValue,
  getDefaultCalendarMinutesByClick,
  getEntryDisplayTitle,
  isEntryNotEditableYet,
  parseOptionalScore,
  formatMinutesForInput,
  normalizeEntryTitle,
  updateBodyModalState,
});

const calendarActionsModule = createCalendarActionsModule({
  calendarEventEditCategory,
  calendarEventEditDate,
  calendarEventEditStart,
  calendarEventEditEnd,
  calendarEventEditQuality,
  calendarEventEditHappiness,
  calendarEventEditNote,
  pomodoroCategory,
  alertFn: window.alert.bind(window),
  getEntries: () => entries,
  setEntries: (value) => {
    entries = Array.isArray(value) ? value : [];
  },
  getTodos: () => todos,
  getCategories: () => categories,
  getEditingCalendarEntryId: () => editingCalendarEntryId,
  getIgnoredExternalCalendarIds: () => ignoredExternalCalendarIds,
  setCalendarWeekStart: (value) => {
    calendarWeekStart = value;
  },
  setCalendarPendingFocusMinutes: (value) => {
    calendarPendingFocusMinutes = value;
  },
  setCalendarNeedsViewportReset: (value) => {
    calendarNeedsViewportReset = Boolean(value);
  },
  getCalendarUiRenderEntries: () => calendarUiModule.getRenderEntries(),
  findCalendarRenderableById,
  getTodoIdFromPlanEntryId,
  deleteTodoByTaskId,
  closeCalendarEventModal,
  saveTodos,
  saveEntries,
  render,
  renderCalendar,
  isImportedExternalEntry,
  saveIgnoredExternalCalendarIds,
  todoPlanModule,
  shouldCalendarEntryEditUpdateLinkedTodo,
  markTodoPlanningDirty,
  getCalendarEventModalTitleValue,
  isCalendarModalScoreLockedForEntry,
  normalizeScoreForInput,
  createUniqueEntryId,
  normalizeEntryTitle,
  normalizeProjectName,
  normalizeTodoTags,
  calcDurationHours,
  buildEntryDateRange,
  getCalendarRenderEntries,
  formatDate,
  getEntryDisplayTitle,
  formatDateForInput,
  formatTimeForInput,
  getStartOfWeek,
});

const todoActionsModule = createTodoActionsModule({
  TODO_PLAN_NEW_TODO_DURATION_MINUTES,
  TODO_PLAN_DAY_FIRST_START_MINUTES,
  TODO_PLAN_DAY_GAP_MINUTES,
  DEFAULT_POMODORO_MINUTES,
  todoTitleInput,
  pomodoroModule,
  todoDetailModule,
  getTodos: () => todos,
  getEntries: () => entries,
  getCategories: () => categories,
  getSelectedTodoId: () => selectedTodoId,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = todoId ? String(todoId) : null;
  },
  getShowTodoHistoryInMainList: () => showTodoHistoryInMainList,
  createTodoDraft,
  assignScheduleForNewTodo,
  saveTodos,
  saveEntries,
  setActiveView,
  render,
  renderTodos,
  getSelectedTodo,
  collectTodoFormInput,
  commitTodoDetailIfDirty,
  normalizeTodo,
  normalizeProjectName,
  normalizeTodoCategoryValue,
  normalizeTodoTags,
  parseOptionalScore,
  normalizeEntryTitle,
  getEntryDisplayTitle,
  getTodoCategory,
  normalizeTodoReminderRepeatValue,
  isRecurringTodoRepeatMode,
  resolveNextRecurringDueDate,
  parseTodoReminderDateTime,
  isTodoEligibleForReminderSync,
  buildEntryDateRange,
  calcDurationHours,
  formatDateForInput,
  formatTimeForInput,
  getTodayDateInputValue,
  isValidDateInput,
  isValidClockInput,
  parseClockToMinutes,
  formatMinutesForInput,
  getTodoDurationMinutes,
  getTodoClockRange,
  setTodoRangeByStartAndDuration,
  getIncompleteTodosByDate,
  normalizeTodoOrderForDate,
  getNextTodoOrderForDate,
  moveTodoToOrder,
  markTodoPlanningDirty,
  reflowTodoDayFromIndex,
  reflowTodoDayAfterAnchor,
  reflowTodoDayFromStart,
  enqueueTodoCalendarDelete,
  enqueueTodoReminderDisable,
  addEntry,
  createUniqueEntryId,
  clearTodoRecentlyCompletedForDisplay,
  markTodoRecentlyCompletedForDisplay,
  buildTodoReminderCompleteRequest,
  completeTodoTasksInMacReminders,
  applyTodoReminderCompleteItems,
  scheduleAutoBidirectionalSync,
  setCalendarSyncStatus,
});

const syncRuntimeModule = createSyncRuntimeModule({
  AUTO_BIDIRECTIONAL_SYNC_ENABLED,
  AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS,
  AUTO_BIDIRECTIONAL_SYNC_PULL_INTERVAL_MS,
  AUTO_BIDIRECTIONAL_SYNC_START_DELAY_MS,
  EXTERNAL_CALENDAR_SYNC_URL,
  EXTERNAL_CALENDAR_SYNC_TRIGGER_URL,
  EXTERNAL_CALENDAR_SOURCE,
  EXTERNAL_CALENDAR_DEFAULT_CATEGORY,
  EXTERNAL_CALENDAR_AUTO_TODO_ENABLED,
  EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS,
  calendarSyncStatus,
  syncErrorModal,
  syncErrorSummary,
  syncErrorDetail,
  syncErrorCopyStatus,
  topSyncRefreshBtn,
  createExternalCalendarImportModule,
  initSyncSettings: () => syncSettingsModule.init(),
  getSyncCalendarTarget: () => syncSettingsModule.getCalendarTarget(),
  normalizeSyncCalendarTarget: (target) => syncSettingsModule.normalizeCalendarTarget(target),
  getEntries: () => entries,
  getTodos: () => todos,
  getIgnoredExternalCalendarIds: () => ignoredExternalCalendarIds,
  getSelectedTodoId: () => selectedTodoId,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = String(todoId || "");
  },
  getSyncCalendarTargetPayload,
  buildTodoSyncRequest,
  buildTodoReminderSyncRequest,
  buildTodoReminderCompleteRequest,
  buildTodoReminderDisableSyncRequestsFromQueue,
  buildTodoDeleteSyncRequests,
  completeTodoTasksInMacReminders,
  applyTodoReminderCompleteItems,
  deleteTodoTasksFromMacCalendar,
  applyTodoTaskDeleteSyncItems,
  syncTodoTasksToMacCalendar,
  applyTodoTaskSyncItems,
  syncTodoTasksToMacReminders,
  applyTodoReminderSyncItems,
  applyQueuedTodoReminderDisableSyncItems,
  pullTodosFromMacCalendar,
  saveTodos,
  saveEntries,
  render,
  renderTopTodoSyncHub,
  getSelectedTodo,
  isTodoEligibleForReminderSync,
  normalizeTodoReminderRepeatValue,
  isRecurringTodoRepeatMode,
  normalizeTodoCategoryValue,
  normalizeProjectName,
  normalizeEntryTitle,
  normalizeTodoNoteValue,
  getTodoCategory,
  isValidDateInput,
  getNextTodoOrderForDate,
  normalizeTodo,
  normalizeTodoOrderForDate,
  buildEntryDateRange,
  formatDateForInput,
  formatTimeForInput,
  isImportedExternalEntry,
  createUniqueEntryId,
  updateBodyModalState,
  normalizeExternalCalendarGroupValue,
});

undoRuntimeModule = createUndoRuntimeModule({
  UNDO_HISTORY_LIMIT,
  UNDO_MERGE_WINDOW_MS,
  getEntries: () => entries,
  setEntries: (value) => {
    entries = Array.isArray(value) ? value : [];
  },
  getTodos: () => todos,
  setTodos: (value) => {
    todos = Array.isArray(value) ? value : [];
  },
  getSelectedTodoId: () => selectedTodoId,
  setSelectedTodoId: (todoId) => {
    selectedTodoId = todoId ? String(todoId) : null;
  },
  normalizeTodo,
  saveEntries,
  saveTodos,
  cancelPendingAutoSync: () => syncRuntimeModule.cancelPendingAutoSync(),
  isSyncRunning: () => syncRuntimeModule.isSyncRunning(),
  setCalendarSyncStatus,
  clearTodoDetailSubmitState: () => todoDetailModule.clearSubmitState(),
  render,
});

const renderCoordinatorModule = createRenderCoordinatorModule({
  appViews,
  sidebarNavItems,
  settingsQuoteStatus,
  requestAnimationFrameFn: window.requestAnimationFrame.bind(window),
  getEntries: () => entries,
  getCategories: () => categories,
  getCurrentRange: () => currentRange,
  setActiveViewState: (value) => {
    activeView = value;
  },
  syncRangeSwitchButtons,
  getRangeEntries,
  isAnalyzableEntry,
  syncProjectTagLibraries,
  renderHeroQuote: () => settingsModule.renderHeroQuote(),
  renderOverview: (analyzable, categoryList) => overviewModule.render(analyzable, categoryList, { entries, todos }),
  renderCalendar,
  renderTodos,
  renderReview,
  renderCategoryManager: () => settingsModule.renderCategoryManager(),
  renderSyncSettingsControls: () => syncSettingsModule.renderControls(),
  renderQuoteManager: () => settingsModule.renderQuoteManager(),
  renderAiSettings: () => aiSettingsModule.render(),
  syncSearchAfterRender: () => searchModule.syncAfterRender(),
  scheduleFirstScreenPanelFit: () => layoutShellModule.scheduleFirstScreenPanelFit(),
  syncTodoLayout: () => layoutShellModule.syncTodoLayout(),
  closeScoreWheel: () => scoreWheelModule.close(),
  setCalendarNeedsViewportReset: (value) => {
    calendarNeedsViewportReset = Boolean(value);
  },
  syncCalendarCustomScrollbar: () => calendarUiModule.syncCustomScrollbar(),
  getCurrentMotivationQuotes: () => settingsModule.getCurrentMotivationQuotes(),
  setQuoteStatus: (message, tone) => settingsModule.setQuoteStatus(message, tone),
  ensureOptionsLoadedForSettingsView: () => syncSettingsModule.ensureOptionsLoadedForSettingsView(),
  ensureAiSettingsLoadedForSettingsView: () => aiSettingsModule.ensureLoadedForSettingsView(),
  renderTopTodoSyncHub,
  getSelectedTodo,
});

void localDataBackupModule.restoreLatestIfNeeded();

createStartupModule([
  () => settingsModule.initCategoryConfiguration(), () => settingsModule.initRuntimePortConfiguration(),
  () => localDataBackupModule.initRecoveryControls(),
  () => aiSettingsModule.init(),
  () => pomodoroModule.init(), initCalendar, initMacCalendarSync,
  initTodo, initAutoBidirectionalSync, initLayoutState, () => installGuideModule.init(),
  () => internalUpdateModule.init(), bindEvents, render,
  () => setActiveView(activeView), initializeUndoHistory, () => localDataBackupModule.scheduleBackup("startup"),
]).init();

function runOneTimeCacheResetIfNeeded(...args) {
  return dataStoreModule.runOneTimeCacheResetIfNeeded(...args);
}

function getSyncCalendarTargetPayload() {
  return syncSettingsModule.getCalendarTargetPayload();
}

function getSyncReminderTargetPayload() {
  return syncSettingsModule.getReminderTargetPayload();
}

function normalizeTodoReminderDefaultLeadMinutes(value) {
  return todoReminderModule.normalizeDefaultLeadMinutes(value);
}

function getTodoReminderLeadLabel(value) {
  return todoReminderModule.getLeadLabel(value);
}

function getTodoReminderDefaultLeadMinutes() {
  return syncSettingsModule.getReminderDefaultLeadMinutes();
}

function normalizeTodoReminderRepeatValue(value, fallback = "none") {
  return todoReminderModule.normalizeRepeatValue(value, fallback);
}

function parseTodoReminderDateTime(value) {
  return todoReminderModule.parseDateTime(value);
}

function todoUsesExplicitReminderDateTime(todo) {
  return todoReminderModule.usesExplicitDateTime(todo);
}

function isTodoEligibleForReminderSync(todo) {
  return todoReminderModule.isEligibleForSync(todo);
}

function initCalendar() {
  calendarWeekStart = getStartOfWeek(new Date());
  calendarNeedsViewportReset = true;
  closeCalendarEventModal();
  calendarUiModule.renderTimeAxis();
  calendarUiModule.startNowLineTicker();
}

function initTodo() {
  if (!Array.isArray(todos)) {
    todos = [];
    saveTodos(todos);
  }
  const planningChanged = ensureTodoPlanningState();
  const completionState = ensureCompletedTodoEntries();
  if (planningChanged) {
    saveTodos(todos);
  }
  if (completionState.todosChanged && !planningChanged) {
    saveTodos(todos);
  }
  if (completionState.entriesChanged) {
    saveEntries(entries);
  }
  if (!selectedTodoId && todos.length) {
    selectedTodoId = todos[0].id;
  }

  syncTodoHistoryToggleButton();
  syncTodoFilterBarButtons();
}

function initLayoutState() {
  layoutShellModule.init();
}

function bindEvents() {
  if (rangeSwitch) {
    rangeSwitch.addEventListener("click", handleRangeSwitchClick);
  }
  if (reviewRangeSwitch) {
    reviewRangeSwitch.addEventListener("click", handleRangeSwitchClick);
  }
  sidebarTaxonomyModule.bindEvents();
  aiSidebarModule.bindEvents();

  for (const nav of sidebarNavItems) {
    nav.addEventListener("click", () => {
      const view = String(nav.dataset.view || "");
      if (!view) return;
      setActiveView(view);
    });
  }

  searchModule.bindEvents();
  pomodoroModule.bindEvents();
  todoDetailModule.bindEvents();

  if (reviewLegacyToggleBtn) {
    reviewLegacyToggleBtn.addEventListener("click", () => {
      setReviewLegacyVisible(!reviewLegacyVisible);
    });
  }

  if (topSyncRefreshBtn) {
    topSyncRefreshBtn.addEventListener("click", () => {
      triggerTopSyncRefreshSpin();
      void handleTopRefreshSyncAction();
    });
    topSyncRefreshBtn.addEventListener("animationend", (event) => {
      const animationName = typeof event?.animationName === "string" ? event.animationName : "";
      if (animationName !== "sidebar-sync-refresh-spin") return;
      topSyncRefreshBtn.classList.remove("is-spinning");
    });
  }

  settingsModule.bindEvents();
  aiSettingsModule.bindEvents();
  installGuideModule.bindEvents();
  internalUpdateModule.bindEvents();
  syncSettingsModule.bindEvents();
  if (calendarDayColumns) {
    calendarDayColumns.addEventListener("pointerdown", handleCalendarDirectEditPointerDown);

    calendarDayColumns.addEventListener("click", (event) => {
      if (calendarUiModule.shouldSuppressClick()) {
        event.preventDefault();
        return;
      }

      const button = event.target.closest("button[data-id]");
      if (button) {
        const idToken = String(button.dataset.id || "");
        if (!idToken) return;
        deleteCalendarRenderableById(idToken);
        return;
      }

      const eventCard = event.target.closest(".calendar-event[data-id]");
      if (eventCard) {
        const idToken = String(eventCard.dataset.id || "");
        const resolved = findCalendarRenderableById(idToken, calendarUiModule.getRenderEntries());
        if (!resolved) return;
        if (resolved.kind === "todo-plan" && resolved.todo) {
          selectedTodoId = String(resolved.todo.id);
          setActiveView("todo");
          renderTodos();
          return;
        }
        openCalendarEventModal(resolved.entry);
        return;
      }

      const dayColumn = event.target.closest(".calendar-day-column[data-date]");
      if (!dayColumn) return;
      openCalendarCreateModalByClick(dayColumn, event);
    });

    calendarDayColumns.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("button[data-id]")) return;
      const eventCard = target.closest(".calendar-event[data-id]");
      if (!eventCard) return;
      event.preventDefault();

      const idToken = String(eventCard.dataset.id || "");
      const resolved = findCalendarRenderableById(idToken, calendarUiModule.getRenderEntries());
      if (!resolved) return;
      if (resolved.kind === "todo-plan" && resolved.todo) {
        selectedTodoId = String(resolved.todo.id);
        setActiveView("todo");
        renderTodos();
        return;
      }
      openCalendarEventModal(resolved.entry);
    });
  }

  if (syncErrorModal) {
    syncErrorModal.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const closeTarget = event.target.closest("[data-sync-error-close]");
      if (closeTarget) {
        closeSyncErrorModal();
      }
    });
  }
  if (syncErrorCopyBtn) {
    syncErrorCopyBtn.addEventListener("click", () => {
      void handleSyncErrorCopyClick();
    });
  }

  document.addEventListener("keydown", handleSyncErrorModalKeydown);
  document.addEventListener("keydown", handleGlobalUndoKeydown);
  document.addEventListener("keydown", handleGlobalTodoCalendarShortcutKeydown);

  layoutShellModule.bindEvents();
  calendarModalModule.bindEvents({ onSubmit: handleCalendarEventFormSubmit });

  if (calendarPrevWeekBtn) {
    calendarPrevWeekBtn.addEventListener("click", () => {
      calendarWeekStart = addDays(calendarWeekStart, -7);
      calendarNeedsViewportReset = true;
      renderCalendar(entries);
    });
  }

  if (calendarTodayBtn) {
    calendarTodayBtn.addEventListener("click", () => {
      calendarWeekStart = getStartOfWeek(new Date());
      calendarNeedsViewportReset = true;
      renderCalendar(entries);
    });
  }

  if (calendarNextWeekBtn) {
    calendarNextWeekBtn.addEventListener("click", () => {
      calendarWeekStart = addDays(calendarWeekStart, 7);
      calendarNeedsViewportReset = true;
      renderCalendar(entries);
    });
  }

  if (calendarUnratedJumpBtn) {
    calendarUnratedJumpBtn.addEventListener("click", handleCalendarUnratedJump);
  }

  scoreWheelModule.bindGlobalEvents();
  scoreWheelModule.registerRatingInputs([
    pomodoroQualityScoreSlider,
    pomodoroHappinessScoreSlider,
    calendarEventEditQuality,
    calendarEventEditHappiness,
    todoQualityInput,
    todoHappinessInput,
  ]);

  todoListModule.bindEvents();
  if (todoAddButton) {
    todoAddButton.addEventListener("click", handleTodoCreate);
  }

  window.addEventListener("pointermove", handleCalendarDirectEditPointerMove);
  window.addEventListener("pointerup", handleCalendarDirectEditPointerUp);
  window.addEventListener("pointercancel", handleCalendarDirectEditPointerCancel);

  bindCalendarCustomScrollbar();
}

function triggerTopSyncRefreshSpin() {
  if (!topSyncRefreshBtn) return;
  topSyncRefreshBtn.classList.remove("is-spinning");
  // Force reflow so the finite animation can replay on every click.
  void topSyncRefreshBtn.offsetWidth;
  topSyncRefreshBtn.classList.add("is-spinning");
}

function render() {
  renderCoordinatorModule.render();
}

function setActiveView(view) {
  renderCoordinatorModule.setActiveView(view);
}

function syncTodoFilterBarButtons() {
  todoListModule.syncFilterBarButtons();
}

function syncTodoHistoryToggleButton() {
  todoListModule.syncHistoryToggleButton();
}

function requestTodoScrollToTodayGroup() {
  todoListModule.requestScrollToTodayGroup();
}

function getNearestTodoTimeGroupToToday(groupNodes, today) {
  return todoListModule.getNearestTimeGroupToToday
    ? todoListModule.getNearestTimeGroupToToday(groupNodes, today)
    : null;
}

function maybeScrollTodoGroupsToTodayAnchor() {
  todoListModule.maybeScrollToTodayGroup();
}

function handleTodoHistoryToggleClick() {
  todoListModule.handleHistoryToggleClick();
}

function handleTodoRecurringToggleClick() {
  todoListModule.handleRecurringToggleClick();
}

function handleTodoFilterClick(event) {
  todoListModule.handleFilterClick(event);
}

function getLatestTodoSyncedAt() {
  let latestIso = "";
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const todo of todos) {
    const syncedAt = String(todo?.syncedAt || "").trim();
    if (!syncedAt) continue;
    const syncedMs = Date.parse(syncedAt);
    if (!Number.isFinite(syncedMs)) continue;
    if (syncedMs > latestMs) {
      latestMs = syncedMs;
      latestIso = syncedAt;
    }
  }

  return latestIso;
}

async function runManualTopRefreshSync() {
  return await syncRuntimeModule.runManualTopRefreshSync();
}

async function handleTopRefreshSyncAction() {
  return await syncRuntimeModule.handleTopRefreshSyncAction();
}

async function handleTopUploadAction() {
  return await syncRuntimeModule.handleTopUploadAction();
}

async function handleTopPullAction() {
  return await syncRuntimeModule.handleTopPullAction();
}

function clearTodoGroupDragVisualState({ keepDragging = true } = {}) {
  todoListModule.clearDragVisualState({ keepDragging });
}

function getTodoDragTargetMeta(event) {
  return todoListModule.getDragTargetMeta(event);
}

function getTodoDragGroupDate(event) {
  return todoListModule.getDragGroupDate(event);
}

function normalizeTodoDragDropOrder(fromOrder, slotIndex, isSameDate) {
  return todoListModule.normalizeDragDropOrder(fromOrder, slotIndex, isSameDate);
}

function getTodoDragDropOrder(fromOrder, targetMeta, isSameDate) {
  return todoListModule.getDragDropOrder(fromOrder, targetMeta, isSameDate);
}

function getTodoDragDropPayload(event, state) {
  return todoListModule.getDragDropPayload(event, state);
}

function handleTodoGroupDragStart(event) {
  todoListModule.handleGroupDragStart(event);
}

function handleTodoGroupDragOver(event) {
  todoListModule.handleGroupDragOver(event);
}

function handleTodoGroupDrop(event) {
  todoListModule.handleGroupDrop(event);
}

function handleTodoGroupDragEnd() {
  todoListModule.handleGroupDragEnd();
}

function handleTodoGroupDragLeave(event) {
  todoListModule.handleGroupDragLeave(event);
}

function handleTodoGroupClick(event) {
  todoListModule.handleGroupClick(event);
}

function handleSidebarProjectTreeClick(event) {
  sidebarTaxonomyModule.handleProjectTreeClick(event);
}

function handleTodoCreate(...args) {
  return todoActionsModule.handleTodoCreate(...args);
}

function hasSelectedTodoListItem() {
  if (!todoGroups) return false;
  return Boolean(todoGroups.querySelector(".todo-item.is-selected[data-id]"));
}

function handleTodoCreateAfterSelected(...args) {
  return todoActionsModule.handleTodoCreateAfterSelected(...args);
}

function restoreHistoryItemToTodo(...args) {
  return todoActionsModule.restoreHistoryItemToTodo(...args);
}

function handleTodoFocusStart(...args) {
  return todoActionsModule.handleTodoFocusStart(...args);
}

function handleTodoDelete(...args) {
  return todoActionsModule.handleTodoDelete(...args);
}

function deleteTodoByTaskId(...args) {
  return todoActionsModule.deleteTodoByTaskId(...args);
}

function deleteTodoByIndex(...args) {
  return todoActionsModule.deleteTodoByIndex(...args);
}

function buildClockRangeFromStartAndDuration(...args) {
  return todoActionsModule.buildClockRangeFromStartAndDuration(...args);
}

function getDefaultStartMinutesForTodoDate(...args) {
  return todoActionsModule.getDefaultStartMinutesForTodoDate(...args);
}

function resolveTodoTimeInputForSubmit(...args) {
  return todoActionsModule.resolveTodoTimeInputForSubmit(...args);
}

function markTodoDetailDirty() {
  todoDetailModule.markDirty();
}

function hasTodoDetailFormPendingChanges(selected) {
  return todoDetailModule.hasPendingChanges(selected);
}

function commitTodoDetailIfDirty({
  showValidationAlert = true,
  focusInvalidField = true,
  skipRender = false,
} = {}) {
  return todoDetailModule.commitIfDirty({
    showValidationAlert,
    focusInvalidField,
    skipRender,
  });
}

function submitTodoDetailFromForm(...args) {
  return todoActionsModule.submitTodoDetailFromForm(...args);
}

function normalizeTodoCategoryValue(value, fallback = categories[0] || "工作") {
  const text = String(value || "").trim();
  const fallbackText = String(fallback || "").trim();
  if (text && categories.includes(text)) return text;
  if (fallbackText && categories.includes(fallbackText)) return fallbackText;
  return categories[0] || "工作";
}

function getTodoCategory(todo, fallback = categories[0] || "工作") {
  return normalizeTodoCategoryValue(todo?.category, fallback);
}

function normalizeTodoNoteValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text === TODO_NOTE_HELPER_TEXT ? "" : text;
}

function compactTodoNotePreview(value, maxLength = 34) {
  let text = String(value || "");
  if (!text) return "";
  text = text.replace(/\r?\n+/g, " / ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function buildTodoSyncRequest(todo) {
  return syncModule.buildTodoSyncRequest(todo);
}

function buildTodoReminderSyncRequest(todo) {
  return syncModule.buildTodoReminderSyncRequest(todo);
}

function buildTodoReminderCompleteRequest(todo, options = {}) {
  return syncModule.buildTodoReminderCompleteRequest(todo, options);
}

async function syncTodoTasksByLegacyPushApi(taskPayloads) {
  return syncModule.syncTodoTasksByLegacyPushApi(taskPayloads);
}

async function syncTodoTasksToMacCalendar(taskPayloads) {
  return syncModule.syncTodoTasksToMacCalendar(taskPayloads);
}

async function deleteTodoTasksFromMacCalendar(taskPayloads) {
  return syncModule.deleteTodoTasksFromMacCalendar(taskPayloads);
}

function applyTodoTaskSyncItems(items) {
  return syncModule.applyTodoTaskSyncItems(items);
}

async function syncTodoTasksToMacReminders(taskPayloads) {
  return syncModule.syncTodoTasksToMacReminders(taskPayloads);
}

function applyTodoReminderSyncItems(items) {
  return syncModule.applyTodoReminderSyncItems(items);
}

async function completeTodoTasksInMacReminders(taskPayloads) {
  return syncModule.completeTodoTasksInMacReminders(taskPayloads);
}

function applyTodoReminderCompleteItems(items) {
  return syncModule.applyTodoReminderCompleteItems(items);
}

async function pullTodosFromMacCalendar({ manual = false, triggerExport = true } = {}) {
  return syncModule.pullTodosFromMacCalendar({ manual, triggerExport });
}

async function pushCalendarEventPayload(payload) {
  return syncModule.pushCalendarEventPayload(payload);
}

async function pushTodoToMacCalendar({ todo, date, start, end }) {
  return syncModule.pushTodoToMacCalendar({ todo, date, start, end });
}

function buildTodoCalendarNote(todo) {
  return normalizeTodoNoteValue(todo?.note || "");
}

function findEntryIndexByLinkedTodoId(...args) {
  return todoActionsModule.findEntryIndexByLinkedTodoId(...args);
}

function shouldCalendarEntryEditUpdateLinkedTodo(...args) {
  return todoActionsModule.shouldCalendarEntryEditUpdateLinkedTodo(...args);
}

function isRecurringTodoRepeatMode(value) {
  return todoReminderModule.isRecurringRepeat(value);
}

function resolveNextRecurringDueDate(baseDateText, repeatMode) {
  return todoReminderModule.resolveNextRecurringDueDate(baseDateText, repeatMode);
}

function resolveTodoCompletionWindow(...args) {
  return todoActionsModule.resolveTodoCompletionWindow(...args);
}

function appendRecurringTodoCompletionEntry(...args) {
  return todoActionsModule.appendRecurringTodoCompletionEntry(...args);
}

function upsertTodoCompletionEntry(...args) {
  return todoActionsModule.upsertTodoCompletionEntry(...args);
}

function removeTodoCompletionEntry(...args) {
  return todoActionsModule.removeTodoCompletionEntry(...args);
}

function buildTodoCompletionSnapshot(...args) {
  return todoActionsModule.buildTodoCompletionSnapshot(...args);
}

function ensureCompletedTodoEntries(...args) {
  return todoActionsModule.ensureCompletedTodoEntries(...args);
}

function toggleTodoCompleted(...args) {
  return todoActionsModule.toggleTodoCompleted(...args);
}

async function syncRecurringTodoReminderNow(...args) {
  return await todoActionsModule.syncRecurringTodoReminderNow(...args);
}

function renderTodoRowHtml(todo, options = {}) {
  return todoListModule.renderTodoRowHtml(todo, options);
}

function renderTodoHistoryRowHtml(item) {
  return todoListModule.renderTodoHistoryRowHtml(item);
}

function buildTodoProjectTree(todoList = [], historyList = []) {
  return todoListModule.buildProjectTree(todoList, historyList);
}

function renderTodoProjectTreeNode(node, options = {}) {
  return todoListModule.renderProjectTreeNode(node, options);
}

function renderTodoProjectTreeView(todoList = [], historyList = []) {
  todoListModule.renderProjectTreeView(todoList, historyList);
}

function renderTodos() {
  todoListModule.renderTodos();
}

function getTodoHistoryRecords() {
  const records = [];
  const now = new Date();

  for (const entry of entries) {
    const range = buildEntryDateRange(entry.date, entry.start, entry.end);
    if (!range || range.endDate > now) continue;
    records.push({
      key: `entry:${entry.id}`,
      source: "entry",
      title: getEntryDisplayTitle(entry, entry.category || "记录"),
      project: normalizeProjectName(entry.project || entry.category || "记录"),
      tags: normalizeTodoTags(entry.tags || []),
      date: String(entry.date || "").trim(),
      start: String(entry.start || "").trim(),
      end: String(entry.end || "").trim(),
      timestamp: range.endDate.getTime(),
      note: String(entry.note || "").trim(),
      reminder: "",
      quality: Number(entry.quality) || 0,
      happiness: Number(entry.happiness) || 0,
      entryId: String(entry.id),
      todoId: String(entry.linkedTodoId || "").trim(),
    });
  }

  return records;
}

function groupTodoHistoryByDimension(records, dimension) {
  return todoListModule.groupHistoryByDimension(records, dimension);
}

function getTodoHistoryGroupOrder(grouped, dimension) {
  return todoListModule.getHistoryGroupOrder(grouped, dimension);
}

function getTodoHistoryGroupLabel(key, dimension) {
  return todoListModule.getHistoryGroupLabel(key, dimension);
}

function renderTodoHistory() {
  todoListModule.renderHistory();
}

function handleTodoHistoryClick(event) {
  todoListModule.handleHistoryClick(event);
}

function openTodoHistoryRecord(source, id) {
  if (source === "entry") {
    const entry = entries.find((current) => String(current.id) === id);
    if (!entry) return;
    const date = new Date(`${entry.date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      calendarWeekStart = getStartOfWeek(date);
      calendarNeedsViewportReset = true;
    }
    setActiveView("calendar");
    renderCalendar(entries);
    openCalendarEventModal(entry);
    return;
  }

  const todo = todos.find((current) => String(current.id) === id);
  if (!todo) return;
  selectedTodoId = String(todo.id);
  setActiveView("todo");
  renderTodos();
}

function renderTopTodoSyncHub(selected) {
  const syncTarget = selected || null;
  let text = "";
  let tone = "normal";

  const runtimeMessage = syncRuntimeModule.getTopSyncRuntimeMessage();
  if (runtimeMessage) {
    text = runtimeMessage;
    tone = syncRuntimeModule.getTopSyncRuntimeTone() || "normal";
  } else if (syncTarget && activeView === "todo") {
    if (syncTarget.syncState === "conflict") {
      text = "检测到日历冲突：请先确认任务详情，再点击顶部刷新同步。";
      tone = "warning";
    } else if (syncTarget.syncState === "error") {
      text = syncTarget.lastSyncError || "最近一次同步失败，请检查系统权限或时间设置。";
      tone = "danger";
    }
  }

  if (!text) {
    const latestSyncedAt = getLatestTodoSyncedAt();
    const runtimeSyncedAt = syncRuntimeModule.getLastRuntimeSyncCompletedAt();
    const displaySyncedAt = [latestSyncedAt, runtimeSyncedAt]
      .filter(Boolean)
      .sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)))[0];
    if (displaySyncedAt) {
      text = `最近同步：${new Date(displaySyncedAt).toLocaleString("zh-CN", { hour12: false })}`;
      tone = "normal";
    } else {
      text = "最近同步：尚未同步";
      tone = "normal";
    }
  }

  if (todoSyncMessage) {
    todoSyncMessage.textContent = text;
    todoSyncMessage.dataset.tone = tone;
  }
  if (topSyncHub) {
    topSyncHub.hidden = false;
  }
}

function renderTodoDetail() {
  todoDetailModule.renderTodoDetail();
}

function setReviewLegacyVisible(nextVisible) {
  reviewLegacyVisible = Boolean(nextVisible);
  if (reviewLegacySections) {
    reviewLegacySections.hidden = !reviewLegacyVisible;
  }
  if (reviewLegacyToggleBtn) {
    reviewLegacyToggleBtn.setAttribute("aria-pressed", reviewLegacyVisible ? "true" : "false");
    reviewLegacyToggleBtn.classList.toggle("is-active", reviewLegacyVisible);
    reviewLegacyToggleBtn.textContent = reviewLegacyVisible ? "隐藏明细" : "显示明细";
  }
}

function syncRangeSwitchButtons() {
  const switchNodes = [rangeSwitch, reviewRangeSwitch];
  for (const switchNode of switchNodes) {
    if (!switchNode) continue;
    for (const node of switchNode.querySelectorAll("button[data-range]")) {
      node.classList.toggle("active", String(node.dataset.range || "") === currentRange);
    }
  }
}

function handleRangeSwitchClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button[data-range]");
  if (!button) return;
  const nextRange = String(button.dataset.range || "");
  if (!nextRange || currentRange === nextRange) return;
  currentRange = nextRange;
  syncRangeSwitchButtons();
  render();
}

function getReviewEntryDurationHours(entry) {
  if (!entry) return 0;
  const existingDuration = Number(entry.duration);
  if (Number.isFinite(existingDuration) && existingDuration > 0) return existingDuration;
  const computedDuration = calcDurationHours(entry.start, entry.end);
  if (Number.isFinite(computedDuration) && computedDuration > 0) return computedDuration;
  return 0;
}

function buildReviewVisualEntryDataset() {
  return reviewModule.buildReviewVisualEntryDataset();
}

function renderReviewVisualKpis(entryList, analyzableList) {
  return reviewModule.renderReviewVisualKpis(entryList, analyzableList);
}

function renderReviewTrendChart(entryList) {
  return reviewModule.renderReviewTrendChart(entryList);
}

function renderReviewCategoryChart(entryList) {
  return reviewModule.renderReviewCategoryChart(entryList);
}

function renderReviewTimebandChart(entryList) {
  return reviewModule.renderReviewTimebandChart(entryList);
}

function renderReviewMatrixChart(analyzableList) {
  return reviewModule.renderReviewMatrixChart(analyzableList);
}

function renderReviewVisuals() {
  return reviewModule.renderReviewVisuals();
}

function renderReview() {
  return reviewModule.renderReview();
}

function renderReviewDebugTable() {
  return reviewModule.renderReviewDebugTable();
}

function markTodoRecentlyCompletedForDisplay(todoId, snapshot) {
  const id = String(todoId || "").trim();
  if (!id) return;
  const prev = recentlyCompletedTodoDisplayMap.get(id);
  if (prev?.timeoutId) {
    window.clearTimeout(prev.timeoutId);
  }
  const until = Date.now() + TODO_COMPLETION_KEEP_VISIBLE_MS;
  const timeoutId = window.setTimeout(() => {
    const current = recentlyCompletedTodoDisplayMap.get(id);
    if (!current || current.until > Date.now()) return;
    recentlyCompletedTodoDisplayMap.delete(id);
    if (activeView === "todo" && !showTodoHistoryInMainList) {
      renderTodos();
    }
  }, TODO_COMPLETION_KEEP_VISIBLE_MS + 60);
  recentlyCompletedTodoDisplayMap.set(id, {
    until,
    timeoutId,
    snapshot: {
      dueDate: String(snapshot?.dueDate || "").trim(),
      startTime: String(snapshot?.startTime || "").trim(),
      endTime: String(snapshot?.endTime || "").trim(),
      estimatedMinutes: Number.isFinite(Number(snapshot?.estimatedMinutes))
        ? Math.max(5, Math.min(24 * 60, Number(snapshot.estimatedMinutes)))
        : TODO_PLAN_NEW_TODO_DURATION_MINUTES,
      orderInDay: Number.isFinite(Number(snapshot?.orderInDay)) ? Number(snapshot.orderInDay) : null,
    },
  });
}

function clearTodoRecentlyCompletedForDisplay(todoId) {
  const id = String(todoId || "").trim();
  if (!id) return;
  const prev = recentlyCompletedTodoDisplayMap.get(id);
  if (prev?.timeoutId) {
    window.clearTimeout(prev.timeoutId);
  }
  recentlyCompletedTodoDisplayMap.delete(id);
}

function clearAllRecentlyCompletedForDisplay() {
  for (const [id, state] of recentlyCompletedTodoDisplayMap) {
    if (state?.timeoutId) {
      window.clearTimeout(state.timeoutId);
    }
    recentlyCompletedTodoDisplayMap.delete(id);
  }
}

function getTodoRecentlyCompletedDisplayState(todoId, nowMs = Date.now()) {
  const id = String(todoId || "").trim();
  if (!id) return null;
  const state = recentlyCompletedTodoDisplayMap.get(id);
  if (!state) return null;
  if (!Number.isFinite(state.until) || state.until <= nowMs) {
    recentlyCompletedTodoDisplayMap.delete(id);
    return null;
  }
  return state;
}

function pruneRecentlyCompletedTodoDisplayMap(nowMs = Date.now()) {
  for (const [id, state] of recentlyCompletedTodoDisplayMap) {
    if (!state || !Number.isFinite(state.until) || state.until <= nowMs) {
      if (state?.timeoutId) {
        window.clearTimeout(state.timeoutId);
      }
      recentlyCompletedTodoDisplayMap.delete(id);
    }
  }
}

function getVisibleTodos() {
  const nowMs = Date.now();
  pruneRecentlyCompletedTodoDisplayMap(nowMs);
  const includeRecentlyCompleted = !showTodoHistoryInMainList;
  const searchTerm = getGlobalSearchTerm();
  const normalized = todos.map(normalizeTodo);
  const filtered = normalized
    .filter((todo) => {
      if (searchTerm) {
        const haystack = `${todo.title} ${todo.project} ${todo.tags.join(" ")} ${todo.note}`.toLowerCase();
        if (!haystack.includes(searchTerm)) {
          return false;
        }
      }
      if (showRecurringReminderOnlyInMainList && !isRecurringTodoRepeatMode(todo.repeat)) {
        return false;
      }
      if (!todo.completed) return true;
      if (!includeRecentlyCompleted) return false;
      return Boolean(getTodoRecentlyCompletedDisplayState(todo.id, nowMs));
    })
    .map((todo) => {
      if (!todo.completed || !includeRecentlyCompleted) return todo;
      const state = getTodoRecentlyCompletedDisplayState(todo.id, nowMs);
      if (!state) return todo;
      return {
        ...todo,
        __recentlyCompleted: true,
        dueDate: state.snapshot.dueDate,
        startTime: state.snapshot.startTime,
        endTime: state.snapshot.endTime,
        estimatedMinutes: state.snapshot.estimatedMinutes,
        orderInDay: state.snapshot.orderInDay,
      };
    });

  return [...filtered].sort((a, b) => {
    const aDisplayCompleted = Boolean(a.completed && !a.__recentlyCompleted);
    const bDisplayCompleted = Boolean(b.completed && !b.__recentlyCompleted);
    if (aDisplayCompleted !== bDisplayCompleted) return aDisplayCompleted ? 1 : -1;

    const dateA = String(a.dueDate || "9999-12-31");
    const dateB = String(b.dueDate || "9999-12-31");
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    if (!aDisplayCompleted && !bDisplayCompleted) {
      const orderA = Number.isFinite(Number(a.orderInDay)) ? Number(a.orderInDay) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b.orderInDay)) ? Number(b.orderInDay) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
    }

    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function groupTodosByDimension(todoList, dimension) {
  return todoListModule.groupTodosByDimension(todoList, dimension);
}

function getTodoGroupOrder(dimension, grouped) {
  return todoListModule.getTodoGroupOrder(dimension, grouped);
}

function getTodoGroupLabel(key, dimension) {
  return todoListModule.getTodoGroupLabel(key, dimension);
}

function getTodoTimeKey(todo) {
  if (todo.completed && !todo.__recentlyCompleted) return "done";
  if (!todo.dueDate) return "unscheduled";
  return `date:${todo.dueDate}`;
}

function buildTodoDueBadge(todo) {
  return todoListModule.buildDueBadge(todo);
}

function buildTodoSyncBadge(todo) {
  return todoListModule.buildSyncBadge(todo);
}

function getSelectedTodo() {
  if (!selectedTodoId) return null;
  return todos.find((item) => String(item.id) === String(selectedTodoId)) || null;
}

function collectTodoFormInput({ fallbackTodo = null, lenientRequired = false } = {}) {
  return todoDetailModule.collectFormInput({ fallbackTodo, lenientRequired });
}

function createDefaultTodos(...args) {
  return todoModelModule.createDefaultTodos(...args);
}

function createTodoDraft(...args) {
  return todoModelModule.createTodoDraft(...args);
}

function normalizeTodoSyncState(...args) {
  return todoModelModule.normalizeTodoSyncState(...args);
}

function normalizeTodoReminderSyncState(...args) {
  return todoModelModule.normalizeTodoReminderSyncState(...args);
}

function normalizeTodo(...args) {
  return todoModelModule.normalizeTodo(...args);
}

function normalizeTodoTags(...args) {
  return todoModelModule.normalizeTodoTags(...args);
}

function normalizeProjectSegmentName(...args) {
  return todoModelModule.normalizeProjectSegmentName(...args);
}

function shouldSplitProjectByHyphenShortcut(...args) {
  return todoModelModule.shouldSplitProjectByHyphenShortcut(...args);
}

function splitProjectNameToSegments(...args) {
  return todoModelModule.splitProjectNameToSegments(...args);
}

function buildProjectPathFromSegments(...args) {
  return todoModelModule.buildProjectPathFromSegments(...args);
}

function normalizeProjectName(...args) {
  return todoModelModule.normalizeProjectName(...args);
}

function getProjectPathSegments(...args) {
  return todoModelModule.getProjectPathSegments(...args);
}

function getProjectRootName(...args) {
  return todoModelModule.getProjectRootName(...args);
}

function extractEntryProjectFromNote(note) {
  return sidebarTaxonomyModule.extractEntryProjectFromNote(note);
}

function extractEntryTagsFromNote(note) {
  return sidebarTaxonomyModule.extractEntryTagsFromNote(note);
}

function getEntryProjectForLibrary(entry) {
  return sidebarTaxonomyModule.getEntryProjectForLibrary(entry);
}

function getEntryTagsForLibrary(entry) {
  return sidebarTaxonomyModule.getEntryTagsForLibrary(entry);
}

function normalizeSidebarTaxonomyRange(value) {
  return sidebarTaxonomyModule.normalizeRange(value);
}

function loadSidebarTaxonomyRange() {
  return sidebarTaxonomyModule.loadRange();
}

function saveSidebarTaxonomyRange(value) {
  sidebarTaxonomyModule.saveRange(value);
}

function getSidebarTaxonomyRangeBounds(rangeValue) {
  return sidebarTaxonomyModule.getRangeBounds(rangeValue);
}

function isDateInSidebarTaxonomyRange(dateText, rangeValue) {
  return sidebarTaxonomyModule.isDateInRange(dateText, rangeValue);
}

function shouldIncludeTodoInProjectTagLibrary(todo, rangeValue = "all") {
  return sidebarTaxonomyModule.shouldIncludeTodo(todo, rangeValue);
}

function shouldIncludeEntryInProjectTagLibrary(entry, rangeValue = "all") {
  return sidebarTaxonomyModule.shouldIncludeEntry(entry, rangeValue);
}

function syncSidebarTaxonomyRangeButtons() {
  sidebarTaxonomyModule.syncRangeButtons();
}

function handleSidebarTaxonomyRangeClick(event) {
  sidebarTaxonomyModule.handleRangeClick(event);
}

function collectProjectTagLibraries(options = {}) {
  return sidebarTaxonomyModule.collectProjectTagLibraries(options);
}

function buildProjectTreeFromCountMap(projectCountMap) {
  return sidebarTaxonomyModule.buildProjectTreeFromCountMap(projectCountMap);
}

function renderSidebarProjectTagLibraries() {
  sidebarTaxonomyModule.render();
}

function renderProjectTagSuggestions() {
  todoDetailModule.renderProjectTagSuggestions();
}

function updateTodoProjectSuggestionOptions(rawInput = "", { forceShow = false } = {}) {
  return todoDetailModule.updateTodoProjectSuggestionOptions(rawInput, { forceShow });
}

function updateTodoTagSuggestionOptions(rawInput = "", { forceShow = false } = {}) {
  return todoDetailModule.updateTodoTagSuggestionOptions(rawInput, { forceShow });
}

function syncProjectTagLibraries() {
  sidebarTaxonomyModule.syncProjectTagLibraries();
}

function getResolvedTodoCategoryValue() {
  return todoDetailModule.getResolvedTodoCategoryValue();
}

function syncTodoCategoryTriggerLabel() {
  return todoDetailModule.syncTodoCategoryTriggerLabel();
}

function isTodoCategorySuggestionMenuOpen() {
  return todoDetailModule.isTodoCategorySuggestionMenuOpen();
}

function getTodoRepeatOptions() {
  return todoDetailModule.getTodoRepeatOptions();
}

function getResolvedTodoRepeatValue() {
  return todoDetailModule.getResolvedTodoRepeatValue();
}

function syncTodoRepeatTriggerLabel() {
  return todoDetailModule.syncTodoRepeatTriggerLabel();
}

function isTodoPlanLockControlEnabled() {
  return todoDetailModule.isTodoPlanLockControlEnabled();
}

function setTodoPlanLockControlEnabled(locked) {
  return todoDetailModule.setTodoPlanLockControlEnabled(locked);
}

function syncTodoPlanLockControlByRepeatSelection() {
  return todoDetailModule.syncTodoPlanLockControlByRepeatSelection();
}

function isTodoRepeatSuggestionMenuOpen() {
  return todoDetailModule.isTodoRepeatSuggestionMenuOpen();
}

function isTodoProjectSuggestionMenuOpen() {
  return todoDetailModule.isTodoProjectSuggestionMenuOpen();
}

function isTodoTagSuggestionMenuOpen() {
  return todoDetailModule.isTodoTagSuggestionMenuOpen();
}

function hideTodoProjectSuggestionMenu() {
  return todoDetailModule.hideTodoProjectSuggestionMenu();
}

function hideTodoTagSuggestionMenu() {
  return todoDetailModule.hideTodoTagSuggestionMenu();
}

function hideTodoCategorySuggestionMenu() {
  return todoDetailModule.hideTodoCategorySuggestionMenu();
}

function hideTodoRepeatSuggestionMenu() {
  return todoDetailModule.hideTodoRepeatSuggestionMenu();
}

function updateTodoCategorySuggestionOptions({ forceShow = false } = {}) {
  return todoDetailModule.updateTodoCategorySuggestionOptions({ forceShow });
}

function updateTodoRepeatSuggestionOptions({ forceShow = false } = {}) {
  return todoDetailModule.updateTodoRepeatSuggestionOptions({ forceShow });
}

function normalizeTodoCalendarDeleteItem(raw) {
  return syncModule.normalizeTodoCalendarDeleteItem(raw);
}

function loadTodoCalendarDeleteQueue() {
  return syncModule.loadTodoCalendarDeleteQueue();
}

function saveTodoCalendarDeleteQueue(value) {
  return syncModule.saveTodoCalendarDeleteQueue(value);
}

function enqueueTodoCalendarDelete(todo, timestampIso = new Date().toISOString()) {
  return syncModule.enqueueTodoCalendarDelete(todo, timestampIso);
}

function buildTodoDeleteSyncRequests() {
  return syncModule.buildTodoDeleteSyncRequests();
}

function applyTodoTaskDeleteSyncItems(items) {
  return syncModule.applyTodoTaskDeleteSyncItems(items);
}

function normalizeTodoReminderDisableItem(...args) {
  return dataStoreModule.normalizeTodoReminderDisableItem(...args);
}

function loadTodoReminderDisableQueue(...args) {
  return dataStoreModule.loadTodoReminderDisableQueue(...args);
}

function saveTodoReminderDisableQueue(...args) {
  return dataStoreModule.saveTodoReminderDisableQueue(...args);
}

function enqueueTodoReminderDisable(...args) {
  return dataStoreModule.enqueueTodoReminderDisable(...args);
}

function buildTodoReminderDisableSyncRequestsFromQueue(...args) {
  return syncModule.buildTodoReminderDisableSyncRequestsFromQueue(...args);
}

function applyQueuedTodoReminderDisableSyncItems(...args) {
  return syncModule.applyQueuedTodoReminderDisableSyncItems(...args);
}

function getUndoRuntimeModule() {
  if (!undoRuntimeModule) {
    throw new Error("Undo runtime module is not initialized.");
  }
  return undoRuntimeModule;
}

function initializeUndoHistory(...args) {
  return getUndoRuntimeModule().initializeUndoHistory(...args);
}

function commitUndoSnapshot(...args) {
  if (!undoRuntimeModule) return;
  return undoRuntimeModule.commitUndoSnapshot(...args);
}

function isApplyingUndoActive(...args) {
  if (!undoRuntimeModule) return false;
  return undoRuntimeModule.isApplyingUndo(...args);
}

function isNativeUndoEditableTarget(...args) {
  return getUndoRuntimeModule().isNativeUndoEditableTarget(...args);
}

function handleGlobalUndoKeydown(...args) {
  return getUndoRuntimeModule().handleGlobalUndoKeydown(...args);
}

function loadTodos(...args) {
  return dataStoreModule.loadTodos(...args);
}

function loadCollapsedProjectPathSet(...args) {
  return dataStoreModule.loadCollapsedProjectPathSet(...args);
}

function saveCollapsedProjectPathSet(...args) {
  return dataStoreModule.saveCollapsedProjectPathSet(...args);
}

function toggleCollapsedProjectPath(...args) {
  return dataStoreModule.toggleCollapsedProjectPath(...args);
}

function isProjectPathDescendant(path, ancestorPath) {
  const normalizedPath = normalizeProjectName(path);
  const normalizedAncestor = normalizeProjectName(ancestorPath);
  if (!normalizedPath || !normalizedAncestor) return false;
  if (normalizedPath === normalizedAncestor) return false;
  return normalizedPath.startsWith(`${normalizedAncestor}${TODO_PROJECT_LEVEL_SEPARATOR}`);
}

function isProjectPathHiddenByCollapsed(path, collapsedSet) {
  const normalizedPath = normalizeProjectName(path);
  if (!normalizedPath || !(collapsedSet instanceof Set) || !collapsedSet.size) return false;
  for (const collapsedPath of collapsedSet) {
    if (isProjectPathDescendant(normalizedPath, collapsedPath)) return true;
  }
  return false;
}

function saveTodos(...args) {
  return dataStoreModule.saveTodos(...args);
}

function loadSidebarWidth(...args) {
  return dataStoreModule.loadSidebarWidth(...args);
}

function saveSidebarWidth(...args) {
  return dataStoreModule.saveSidebarWidth(...args);
}

function clampSidebarWidth(...args) {
  return dataStoreModule.clampSidebarWidth(...args);
}

function loadSidebarCollapsed(...args) {
  return dataStoreModule.loadSidebarCollapsed(...args);
}

function saveSidebarCollapsed(...args) {
  return dataStoreModule.saveSidebarCollapsed(...args);
}

function loadTodoDetailWidth(...args) {
  return dataStoreModule.loadTodoDetailWidth(...args);
}

function saveTodoDetailWidth(...args) {
  return dataStoreModule.saveTodoDetailWidth(...args);
}

function clampTodoDetailWidth(...args) {
  return dataStoreModule.clampTodoDetailWidth(...args);
}

function addMinutesToClock(baseClock, minutesToAdd) {
  const [hText, mText] = String(baseClock || "09:00").split(":");
  const hours = Number.parseInt(hText, 10);
  const minutes = Number.parseInt(mText, 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return "10:00";
  }

  const total = hours * 60 + minutes + Math.max(1, Number(minutesToAdd) || 0);
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  return formatMinutesForInput(clamped);
}

function getTodoClockRange(todo) {
  return todoPlanModule.getTodoClockRange(todo);
}

function getTodoDurationMinutes(todo, fallbackMinutes = TODO_PLAN_DAY_NEXT_DURATION_MINUTES) {
  return todoPlanModule.getTodoDurationMinutes(todo, fallbackMinutes);
}

function setTodoRangeByStartAndDuration(todo, startMinutes, durationMinutes) {
  return todoPlanModule.setTodoRangeByStartAndDuration(todo, startMinutes, durationMinutes);
}

function sortTodosByDayOrder(list) {
  return todoPlanModule.sortTodosByDayOrder(list);
}

function getIncompleteTodosByDate(date) {
  return todoPlanModule.getIncompleteTodosByDate(date);
}

function normalizeTodoOrderForDate(date) {
  return todoPlanModule.normalizeTodoOrderForDate(date);
}

function normalizeTodoOrderByClockForDate(date) {
  return todoPlanModule.normalizeTodoOrderByClockForDate(date);
}

function getNextTodoOrderForDate(date, excludedTodoId = null) {
  return todoPlanModule.getNextTodoOrderForDate(date, excludedTodoId);
}

function markTodoPlanningDirty(todo, timestampIso = new Date().toISOString()) {
  return todoPlanModule.markTodoPlanningDirty(todo, timestampIso);
}

function reflowTodoDayFromStart(date, options = {}) {
  return todoPlanModule.reflowTodoDayFromStart(date, options);
}

function reflowTodoDayAfterAnchor(date, anchorTodoId, options = {}) {
  return todoPlanModule.reflowTodoDayAfterAnchor(date, anchorTodoId, options);
}

function reflowTodoDayFromIndex(date, startIndex, options = {}) {
  return todoPlanModule.reflowTodoDayFromIndex(date, startIndex, options);
}

function assignScheduleForNewTodo(todo) {
  return todoPlanModule.assignScheduleForNewTodo(todo);
}

function ensureTodoPlanningState() {
  return todoPlanModule.ensureTodoPlanningState();
}

function getTodoIdFromPlanEntryId(entryId) {
  return todoPlanModule.getTodoIdFromPlanEntryId(entryId);
}

function createTodoPlanEntry(todo) {
  return todoPlanModule.createTodoPlanEntry(todo);
}

function getPendingTodoCalendarEntries() {
  return todoPlanModule.getPendingTodoCalendarEntries();
}

function mergeCalendarEntriesWithTodoPlans(baseEntries) {
  return todoPlanModule.mergeCalendarEntriesWithTodoPlans(baseEntries);
}

function getCalendarRenderEntries(baseEntries = entries) {
  return mergeCalendarEntriesWithTodoPlans(baseEntries);
}

function findCalendarRenderableById(idToken, baseEntries = entries) {
  const id = String(idToken || "");
  if (!id) return null;

  const todoIdFromPlan = getTodoIdFromPlanEntryId(id);
  if (todoIdFromPlan) {
    const todo = todos.find((item) => String(item.id) === todoIdFromPlan);
    if (!todo) return null;
    const plan = createTodoPlanEntry(todo);
    if (!plan) return null;
    return {
      kind: "todo-plan",
      entry: plan,
      todo,
    };
  }

  const source = Array.isArray(baseEntries) ? baseEntries : entries;
  const match = source.find((item) => String(item.id) === id);
  if (match) {
    if (match.todoPending) {
      const todoId = String(match.linkedTodoId || "");
      const todo = todos.find((item) => String(item.id) === todoId);
      return {
        kind: "todo-plan",
        entry: match,
        todo: todo || null,
      };
    }
    return {
      kind: "entry",
      entry: match,
      todo: null,
    };
  }

  const persisted = entries.find((item) => String(item.id) === id);
  if (!persisted) return null;
  return {
    kind: "entry",
    entry: persisted,
    todo: null,
  };
}

function findOverlappingCalendarItem(date, start, end, excludedId = null) {
  return todoPlanModule.findOverlappingCalendarItem(date, start, end, excludedId);
}

function moveTodoOrder(todoId, direction) {
  return todoPlanModule.moveTodoOrder(todoId, direction);
}

function moveTodoToOrder(todoId, nextOrderInDay) {
  return todoPlanModule.moveTodoToOrder(todoId, nextOrderInDay);
}

function moveTodoToDateOrder(todoId, nextDueDate, nextOrderInDay) {
  return todoPlanModule.moveTodoToDateOrder(todoId, nextDueDate, nextOrderInDay);
}

function isImportedExternalEntry(entry) {
  return entry && entry.source === EXTERNAL_CALENDAR_SOURCE && entry.externalId;
}

function isAnalyzableEntry(entry) {
  if (!entry || entry.needsReview) return false;
  if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
  const quality = Number(entry.quality);
  const happiness = Number(entry.happiness);
  return quality >= 1 && quality <= 10 && happiness >= 1 && happiness <= 10;
}

function formatScoreLabel(value, emptyLabel = "--") {
  const parsed = parseOptionalScore(value);
  return parsed === null ? emptyLabel : String(parsed);
}

function formatTodoDurationMinutesLabel(durationMinutes) {
  const safeMinutes = Math.max(5, Math.min(24 * 60, Number.parseInt(String(durationMinutes || 0), 10) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours <= 0) return `${safeMinutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

function formatTodoReminderRepeatLabel(value) {
  return todoReminderModule.formatRepeatLabel(value);
}

function resolveTodoReminderDisplayClock(reminderValue, startTimeValue = "") {
  return todoReminderModule.resolveDisplayClock(reminderValue, startTimeValue);
}

function formatTodoReminderLabel(reminderValue, repeatValue = "none", options = {}) {
  return todoReminderModule.formatLabel(reminderValue, repeatValue, options);
}

function normalizeScoreForInput(value) {
  const parsed = parseOptionalScore(value);
  return parsed === null ? DEFAULT_SCORE : parsed;
}

function normalizeEntryTitle(value, fallback = "记录") {
  const safeFallback = String(fallback || "").trim() || "记录";
  const text = String(value || "").trim();
  return (text || safeFallback).slice(0, 80);
}

function inferLegacyEntryTitle(entry) {
  if (!entry) return "";
  const note = String(entry.note || "").trim();
  if (!note) return "";

  if (note.startsWith("[待办同步]")) {
    const todoTitle = note.replace("[待办同步]", "").trim();
    if (todoTitle) return todoTitle;
  }

  if (note.includes("番茄钟专注完成")) {
    const category = String(entry.category || categories[0] || "工作").trim() || "工作";
    return `番茄钟：${category}`;
  }

  return "";
}

function getEntryDisplayTitle(entry, fallback = "记录") {
  if (!entry) return normalizeEntryTitle("", fallback);
  const raw = entry.title || entry.externalTitle || inferLegacyEntryTitle(entry) || entry.category || "";
  return normalizeEntryTitle(raw, fallback);
}

function getCalendarEventModalTitleValue(...args) {
  return calendarModalModule.getTitleValue(...args);
}

function isCalendarModalScoreLockedForEntry(...args) {
  return calendarModalModule.isEntryScoreLocked(...args);
}

function setCalendarSyncStatus(message, tone = "normal") {
  return syncRuntimeModule.setCalendarSyncStatus(message, tone);
}

function normalizeSyncErrorDetail(message) {
  return syncRuntimeModule.normalizeSyncErrorDetail(message);
}

async function copyTextToClipboard(text) {
  return await syncRuntimeModule.copyTextToClipboard(text);
}

function closeSyncErrorModal() {
  return syncRuntimeModule.closeSyncErrorModal();
}

async function showSyncErrorDetails(rawMessage, title = "同步失败") {
  return await syncRuntimeModule.showSyncErrorDetails(rawMessage, title);
}

async function handleSyncErrorCopyClick() {
  return await syncRuntimeModule.handleSyncErrorCopyClick();
}

function initMacCalendarSync() {
  return syncRuntimeModule.initMacCalendarSync();
}

function initAutoBidirectionalSync() {
  return syncRuntimeModule.initAutoBidirectionalSync();
}

function scheduleAutoBidirectionalSync(reason = "change", delayMs = AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS) {
  return syncRuntimeModule.scheduleAutoBidirectionalSync(reason, delayMs);
}

function collectDirtyTodoSyncWork() {
  return syncRuntimeModule.collectDirtyTodoSyncWork();
}

async function runAutoBidirectionalSync(reason = "auto") {
  return await syncRuntimeModule.runAutoBidirectionalSync(reason);
}

async function triggerMacCalendarExportOnce() {
  return await syncRuntimeModule.triggerMacCalendarExportOnce();
}

async function syncMacCalendarEvents({ manual = false, triggerExport = false } = {}) {
  return await syncRuntimeModule.syncMacCalendarEvents({ manual, triggerExport });
}

function normalizeExternalCalendarPayload(payload, targetCalendar = syncSettingsModule.getCalendarTarget()) {
  return syncRuntimeModule.normalizeExternalCalendarPayload(payload, targetCalendar);
}

function extractTimeQualityTaskIdFromUrl(urlText) {
  return syncRuntimeModule.extractTimeQualityTaskIdFromUrl(urlText);
}

function hasTimeQualityMetaUrl(urlText) {
  return syncRuntimeModule.hasTimeQualityMetaUrl(urlText);
}

function extractTimeQualityTaskIdFromNote(noteText, urlText = "") {
  return syncRuntimeModule.extractTimeQualityTaskIdFromNote(noteText, urlText);
}

function normalizeExternalCalendarGroupValue(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function isEventInSyncCalendarTarget(event, targetCalendar = syncSettingsModule.getCalendarTarget()) {
  return syncRuntimeModule.isEventInSyncCalendarTarget(event, targetCalendar);
}

function findTodoByExternalCalendarId(externalId) {
  return syncRuntimeModule.findTodoByExternalCalendarId(externalId);
}

function hasDirtyLocalChanges(todo) {
  return syncRuntimeModule.hasDirtyLocalChanges(todo);
}

function isExternalEventEligibleForAutoTodo(imported, nowDate = new Date()) {
  return syncRuntimeModule.isExternalEventEligibleForAutoTodo(imported, nowDate);
}

function syncFutureExternalEventsToTodos(importedEvents) {
  return syncRuntimeModule.syncFutureExternalEventsToTodos(importedEvents);
}

function normalizeExternalCalendarEvent(rawEvent) {
  return syncRuntimeModule.normalizeExternalCalendarEvent(rawEvent);
}

function mapExternalCalendarCategory(rawEvent) {
  return syncRuntimeModule.mapExternalCalendarCategory(rawEvent);
}

function parseExternalDateValue(value) {
  return syncRuntimeModule.parseExternalDateValue(value);
}

function parseExternalDateAndTime(rawDate, rawTime) {
  return syncRuntimeModule.parseExternalDateAndTime(rawDate, rawTime);
}

function applyImportedCalendarEvents(importedEvents) {
  return syncRuntimeModule.applyImportedCalendarEvents(importedEvents);
}

function isSameImportedSnapshot(prev, next) {
  return syncRuntimeModule.isSameImportedSnapshot(prev, next);
}

function createImportedCalendarEntry(imported) {
  return syncRuntimeModule.createImportedCalendarEntry(imported);
}

function createUniqueEntryId() {
  let id = Date.now() + Math.floor(Math.random() * 1000);
  while (entries.some((item) => String(item.id) === String(id))) {
    id += 1;
  }
  return id;
}

function loadIgnoredExternalCalendarIds(...args) {
  return dataStoreModule.loadIgnoredExternalCalendarIds(...args);
}

function saveIgnoredExternalCalendarIds(...args) {
  return dataStoreModule.saveIgnoredExternalCalendarIds(...args);
}

function bindCalendarCustomScrollbar() {
  calendarUiModule.bindCustomScrollbar();
}

function getCalendarScrollbarMetrics() {
  return calendarUiModule.getScrollbarMetrics();
}

function syncCalendarCustomScrollbar() {
  calendarUiModule.syncCustomScrollbar();
}

function setCalendarScrollTopByThumbTop(rawThumbTop) {
  calendarUiModule.setScrollTopByThumbTop(rawThumbTop);
}

function bindCalendarScrollbarOnlyInteraction() {
  calendarUiModule.bindScrollbarOnlyInteraction();
}

function doesCalendarEntryMatchSearch(entry, keyword = getGlobalSearchTerm()) {
  const term = String(keyword || "").trim().toLowerCase();
  if (!term) return true;
  if (!entry) return false;
  const title = getEntryDisplayTitle(entry, entry.category || "记录");
  const category = String(entry.category || "");
  const note = String(entry.note || "");
  const date = String(entry.date || "");
  const start = String(entry.start || "");
  const end = String(entry.end || "");
  const project = normalizeProjectName(entry.project || "");
  const tags = Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
  const haystack = `${title} ${category} ${note} ${project} ${tags} ${date} ${start} ${end}`.toLowerCase();
  return haystack.includes(term);
}

function getUnratedCalendarEntries(baseEntries = entries) {
  return calendarUiModule.getUnratedEntries(baseEntries);
}

function getCalendarUnratedTargetDate(unratedEntries) {
  return calendarUiModule.getUnratedTargetDate(unratedEntries);
}

function renderCalendarUnratedJumpButton() {
  calendarUiModule.renderUnratedJumpButton();
}

function handleCalendarUnratedJump() {
  calendarUiModule.handleUnratedJump();
}

function renderCalendarTimeAxis() {
  calendarUiModule.renderTimeAxis();
}

function renderCalendar(allEntries) {
  calendarUiModule.render(allEntries);
}

function renderCalendarNowLine(weekDates = getWeekDates(calendarWeekStart), hourHeight = getCalendarHourHeight()) {
  calendarUiModule.renderNowLine(weekDates, hourHeight);
}

function startCalendarNowLineTicker() {
  calendarUiModule.startNowLineTicker();
}

function renderCalendarWeekdays(weekDates) {
  calendarUiModule.renderWeekdays(weekDates);
}

function openCalendarCreateModalByClick(dayColumn, event) {
  calendarModalModule.openCreateByClick(dayColumn, event);
}

function openCalendarEventModal(entry) {
  calendarModalModule.openEvent(entry);
}

function closeCalendarEventModal() {
  calendarModalModule.close();
}

function getFocusedCalendarRenderableId() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof Element)) return "";
  const eventCard = activeElement.closest(".calendar-event[data-id]");
  if (!eventCard) return "";
  if (calendarDayColumns && !calendarDayColumns.contains(eventCard)) return "";
  return String(eventCard.dataset.id || "").trim();
}

function deleteCalendarRenderableById(...args) {
  return calendarActionsModule.deleteCalendarRenderableById(...args);
}

function handleCalendarDirectEditPointerDown(event) {
  calendarUiModule.handleDirectEditPointerDown(event);
}

function handleCalendarDirectEditPointerMove(event) {
  calendarUiModule.handleDirectEditPointerMove(event);
}

function handleCalendarDirectEditPointerUp(event) {
  calendarUiModule.handleDirectEditPointerUp(event);
}

function handleCalendarDirectEditPointerCancel(event) {
  calendarUiModule.handleDirectEditPointerCancel(event);
}

function commitCalendarDirectEditDraft(...args) {
  return calendarActionsModule.commitCalendarDirectEditDraft(...args);
}

function handleCalendarEventFormSubmit(...args) {
  return calendarActionsModule.handleCalendarEventFormSubmit(...args);
}

function handleSyncErrorModalKeydown(event) {
  if (event.key !== "Escape" || !syncErrorModal || syncErrorModal.hidden) return;
  event.preventDefault();
  closeSyncErrorModal();
}

function isDeleteShortcutKey(event) {
  const key = String(event?.key || "");
  return key === "Delete" || key === "Backspace";
}

function isInteractiveShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a[href], input, select, textarea, summary, details, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  );
}

function isTodoListShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  if (todoGroups && todoGroups.contains(target)) return true;
  return target === document.body || target === document.documentElement;
}

function handleGlobalTodoCalendarShortcutKeydown(event) {
  if (event.defaultPrevented) return;
  if (event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  if (isNativeUndoEditableTarget(target)) return;
  if (syncRuntimeModule.isSyncRunning()) return;

  if (event.key === "Enter" && !event.shiftKey && activeView === "todo") {
    if (isInteractiveShortcutTarget(target)) return;
    if (!isTodoListShortcutTarget(target)) return;
    if (!hasSelectedTodoListItem()) return;
    event.preventDefault();
    handleTodoCreateAfterSelected();
    return;
  }

  if (!isDeleteShortcutKey(event) || event.shiftKey) return;

  if (activeView === "todo") {
    if (isInteractiveShortcutTarget(target)) return;
    if (!isTodoListShortcutTarget(target)) return;
    if (!hasSelectedTodoListItem()) return;
    event.preventDefault();
    handleTodoDelete();
    return;
  }

  if (activeView !== "calendar") return;
  if (calendarUiModule.isDirectEditing()) return;

  const isCalendarModalOpen = Boolean(calendarEventModal && !calendarEventModal.hidden);
  if (isCalendarModalOpen && isInteractiveShortcutTarget(target)) return;
  const targetId = isCalendarModalOpen
    ? String(editingCalendarEntryId || "").trim()
    : getFocusedCalendarRenderableId();
  if (!targetId) return;

  event.preventDefault();
  deleteCalendarRenderableById(targetId, { closeModal: isCalendarModalOpen });
}

function updateBodyModalState() {
  const isPomodoroOpen = Boolean(pomodoroScoreModal && !pomodoroScoreModal.hidden);
  const isCalendarOpen = Boolean(calendarEventModal && !calendarEventModal.hidden);
  const isSyncErrorOpen = Boolean(syncErrorModal && !syncErrorModal.hidden);
  document.body.classList.toggle("modal-open", isPomodoroOpen || isCalendarOpen || isSyncErrorOpen);
}

function createCalendarEventNode(segment, hourHeight) {
  return calendarUiModule.createEventNode(segment, hourHeight);
}

function getEventColorTokens(entry) {
  return calendarUiModule.getEventColorTokens(entry);
}

function layoutDaySegments(segments) {
  return calendarUiModule.layoutDaySegments(segments);
}

function splitEntryIntoDaySegments(entry) {
  return calendarUiModule.splitEntryIntoDaySegments(entry);
}

function addEntry(...args) {
  return calendarActionsModule.addEntry(...args);
}

function ensureCalendarSamplesForDay16(...args) {
  return calendarSamplesModule.ensureCalendarSamplesForDay16(...args);
}

function resolveSampleDay16Date(...args) {
  return calendarSamplesModule.resolveSampleDay16Date(...args);
}

function isCalendarSample16Entry(...args) {
  return calendarSamplesModule.isCalendarSample16Entry(...args);
}

function isCalendarSample16Todo(...args) {
  return calendarSamplesModule.isCalendarSample16Todo(...args);
}

function loadEntries(...args) {
  return dataStoreModule.loadEntries(...args);
}

function saveEntries(...args) {
  return dataStoreModule.saveEntries(...args);
}

 

function validateEntryInput(...args) {
  return calendarActionsModule.validateEntryInput(...args);
}

function buildEntryDateRange(date, start, end) {
  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  if (endDate <= startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  return { startDate, endDate };
}

function isEntryNotEditableYet(entry) {
  if (!entry) return false;
  const range = buildEntryDateRange(entry.date, entry.start, entry.end);
  if (!range) return false;
  return range.endDate > new Date();
}

function isLockedTodoPlanEntry(...args) {
  return calendarActionsModule.isLockedTodoPlanEntry(...args);
}

function canDirectEditEntry(...args) {
  return calendarActionsModule.canDirectEditEntry(...args);
}

function findOverlappingEntry(...args) {
  return calendarActionsModule.findOverlappingEntry(...args);
}

function getOverlapMessage(...args) {
  return calendarActionsModule.getOverlapMessage(...args);
}

function getRangeEntries(allEntries, range) {
  if (range === "all") return allEntries;

  const days = Number(range);
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  return allEntries.filter((item) => {
    const date = new Date(`${item.date}T00:00:00`);
    return date >= start && date <= now;
  });
}

function sumBy(list, getter) {
  return list.reduce((sum, item) => sum + getter(item), 0);
}

function completeLinkedTodoByPomodoroSession(todo, scoreResult, sessionRange) {
  return pomodoroTodoLinkModule.completeLinkedTodoByPomodoroSession(todo, scoreResult, sessionRange);
}

function recordLinkedTodoPomodoroSession(todo, scoreResult, sessionRange) {
  return pomodoroTodoLinkModule.recordLinkedTodoPomodoroSession(todo, scoreResult, sessionRange);
}

function savePomodoroEntry(...args) {
  return calendarActionsModule.savePomodoroEntry(...args);
}

function formatCalendarRange(start, end) {
  return calendarUiModule.formatRange(start, end);
}

function getCalendarHourHeight() {
  return calendarUiModule.getHourHeight();
}

function roundToStep(value, step) {
  return calendarUiModule.roundToStep(value, step);
}

function getCalendarDayIndexByClientX(clientX) {
  return calendarUiModule.getDayIndexByClientX(clientX);
}

function getCalendarDayIndexByDateKey(dayKey) {
  return calendarUiModule.getDayIndexByDateKey(dayKey);
}

function getDefaultCalendarMinutesByClick(dayColumn, event) {
  return calendarUiModule.getDefaultMinutesByClick(dayColumn, event);
}

function setCalendarDefaultViewport() {
  calendarUiModule.setDefaultViewport();
}

function getTodayDateInputValue() {
  return formatDateForInput(new Date());
}

function getCurrentClockMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function formatDate(date) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return DATE_FORMATTER.format(d);
}

function escapeCssAttributeSelectorValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
