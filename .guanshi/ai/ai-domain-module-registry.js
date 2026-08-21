"use strict";

const DOMAIN_MODULE_MANIFEST_SCHEMA = "guanshi-domain-module-manifest-v1";
const DOMAIN_MODULE_LIST_SCHEMA = "guanshi-domain-module-list-v1";
const DOMAIN_MODULE_TOOL_LIST_SCHEMA = "guanshi-domain-module-tool-list-v1";
const AI_ACTION_REGISTRY_BUNDLE_SCHEMA = "guanshi-ai-action-registry-bundle-v1";

const MODULE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]{1,80}$/;
const REGISTRY_ID_PATTERNS = {
  action_registry: TOOL_ID_PATTERN,
  step_registry: /^[a-z][a-z0-9_-]*\.step\.[a-z][a-z0-9_.-]{1,80}$/,
  prompt_registry: /^[a-z][a-z0-9_-]*\.prompt\.[a-z][a-z0-9_.-]{1,80}$/,
  policy_registry: /^[a-z][a-z0-9_-]*\.policy\.[a-z][a-z0-9_.-]{1,80}$/,
  ui_registry: /^[a-z][a-z0-9_-]*\.ui\.[a-z][a-z0-9_.-]{1,80}$/,
  schema_registry: /^[a-z][a-z0-9_-]*\.schema\.[a-zA-Z][a-zA-Z0-9_.-]{1,80}$/,
  trace_registry: /^[a-z][a-z0-9_-]*\.trace\.[a-z][a-z0-9_.-]{1,80}$/,
};
const REGISTRY_ID_FIELDS = {
  action_registry: "action_id",
  step_registry: "step_id",
  prompt_registry: "prompt_id",
  policy_registry: "policy_id",
  ui_registry: "ui_id",
  schema_registry: "schema_id",
  trace_registry: "trace_id",
};
const MEMORY_NAMESPACE_PATTERN = /^memory:\/\/[a-z][a-z0-9_-]{1,31}\/$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;
const TOOL_MODES = new Set(["answer", "read", "draft", "insight", "disabled"]);

const TIME_ACTION_REGISTRY = [
  {
    action_id: "time.explore_principles",
    legacy_action: "explore_principles",
    label: "探索时间管理原则",
    intent: "用对话帮用户发现可沉淀的时间原则。",
    action_kind: "answer",
    execution_mode: "registry_pipeline",
    planner_fields: ["topic", "constraints", "memoryHints"],
    steps: [
      "time.step.context.collect",
      "time.step.memory.project_principles",
      "time.step.semantic.explore_principles",
      "time.step.writer.compose_answer",
    ],
    prompt_refs: ["time.prompt.principles.explore", "time.prompt.writer.answer"],
    policy_refs: ["time.policy.answer.no_write"],
    ui_ref: "time.ui.answer.plain",
    output_schema: "time.schema.PrincipleExploration",
  },
  {
    action_id: "time.save_memory_proposal",
    legacy_action: "save_memory_proposal",
    label: "创建时间原则记忆提案",
    intent: "把用户明确表达的偏好、原则或边界整理成待确认记忆。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: [
      "type",
      "subjectKey",
      "title",
      "body",
      "strength",
      "appliesTo",
      "modelReadable",
      "engineReadable",
      "matchMode",
      "match",
      "rule",
      "validFrom",
      "validUntil",
      "reviewAfter",
      "confidence",
      "operationIntent",
      "targetMemoryIds",
      "evidence",
    ],
    steps: [
      "time.step.context.collect",
      "time.step.memory.extract_candidate",
      "time.step.draft.create_memory_proposal",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.memory.generate_proposal"],
    policy_refs: ["time.policy.memory.correctness_v2", "time.policy.confirm.memory_proposal"],
    ui_ref: "time.ui.card.memory_proposal",
    output_schema: "time.schema.TimeMemoryProposal",
  },
  {
    action_id: "time.parse_task",
    legacy_action: "parse_task",
    label: "解析待办草稿",
    intent: "把自然语言变成可确认的待办草稿。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: ["title", "targetDate", "startTime", "endTime", "estimatedMinutes", "priority", "notes"],
    steps: [
      "time.step.context.collect",
      "time.step.todo.extract_fields",
      "time.step.todo.resolve_time_fields",
      "time.step.draft.create_todo",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.todo.parse_task"],
    policy_refs: ["time.policy.confirm.todo_draft"],
    ui_ref: "time.ui.card.todo_draft",
    output_schema: "time.schema.TaskDraft",
  },
  {
    action_id: "time.breakdown_task",
    legacy_action: "breakdown_task",
    label: "拆解任务草稿",
    intent: "把一个待办拆成多个更小、更好执行的待办草稿。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: ["parentTask", "subtasks", "assumptions", "parentSchedule"],
    minimum_context: {
      required: ["selectedTodo"],
      scope_mode: "selected_todo",
    },
    steps: [
      "time.step.context.collect",
      "time.step.todo.resolve_target",
      "time.step.semantic.generate_subtasks",
      "time.step.todo.allocate_subtask_schedule",
      "time.step.todo.inherit_parent_schedule",
      "time.step.draft.create_todo_batch",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.todo.breakdown_task"],
    policy_refs: ["time.policy.confirm.todo_draft", "time.policy.todo.breakdown_parent"],
    ui_ref: "time.ui.card.todo_breakdown",
    output_schema: "time.schema.TaskBreakdown",
  },
  {
    action_id: "time.plan_today",
    legacy_action: "plan_today",
    label: "生成今日排程草稿",
    intent: "根据今天的待办、忙闲时间和记忆生成可确认的日计划。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: ["dateRange", "todos", "busyBlocks", "memoryRefs", "strategy"],
    minimum_context: {
      required: ["todos", "busyBlocks"],
      scope_mode: "today",
    },
    steps: [
      "time.step.context.collect",
      "time.step.time.resolve_reference_scope",
      "time.step.scheduler.build_input",
      "time.step.scheduler.generate_day_plan",
      "time.step.draft.create_schedule",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.schedule.plan_day"],
    policy_refs: ["time.policy.data.reference_scope", "time.policy.confirm.schedule_draft"],
    ui_ref: "time.ui.card.schedule_draft",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    action_id: "time.plan_week",
    legacy_action: "plan_week",
    label: "生成本周排程草稿",
    intent: "根据本周任务和占用生成可确认的周计划。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: ["dateRange", "todos", "busyBlocks", "memoryRefs", "strategy"],
    minimum_context: {
      required: ["todos", "busyBlocks"],
      scope_mode: "week",
    },
    steps: [
      "time.step.context.collect",
      "time.step.time.resolve_reference_scope",
      "time.step.scheduler.build_input",
      "time.step.scheduler.generate_week_plan",
      "time.step.draft.create_schedule",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.schedule.plan_week"],
    policy_refs: ["time.policy.data.reference_scope", "time.policy.confirm.schedule_draft"],
    ui_ref: "time.ui.card.schedule_draft",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    action_id: "time.reflow_unfinished",
    legacy_action: "reflow_unfinished",
    label: "重排未完成任务草稿",
    intent: "把未完成且可移动的任务重新安排到最近可用时间。",
    action_kind: "draft",
    execution_mode: "registry_pipeline",
    planner_fields: ["dateRange", "unfinishedTodos", "busyBlocks", "strategy"],
    minimum_context: {
      required: ["todos", "busyBlocks"],
      scope_mode: "reflow_unfinished",
    },
    steps: [
      "time.step.context.collect",
      "time.step.todo.collect_unfinished",
      "time.step.scheduler.build_input",
      "time.step.scheduler.generate_reflow",
      "time.step.draft.create_schedule",
      "time.step.policy.confirm_draft",
    ],
    prompt_refs: ["time.prompt.schedule.reflow_unfinished"],
    policy_refs: ["time.policy.data.reference_scope", "time.policy.confirm.schedule_draft"],
    ui_ref: "time.ui.card.schedule_draft",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    action_id: "time.review_day",
    legacy_action: "review_day",
    label: "生成复盘洞察",
    intent: "基于待办、时间记录和进度摘要生成复盘观察。",
    action_kind: "insight",
    execution_mode: "registry_pipeline",
    planner_fields: ["period", "metrics", "progressSummary", "insights"],
    minimum_context: {
      required: ["todos", "entries", "busyBlocks"],
      scope_mode: "today",
    },
    steps: [
      "time.step.context.collect",
      "time.step.time.resolve_reference_scope",
      "time.step.review.collect_entries",
      "time.step.review.generate_insight",
      "time.step.writer.compose_answer",
    ],
    prompt_refs: ["time.prompt.review.day", "time.prompt.writer.answer"],
    policy_refs: ["time.policy.data.reference_scope", "time.policy.answer.no_write"],
    ui_ref: "time.ui.card.review_insight",
    output_schema: "time.schema.ReviewInsight",
  },
];

const TIME_STEP_REGISTRY = [
  {
    step_id: "time.step.context.collect",
    label: "收集本轮上下文",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ActionRequest",
    output_schema: "time.schema.ActionContext",
  },
  {
    step_id: "time.step.memory.project_principles",
    label: "筛选可用时间记忆",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ActionContext",
    output_schema: "time.schema.MemoryProjection",
  },
  {
    step_id: "time.step.semantic.explore_principles",
    label: "生成原则探索问题",
    type: "heuristic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ActionContext",
    output_schema: "time.schema.PrincipleExploration",
  },
  {
    step_id: "time.step.memory.extract_candidate",
    label: "提取记忆候选",
    type: "planner_semantic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.PlannerDecision",
    output_schema: "time.schema.TimeMemoryProposal",
  },
  {
    step_id: "time.step.draft.create_memory_proposal",
    label: "生成待确认记忆草稿",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TimeMemoryProposal",
    output_schema: "time.schema.PendingConfirmation",
  },
  {
    step_id: "time.step.todo.extract_fields",
    label: "提取待办字段",
    type: "planner_semantic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.PlannerDecision",
    output_schema: "time.schema.TaskDraft",
  },
  {
    step_id: "time.step.todo.resolve_time_fields",
    label: "校正日期和时间字段",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TaskDraft",
    output_schema: "time.schema.TaskDraft",
  },
  {
    step_id: "time.step.todo.resolve_target",
    label: "定位要拆解的父任务",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ActionRequest",
    output_schema: "time.schema.ParentTask",
  },
  {
    step_id: "time.step.semantic.generate_subtasks",
    label: "生成子任务",
    type: "planner_semantic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.PlannerDecision",
    output_schema: "time.schema.TaskBreakdown",
  },
  {
    step_id: "time.step.todo.allocate_subtask_schedule",
    label: "分配子任务时长",
    type: "heuristic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TaskBreakdown",
    output_schema: "time.schema.TaskBreakdown",
  },
  {
    step_id: "time.step.todo.inherit_parent_schedule",
    label: "继承父任务日期和时间",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TaskBreakdown",
    output_schema: "time.schema.TaskBreakdown",
  },
  {
    step_id: "time.step.draft.create_todo",
    label: "生成待确认待办草稿",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TaskDraft",
    output_schema: "time.schema.PendingConfirmation",
  },
  {
    step_id: "time.step.draft.create_todo_batch",
    label: "生成待确认子待办草稿",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.TaskBreakdown",
    output_schema: "time.schema.PendingConfirmation",
  },
  {
    step_id: "time.step.time.resolve_reference_scope",
    label: "解析时间数据参考范围",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ContextGrant",
    output_schema: "time.schema.ReferenceScope",
  },
  {
    step_id: "time.step.scheduler.build_input",
    label: "组装排程输入",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ReferenceScope",
    output_schema: "time.schema.SchedulerInput",
  },
  {
    step_id: "time.step.scheduler.generate_day_plan",
    label: "生成日排程建议",
    type: "heuristic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.SchedulerInput",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    step_id: "time.step.scheduler.generate_week_plan",
    label: "生成周排程建议",
    type: "heuristic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.SchedulerInput",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    step_id: "time.step.todo.collect_unfinished",
    label: "筛选未完成任务",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ReferenceScope",
    output_schema: "time.schema.UnfinishedTodos",
  },
  {
    step_id: "time.step.scheduler.generate_reflow",
    label: "生成重排建议",
    type: "heuristic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.SchedulerInput",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    step_id: "time.step.review.collect_entries",
    label: "汇总复盘数据",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ReferenceScope",
    output_schema: "time.schema.ReviewEvidence",
  },
  {
    step_id: "time.step.review.generate_insight",
    label: "生成复盘洞察",
    type: "planner_semantic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.PlannerDecision",
    output_schema: "time.schema.ReviewInsight",
  },
  {
    step_id: "time.step.draft.create_schedule",
    label: "生成待确认排程草稿",
    type: "deterministic",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.ScheduleDraft",
    output_schema: "time.schema.PendingConfirmation",
  },
  {
    step_id: "time.step.policy.confirm_draft",
    label: "放入确认队列",
    type: "human_gate",
    side_effect: false,
    retryable: false,
    input_schema: "time.schema.PendingConfirmation",
    output_schema: "time.schema.PendingConfirmation",
  },
  {
    step_id: "time.step.writer.compose_answer",
    label: "组织最终回复",
    type: "writer",
    side_effect: false,
    retryable: true,
    input_schema: "time.schema.WriterTask",
    output_schema: "time.schema.AssistantAnswer",
  },
];

const TIME_PROMPT_REGISTRY = [
  {
    prompt_id: "time.prompt.planner.route",
    label: "Planner 路由和字段抽取",
    owner: "planner",
    status: "code_prompt",
    output_schema: "time.schema.PlannerDecision",
  },
  {
    prompt_id: "time.prompt.principles.explore",
    label: "时间原则探索",
    owner: "workflow",
    status: "workflow_prompt_contract",
    output_schema: "time.schema.PrincipleExploration",
  },
  {
    prompt_id: "time.prompt.memory.generate_proposal",
    label: "记忆提案生成",
    owner: "planner",
    status: "code_prompt_policy_v2_field_passthrough",
    output_schema: "time.schema.TimeMemoryProposal",
  },
  {
    prompt_id: "time.prompt.todo.parse_task",
    label: "待办字段生成",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.TaskDraft",
  },
  {
    prompt_id: "time.prompt.todo.breakdown_task",
    label: "任务拆解生成",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.TaskBreakdown",
  },
  {
    prompt_id: "time.prompt.schedule.plan_day",
    label: "今日排程意图",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    prompt_id: "time.prompt.schedule.plan_week",
    label: "本周排程意图",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    prompt_id: "time.prompt.schedule.reflow_unfinished",
    label: "未完成任务重排意图",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.ScheduleDraft",
  },
  {
    prompt_id: "time.prompt.review.day",
    label: "复盘洞察生成",
    owner: "planner",
    status: "planner_fields",
    output_schema: "time.schema.ReviewInsight",
  },
  {
    prompt_id: "time.prompt.writer.answer",
    label: "Writer 最终回复",
    owner: "writer",
    status: "code_prompt",
    output_schema: "time.schema.AssistantAnswer",
  },
];

const TIME_POLICY_REGISTRY = [
  {
    policy_id: "time.policy.memory.correctness_v2",
    label: "记忆分类 匹配 冲突 有效期和执行能力校验",
    risk: "L1",
    requires_confirmation: false,
    allow_auto_apply: false,
  },
  {
    policy_id: "time.policy.answer.no_write",
    label: "纯回复不写入本地数据",
    risk: "L0",
    requires_confirmation: false,
    allow_auto_apply: true,
  },
  {
    policy_id: "time.policy.confirm.todo_draft",
    label: "待办草稿确认",
    risk: "L2",
    requires_confirmation: true,
    allow_auto_apply: false,
  },
  {
    policy_id: "time.policy.confirm.schedule_draft",
    label: "排程草稿确认",
    risk: "L2",
    requires_confirmation: true,
    allow_auto_apply: false,
  },
  {
    policy_id: "time.policy.confirm.memory_proposal",
    label: "记忆提案确认",
    risk: "L2",
    requires_confirmation: true,
    allow_auto_apply: false,
  },
  {
    policy_id: "time.policy.todo.breakdown_parent",
    label: "拆解后父任务处理",
    risk: "L2",
    requires_confirmation: true,
    default_mode: "keep_parent",
    options: ["keep_parent", "complete_parent", "archive_parent"],
  },
  {
    policy_id: "time.policy.data.reference_scope",
    label: "时间数据参考范围",
    risk: "L1",
    requires_confirmation: "when_expanded",
    default_scope: "past_2_days_next_3_days",
  },
  {
    policy_id: "time.policy.mcp.external_apply_blocked",
    label: "MCP 禁止绕过 UI 直接写入",
    risk: "L3",
    requires_confirmation: true,
    allow_external_apply: false,
  },
];

const TIME_UI_REGISTRY = [
  {
    ui_id: "time.ui.surface.todo",
    label: "待办工作区上下文",
    surface: "context_surface",
    component: "TodoView",
    editable: false,
    allow_regenerate: false,
    context_surface: {
      view: "todo",
      surface_ids: ["todo", "todo.list", "todo.detail"],
      provides: ["todos", "selectedTodo"],
      context_modes: [
        "selected_todo",
        "selected_with_today",
        "today",
        "week",
        "unfinished",
        "reflow_unfinished",
        "view_todo_selected",
        "view_todo_summary",
        "granted_range",
      ],
      action_refs: ["time.breakdown_task"],
      intent_terms: ["待办", "任务", "事项", "todo", "task"],
      priority: 4,
      reaction: {
        schema: "guanshi-ui-reaction-v1",
        trigger: "before_context_request",
        view: "todo",
        scroll: "today_group",
      },
    },
  },
  {
    ui_id: "time.ui.surface.calendar",
    label: "日历工作区上下文",
    surface: "context_surface",
    component: "CalendarView",
    editable: false,
    allow_regenerate: false,
    context_surface: {
      view: "calendar",
      surface_ids: ["calendar.day", "calendar.week"],
      provides: ["todos", "busyBlocks"],
      context_modes: ["today", "week", "selected_with_today", "reflow_unfinished", "view_calendar_day", "view_calendar_week", "granted_range"],
      action_refs: ["time.plan_today", "time.plan_week", "time.reflow_unfinished"],
      intent_terms: ["日历", "日程", "排程", "时间块", "空档", "有空", "忙闲", "冲突", "calendar", "schedule"],
      priority: 3,
      reaction: {
        schema: "guanshi-ui-reaction-v1",
        trigger: "before_context_request",
        view: "calendar",
      },
    },
  },
  {
    ui_id: "time.ui.surface.review",
    label: "复盘工作区上下文",
    surface: "context_surface",
    component: "ReviewView",
    editable: false,
    allow_regenerate: false,
    context_surface: {
      view: "review",
      surface_ids: ["review", "review.range"],
      provides: ["todos", "entries", "busyBlocks"],
      context_modes: ["today", "week", "view_review_range", "granted_range"],
      action_refs: ["time.review_day"],
      intent_terms: ["复盘", "回顾", "总结", "review"],
      priority: 2,
      reaction: {
        schema: "guanshi-ui-reaction-v1",
        trigger: "before_context_request",
        view: "review",
      },
    },
  },
  {
    ui_id: "time.ui.answer.plain",
    label: "普通回复",
    surface: "assistant_message",
    component: "PlainAssistantAnswer",
    editable: false,
    allow_regenerate: true,
  },
  {
    ui_id: "time.ui.card.todo_draft",
    label: "待办草稿卡片",
    surface: "pending_confirmation",
    component: "TodoDraftCard",
    editable: true,
    allow_regenerate: true,
    post_apply_ui: {
      schema: "guanshi-ui-reaction-v1",
      trigger: "after_confirm_apply",
      view: "todo",
      select: "first_created",
      highlight: "created_items",
      scroll: "first_created",
    },
  },
  {
    ui_id: "time.ui.card.todo_breakdown",
    label: "任务拆解草稿卡片",
    surface: "pending_confirmation",
    component: "TodoBreakdownCard",
    editable: true,
    allow_regenerate: true,
    post_apply_ui: {
      schema: "guanshi-ui-reaction-v1",
      trigger: "after_confirm_apply",
      view: "todo",
      select: "first_created",
      highlight: "created_items",
      scroll: "first_created",
    },
  },
  {
    ui_id: "time.ui.card.schedule_draft",
    label: "排程草稿卡片",
    surface: "pending_confirmation",
    component: "ScheduleDraftCard",
    editable: true,
    allow_regenerate: true,
    post_apply_ui: {
      schema: "guanshi-ui-reaction-v1",
      trigger: "after_confirm_apply",
      view: "todo",
      select: "first_applied",
      highlight: "applied_items",
      scroll: "first_applied",
    },
  },
  {
    ui_id: "time.ui.card.memory_proposal",
    label: "记忆提案卡片",
    surface: "pending_confirmation",
    component: "MemoryProposalCard",
    editable: true,
    allow_regenerate: true,
  },
  {
    ui_id: "time.ui.card.review_insight",
    label: "复盘洞察卡片",
    surface: "assistant_message",
    component: "ReviewInsightCard",
    editable: false,
    allow_regenerate: true,
  },
  {
    ui_id: "time.ui.card.action_registry",
    label: "Action 管理查看区",
    surface: "settings",
    component: "SettingsActionRegistryPanel",
    editable: false,
    allow_regenerate: false,
  },
];

const TIME_SCHEMA_REGISTRY = [
  { schema_id: "time.schema.ActionRequest", label: "Action 输入请求", owner: "executor" },
  { schema_id: "time.schema.ActionContext", label: "Action 上下文", owner: "context" },
  { schema_id: "time.schema.PlannerDecision", label: "Planner 输出", owner: "planner" },
  { schema_id: "time.schema.ContextGrant", label: "数据授权范围", owner: "context" },
  { schema_id: "time.schema.ReferenceScope", label: "时间数据参考范围", owner: "context" },
  { schema_id: "time.schema.MemoryProjection", label: "可注入记忆投影", owner: "memory" },
  { schema_id: "time.schema.TimeMemoryProposal", label: "时间记忆提案", owner: "memory" },
  { schema_id: "time.schema.TaskDraft", label: "待办草稿", owner: "todo" },
  { schema_id: "time.schema.TaskBreakdown", label: "任务拆解结果", owner: "todo" },
  { schema_id: "time.schema.ParentTask", label: "父任务", owner: "todo" },
  { schema_id: "time.schema.PendingConfirmation", label: "待确认草稿", owner: "policy" },
  { schema_id: "time.schema.SchedulerInput", label: "排程输入", owner: "scheduler" },
  { schema_id: "time.schema.ScheduleDraft", label: "排程草稿", owner: "scheduler" },
  { schema_id: "time.schema.UnfinishedTodos", label: "未完成任务集合", owner: "todo" },
  { schema_id: "time.schema.ReviewEvidence", label: "复盘证据", owner: "review" },
  { schema_id: "time.schema.ReviewInsight", label: "复盘洞察", owner: "review" },
  { schema_id: "time.schema.PrincipleExploration", label: "原则探索结果", owner: "memory" },
  { schema_id: "time.schema.WriterTask", label: "Writer 输入任务", owner: "writer" },
  { schema_id: "time.schema.AssistantAnswer", label: "最终回复", owner: "writer" },
];

const TIME_TRACE_REGISTRY = [
  {
    trace_id: "time.trace.action_run",
    label: "一次 Action 执行链路",
    schema: "guanshi-ai-turn-trace-v1",
    includes: ["modelInput", "plannerDecision", "semanticAction", "workflow", "writer"],
  },
  {
    trace_id: "time.trace.pending_confirmation",
    label: "待确认草稿审计",
    schema: "guanshi-ai-pending-confirmation-v1",
    includes: ["sourceRequestId", "action", "draft", "policy"],
  },
];

const TIME_MODULE_MANIFEST = {
  schema: DOMAIN_MODULE_MANIFEST_SCHEMA,
  module_id: "time",
  display_name: "时间管理",
  version: "1",
  enabled: true,
  description: "默认时间管理模块，承载待办、忙闲、排程草稿、时间原则记忆和复盘洞察。",
  data_schema: {
    primary: "timequality-local-storage-export-v1",
    runtimeDataPath: ".runtime/domain-modules/time/",
    legacyRuntimeDataPaths: [".runtime/ai-memory/", ".runtime/ai-drafts/"],
  },
  context_adapter: {
    adapter: "time.context_adapter.v1",
    defaultMode: "summary_only",
    maxItems: 80,
    redaction: ["busy_blocks_only", "no_external_ids", "truncate_notes"],
  },
  tool_manifest: [
    {
      tool_id: "time.explore_principles",
      legacy_action: "explore_principles",
      label: "探索时间管理原则",
      mode: "answer",
      requiresUserConfirmation: false,
      scopes: ["time:read"],
      draft_schema: [],
    },
    {
      tool_id: "time.save_memory_proposal",
      legacy_action: "save_memory_proposal",
      label: "创建时间原则记忆提案",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:memory_propose"],
      draft_schema: ["MemoryProposal"],
    },
    {
      tool_id: "time.parse_task",
      legacy_action: "parse_task",
      label: "解析待办草稿",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:draft"],
      draft_schema: ["TaskDraft"],
    },
    {
      tool_id: "time.breakdown_task",
      legacy_action: "breakdown_task",
      label: "拆解任务草稿",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:draft"],
      draft_schema: ["TaskDraft"],
    },
    {
      tool_id: "time.plan_today",
      legacy_action: "plan_today",
      label: "生成今日排程草稿",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:draft"],
      draft_schema: ["ScheduleDraft"],
    },
    {
      tool_id: "time.plan_week",
      legacy_action: "plan_week",
      label: "生成本周排程草稿",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:draft"],
      draft_schema: ["ScheduleDraft"],
    },
    {
      tool_id: "time.reflow_unfinished",
      legacy_action: "reflow_unfinished",
      label: "重排未完成任务草稿",
      mode: "draft",
      requiresUserConfirmation: true,
      scopes: ["time:read", "time:draft"],
      draft_schema: ["ScheduleDraft"],
    },
    {
      tool_id: "time.review_day",
      legacy_action: "review_day",
      label: "生成复盘洞察",
      mode: "insight",
      requiresUserConfirmation: false,
      scopes: ["time:read", "time:review"],
      draft_schema: ["ReviewInsight"],
    },
  ],
  memory_namespace: "memory://time/",
  draft_schema: ["TaskDraft", "ScheduleDraft", "TimeMemoryProposal", "ReviewInsight"],
  apply_policy: {
    requiresUiConfirmation: true,
    supportsUndo: true,
    allowExternalApply: false,
  },
  permission_scope: {
    mcpRead: ["time:read"],
    mcpDraft: ["time:draft", "time:memory_propose"],
    forbidden: ["time:apply_without_ui_confirmation", "provider:secret_read"],
  },
  ui_slots: {
    leftSidebar: ["quick_actions", "pending_cards", "drafts"],
    settings: ["module_permissions", "action_registry", "memory_visibility"],
    main: ["module_home", "draft_preview"],
  },
  registry: {
    action_registry: TIME_ACTION_REGISTRY,
    step_registry: TIME_STEP_REGISTRY,
    prompt_registry: TIME_PROMPT_REGISTRY,
    policy_registry: TIME_POLICY_REGISTRY,
    ui_registry: TIME_UI_REGISTRY,
    schema_registry: TIME_SCHEMA_REGISTRY,
    trace_registry: TIME_TRACE_REGISTRY,
  },
  test_fixtures: ["tools/fixtures/ai/ai-domain-module-routing.zh.json"],
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDomainModuleError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeId(value, code, label) {
  const id = normalizeText(value, 80);
  if (!MODULE_ID_PATTERN.test(id)) {
    throw createDomainModuleError(code, `${label} is invalid.`, 400, { id });
  }
  return id;
}

function normalizeStringArray(value, maxLength = 80) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((item) => normalizeText(item, maxLength)).filter(Boolean)));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTool(moduleId, tool, index) {
  const source = normalizeObject(tool);
  const toolId = normalizeText(source.tool_id || source.toolId, 100);
  if (!TOOL_ID_PATTERN.test(toolId) || !toolId.startsWith(`${moduleId}.`)) {
    throw createDomainModuleError("AI_DOMAIN_TOOL_ID_INVALID", "Domain module tool id is invalid.", 400, {
      module_id: moduleId,
      tool_id: toolId,
      index,
    });
  }

  const mode = normalizeText(source.mode || "draft", 40);
  if (!TOOL_MODES.has(mode)) {
    throw createDomainModuleError("AI_DOMAIN_TOOL_MODE_INVALID", "Domain module tool mode is invalid.", 400, {
      module_id: moduleId,
      tool_id: toolId,
      mode,
    });
  }

  const scopes = normalizeStringArray(source.scopes, 80);
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope) || !scope.startsWith(`${moduleId}:`)) {
      throw createDomainModuleError("AI_DOMAIN_TOOL_SCOPE_INVALID", "Domain module tool scope is invalid.", 400, {
        module_id: moduleId,
        tool_id: toolId,
        scope,
      });
    }
  }

  return {
    tool_id: toolId,
    legacy_action: normalizeText(source.legacy_action || source.legacyAction, 80),
    label: normalizeText(source.label || toolId, 100),
    mode,
    requiresUserConfirmation: source.requiresUserConfirmation === true,
    scopes,
    draft_schema: normalizeStringArray(source.draft_schema || source.draftSchema, 80),
  };
}

function normalizeRegistryList(moduleId, source, key) {
  const idField = REGISTRY_ID_FIELDS[key];
  const pattern = REGISTRY_ID_PATTERNS[key];
  const items = Array.isArray(source) ? source : [];
  const ids = new Set();
  return items.map((item, index) => {
    const normalized = cloneJson(normalizeObject(item));
    const id = normalizeText(normalized[idField], 120);
    if (!pattern.test(id) || !id.startsWith(`${moduleId}.`)) {
      throw createDomainModuleError("AI_DOMAIN_REGISTRY_ID_INVALID", "Domain module registry id is invalid.", 400, {
        module_id: moduleId,
        registry: key,
        id,
        index,
      });
    }
    if (ids.has(id)) {
      throw createDomainModuleError("AI_DOMAIN_REGISTRY_ID_DUPLICATED", "Domain module registry id is duplicated.", 400, {
        module_id: moduleId,
        registry: key,
        id,
      });
    }
    ids.add(id);
    normalized[idField] = id;
    return normalized;
  });
}

function assertKnownRegistryRef(moduleId, sourceId, ref, registry, key, idField) {
  const id = normalizeText(ref, 120);
  if (!id.startsWith(`${moduleId}.`)) {
    throw createDomainModuleError("AI_DOMAIN_REGISTRY_REF_INVALID", "Domain module registry ref is invalid.", 400, {
      module_id: moduleId,
      source_id: sourceId,
      registry: key,
      ref: id,
    });
  }
  if (!registry[key].some((item) => item[idField] === id)) {
    throw createDomainModuleError("AI_DOMAIN_REGISTRY_REF_NOT_FOUND", "Domain module registry ref was not found.", 400, {
      module_id: moduleId,
      source_id: sourceId,
      registry: key,
      ref: id,
    });
  }
}

function normalizeActionRegistryBundle(moduleId, rawRegistry = {}) {
  const source = normalizeObject(rawRegistry);
  const registry = {
    schema: AI_ACTION_REGISTRY_BUNDLE_SCHEMA,
    module_id: moduleId,
    action_registry: normalizeRegistryList(moduleId, source.action_registry || source.actionRegistry, "action_registry"),
    step_registry: normalizeRegistryList(moduleId, source.step_registry || source.stepRegistry, "step_registry"),
    prompt_registry: normalizeRegistryList(moduleId, source.prompt_registry || source.promptRegistry, "prompt_registry"),
    policy_registry: normalizeRegistryList(moduleId, source.policy_registry || source.policyRegistry, "policy_registry"),
    ui_registry: normalizeRegistryList(moduleId, source.ui_registry || source.uiRegistry, "ui_registry"),
    schema_registry: normalizeRegistryList(moduleId, source.schema_registry || source.schemaRegistry, "schema_registry"),
    trace_registry: normalizeRegistryList(moduleId, source.trace_registry || source.traceRegistry, "trace_registry"),
  };

  for (const action of registry.action_registry) {
    const actionId = action.action_id;
    for (const stepId of normalizeStringArray(action.steps, 120)) {
      assertKnownRegistryRef(moduleId, actionId, stepId, registry, "step_registry", "step_id");
    }
    for (const promptId of normalizeStringArray(action.prompt_refs || action.promptRefs, 120)) {
      assertKnownRegistryRef(moduleId, actionId, promptId, registry, "prompt_registry", "prompt_id");
    }
    for (const policyId of normalizeStringArray(action.policy_refs || action.policyRefs, 120)) {
      assertKnownRegistryRef(moduleId, actionId, policyId, registry, "policy_registry", "policy_id");
    }
    if (action.ui_ref || action.uiRef) {
      assertKnownRegistryRef(moduleId, actionId, action.ui_ref || action.uiRef, registry, "ui_registry", "ui_id");
    }
    if (action.output_schema || action.outputSchema) {
      assertKnownRegistryRef(moduleId, actionId, action.output_schema || action.outputSchema, registry, "schema_registry", "schema_id");
    }
  }

  return registry;
}

function normalizeDomainModuleManifest(input = {}) {
  const source = normalizeObject(input);
  const schema = normalizeText(source.schema || DOMAIN_MODULE_MANIFEST_SCHEMA, 80);
  if (schema !== DOMAIN_MODULE_MANIFEST_SCHEMA) {
    throw createDomainModuleError("AI_DOMAIN_MODULE_SCHEMA_INVALID", "Domain module manifest schema is invalid.", 400, { schema });
  }

  const moduleId = normalizeId(source.module_id || source.moduleId, "AI_DOMAIN_MODULE_ID_INVALID", "Domain module id");
  const memoryNamespace = normalizeText(source.memory_namespace || source.memoryNamespace, 80);
  if (!MEMORY_NAMESPACE_PATTERN.test(memoryNamespace) || memoryNamespace !== `memory://${moduleId}/`) {
    throw createDomainModuleError("AI_DOMAIN_MEMORY_NAMESPACE_INVALID", "Domain module memory namespace is invalid.", 400, {
      module_id: moduleId,
      memory_namespace: memoryNamespace,
    });
  }

  const toolManifest = Array.isArray(source.tool_manifest || source.toolManifest)
    ? (source.tool_manifest || source.toolManifest).map((tool, index) => normalizeTool(moduleId, tool, index))
    : [];
  if (toolManifest.length === 0) {
    throw createDomainModuleError("AI_DOMAIN_TOOLS_REQUIRED", "Domain module must declare at least one tool.", 400, {
      module_id: moduleId,
    });
  }

  const dataSchema = normalizeObject(source.data_schema || source.dataSchema);
  const contextAdapter = normalizeObject(source.context_adapter || source.contextAdapter);
  const applyPolicy = normalizeObject(source.apply_policy || source.applyPolicy);
  const permissionScope = normalizeObject(source.permission_scope || source.permissionScope);
  const uiSlots = normalizeObject(source.ui_slots || source.uiSlots);
  const registry = normalizeActionRegistryBundle(moduleId, source.registry);

  return {
    schema: DOMAIN_MODULE_MANIFEST_SCHEMA,
    module_id: moduleId,
    display_name: normalizeText(source.display_name || source.displayName || moduleId, 80),
    version: normalizeText(source.version || "1", 40),
    enabled: source.enabled !== false,
    description: normalizeText(source.description, 500),
    data_schema: {
      primary: normalizeText(dataSchema.primary, 120),
      runtimeDataPath: normalizeText(dataSchema.runtimeDataPath, 200),
      legacyRuntimeDataPaths: normalizeStringArray(dataSchema.legacyRuntimeDataPaths, 200),
    },
    context_adapter: {
      adapter: normalizeText(contextAdapter.adapter, 100),
      defaultMode: normalizeText(contextAdapter.defaultMode || "summary_only", 80),
      maxItems: Math.max(1, Math.min(500, Number.parseInt(String(contextAdapter.maxItems || 80), 10) || 80)),
      redaction: normalizeStringArray(contextAdapter.redaction, 80),
    },
    tool_manifest: toolManifest,
    memory_namespace: memoryNamespace,
    draft_schema: normalizeStringArray(source.draft_schema || source.draftSchema, 80),
    apply_policy: {
      requiresUiConfirmation: applyPolicy.requiresUiConfirmation !== false,
      supportsUndo: applyPolicy.supportsUndo !== false,
      allowExternalApply: applyPolicy.allowExternalApply === true,
    },
    permission_scope: {
      mcpRead: normalizeStringArray(permissionScope.mcpRead, 80),
      mcpDraft: normalizeStringArray(permissionScope.mcpDraft, 80),
      forbidden: normalizeStringArray(permissionScope.forbidden, 120),
    },
    ui_slots: {
      leftSidebar: normalizeStringArray(uiSlots.leftSidebar, 80),
      settings: normalizeStringArray(uiSlots.settings, 80),
      main: normalizeStringArray(uiSlots.main, 80),
    },
    registry,
    test_fixtures: normalizeStringArray(source.test_fixtures || source.testFixtures, 200),
  };
}

function createDomainModuleRegistry(options = {}) {
  const initialModules = Array.isArray(options.modules) && options.modules.length > 0
    ? options.modules
    : [TIME_MODULE_MANIFEST];
  const modules = new Map();

  for (const manifest of initialModules) {
    const normalized = normalizeDomainModuleManifest(manifest);
    modules.set(normalized.module_id, normalized);
  }

  function listModules(filters = {}) {
    const includeDisabled = filters.includeDisabled === true;
    const items = Array.from(modules.values())
      .filter((moduleInfo) => includeDisabled || moduleInfo.enabled)
      .map((moduleInfo) => cloneJson(moduleInfo));
    return {
      schema: DOMAIN_MODULE_LIST_SCHEMA,
      modules: items,
    };
  }

  function getModule(moduleId) {
    const id = normalizeId(moduleId, "AI_DOMAIN_MODULE_ID_INVALID", "Domain module id");
    const moduleInfo = modules.get(id);
    if (!moduleInfo) {
      throw createDomainModuleError("AI_DOMAIN_MODULE_NOT_FOUND", "Domain module was not found.", 404, {
        module_id: id,
      });
    }
    return cloneJson(moduleInfo);
  }

  function listTools(moduleId = "") {
    const selectedModules = moduleId
      ? [getModule(moduleId)]
      : listModules().modules;
    const tools = selectedModules.flatMap((moduleInfo) => moduleInfo.tool_manifest.map((tool) => ({
      ...tool,
      module_id: moduleInfo.module_id,
      memory_namespace: moduleInfo.memory_namespace,
      apply_policy: moduleInfo.apply_policy,
    })));
    return {
      schema: DOMAIN_MODULE_TOOL_LIST_SCHEMA,
      module_id: normalizeText(moduleId, 80),
      tools,
    };
  }

  function getTool(toolId) {
    const id = normalizeText(toolId, 100);
    if (!TOOL_ID_PATTERN.test(id)) {
      throw createDomainModuleError("AI_DOMAIN_TOOL_ID_INVALID", "Domain module tool id is invalid.", 400, {
        tool_id: id,
      });
    }
    const moduleId = id.split(".")[0];
    const moduleInfo = getModule(moduleId);
    const tool = moduleInfo.tool_manifest.find((item) => item.tool_id === id);
    if (!tool) {
      throw createDomainModuleError("AI_DOMAIN_TOOL_NOT_FOUND", "Domain module tool was not found.", 404, {
        module_id: moduleId,
        tool_id: id,
      });
    }
    return {
      ...tool,
      module_id: moduleId,
      memory_namespace: moduleInfo.memory_namespace,
      apply_policy: moduleInfo.apply_policy,
    };
  }

  function getActionRegistry(moduleId) {
    const moduleInfo = getModule(moduleId);
    return cloneJson(moduleInfo.registry);
  }

  function listActionRegistries(filters = {}) {
    const includeDisabled = filters.includeDisabled === true;
    const registries = Array.from(modules.values())
      .filter((moduleInfo) => includeDisabled || moduleInfo.enabled)
      .map((moduleInfo) => cloneJson(moduleInfo.registry));
    return {
      schema: AI_ACTION_REGISTRY_BUNDLE_SCHEMA,
      module_id: "",
      registries,
    };
  }

  return {
    listModules,
    getModule,
    listTools,
    getTool,
    getActionRegistry,
    listActionRegistries,
  };
}

module.exports = {
  AI_ACTION_REGISTRY_BUNDLE_SCHEMA,
  DOMAIN_MODULE_MANIFEST_SCHEMA,
  DOMAIN_MODULE_LIST_SCHEMA,
  DOMAIN_MODULE_TOOL_LIST_SCHEMA,
  TIME_MODULE_MANIFEST,
  createDomainModuleError,
  createDomainModuleRegistry,
  normalizeDomainModuleManifest,
};
