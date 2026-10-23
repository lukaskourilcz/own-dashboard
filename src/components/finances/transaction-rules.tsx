"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListFilter, Pencil, Plus, Trash2, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useToast } from "@/components/ui/toast";
import { CategorySelect } from "@/components/category-select";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { fetchTransactionRules } from "@/lib/queries/fetchers";
import {
  RULE_ACTION_KEYS,
  RULE_FIELDS,
  RULE_OPS,
  RULE_STAGES,
  parseActions,
  parseConditions,
  ruleMatches,
  safeRegex,
  sortRules,
  usableRules,
  type RuleActionKey,
  type RuleActions,
  type RuleCondition,
  type RuleField,
  type RuleOp,
  type RuleStage,
  type TransactionRule,
} from "@/lib/transaction-rules";
import type { Project, Subscription, Transaction } from "@/lib/types";

/**
 * The Money rule editor. Rules are staged and specificity-ranked by
 * `src/lib/transaction-rules.ts`; this surface only edits them and shows how
 * many transactions each one touches.
 *
 * Two match counts on purpose. The inline one is computed over the transaction
 * window the dashboard already loaded and says so in its label, so it costs
 * nothing and never pretends to be the whole ledger. "Check all transactions"
 * asks /api/money/rules/apply, which pages through everything the owner has.
 */

/* ------------------------------ editor state ------------------------------ */

type ConditionDraft = {
  field: RuleField;
  op: RuleOp;
  /** Free text for scalar ops and the comma list for `one_of`. */
  value: string;
  /** The two ends of a `between` range. */
  from: string;
  to: string;
};

type RuleDraft = {
  id: string | null;
  expectedUpdatedAt: string | null;
  enabledActions: RuleActionKey[];
  name: string;
  stage: RuleStage;
  enabled: boolean;
  conditions: ConditionDraft[];
  category: string;
  project_id: string;
  subscription_id: string;
  note: string;
};

const emptyCondition: ConditionDraft = {
  field: "note",
  op: "contains",
  value: "",
  from: "",
  to: "",
};

const emptyDraft: RuleDraft = {
  id: null,
  expectedUpdatedAt: null,
  enabledActions: [],
  name: "",
  stage: "default",
  enabled: true,
  conditions: [{ ...emptyCondition }],
  category: "",
  project_id: "",
  subscription_id: "",
  note: "",
};

const NUMERIC_OPS = new Set<RuleOp>(["gt", "gte", "lt", "lte", "between"]);

/** The draft's conditions in the engine's own shape, malformed rows dropped. */
function draftConditions(draft: RuleDraft): RuleCondition[] {
  return parseConditions(
    draft.conditions.map((condition) => {
      if (condition.op === "one_of") {
        return {
          field: condition.field,
          op: condition.op,
          value: condition.value.split(",").map((part) => part.trim()),
        };
      }
      if (condition.op === "between") {
        return {
          field: condition.field,
          op: condition.op,
          value: [condition.from, condition.to],
        };
      }
      return { field: condition.field, op: condition.op, value: condition.value };
    }),
  );
}

function draftActions(draft: RuleDraft): RuleActions {
  return parseActions({
    category: draft.category.trim() === "" ? null : draft.category,
    project_id: draft.project_id === "" ? null : draft.project_id,
    subscription_id: draft.subscription_id === "" ? null : draft.subscription_id,
    note: draft.note.trim() === "" ? null : draft.note,
  });
}

/** Unchecked means keep; a checked empty field explicitly clears it. */
function chosenActions(draft: RuleDraft): RuleActions {
  const actions = draftActions(draft);
  const chosen: RuleActions = {};
  for (const key of draft.enabledActions) chosen[key] = actions[key] ?? null;
  return chosen;
}

function toDraft(rule: TransactionRule): RuleDraft {
  return {
    id: rule.id,
    expectedUpdatedAt: rule.updated_at,
    enabledActions: RULE_ACTION_KEYS.filter(key => key in rule.actions),
    name: rule.name,
    stage: rule.stage,
    enabled: rule.enabled,
    conditions:
      rule.conditions.length > 0
        ? rule.conditions.map((condition) => ({
            field: condition.field,
            op: condition.op,
            value:
              condition.op === "one_of" && Array.isArray(condition.value)
                ? (condition.value as string[]).join(", ")
                : Array.isArray(condition.value)
                  ? ""
                  : String(condition.value),
            from:
              condition.op === "between" && Array.isArray(condition.value)
                ? String(condition.value[0])
                : "",
            to:
              condition.op === "between" && Array.isArray(condition.value)
                ? String(condition.value[1])
                : "",
          }))
        : [{ ...emptyCondition }],
    category: rule.actions.category ?? "",
    project_id: rule.actions.project_id ?? "",
    subscription_id: rule.actions.subscription_id ?? "",
    note: rule.actions.note ?? "",
  };
}

/** A draft evaluated exactly like a saved rule, for the live match count. */
function draftAsRule(draft: RuleDraft): TransactionRule {
  const conditions = draftConditions(draft);
  return {
    id: draft.id ?? "draft",
    user_id: "",
    name: draft.name,
    stage: draft.stage,
    conditions: conditions.length === draft.conditions.length ? conditions : [],
    actions: chosenActions(draft),
    sort_order: 0,
    enabled: draft.enabled,
    created_at: "",
    updated_at: "",
  };
}

/* -------------------------------- the card -------------------------------- */

export function TransactionRules({
  transactions,
  projects,
  subscriptions,
}: {
  transactions: Transaction[];
  projects: Project[];
  subscriptions: Subscription[];
}) {
  const t = useDict();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  // `seq` remounts the editor for each opened rule, so the form starts from the
  // rule it was opened with instead of syncing itself in an effect.
  const [draft, setDraft] = useState<{ seq: number; value: RuleDraft } | null>(null);
  const openDraft = (value: RuleDraft) =>
    setDraft((prev) => ({ seq: (prev?.seq ?? 0) + 1, value }));

  const rulesQuery = useQuery({
    queryKey: qk.transactionRules,
    queryFn: fetchTransactionRules,
    // A missing table (before the migration is applied) must not spam retries.
    retry: false,
  });
  const rules = useMemo(
    () => sortRules(rulesQuery.data?.rules ?? []),
    [rulesQuery.data],
  );
  const dropped = rulesQuery.data?.dropped ?? 0;

  const deleteMutation = useMutation({
    scope: { id: "transaction-rule-writes" },
    mutationFn: async (rule: TransactionRule) => {
      const { data, error } = await supabase.from("transaction_rules").delete().eq("id", rule.id)
        .eq("updated_at", rule.updated_at).select("id").single();
      if (error || data?.id !== rule.id) throw new Error("rule-delete-not-confirmed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.transactionRules }),
    onError: () => toast.err(t.finances.rules.saveErr),
  });

  const toggleMutation = useMutation({
    scope: { id: "transaction-rule-writes" },
    mutationFn: async ({ rule, enabled }: { rule: TransactionRule; enabled: boolean }) => {
      const { data, error } = await supabase.from("transaction_rules").update({ enabled })
        .eq("id", rule.id).eq("updated_at", rule.updated_at).select("id").single();
      if (error || data?.id !== rule.id) throw new Error("rule-toggle-not-confirmed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.transactionRules }),
    onError: () => toast.err(t.finances.rules.saveErr),
  });

  const applyMutation = useMutation({
    mutationFn: async (ruleId: string | null) => {
      const res = await fetch("/api/money/rules/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "apply", ...(ruleId ? { ruleId } : {}) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const result = await res.json();
      if (!result || !Number.isSafeInteger(result.updated) || result.updated < 0) throw new Error("invalid-rule-receipt");
      return result as { updated: number };
    },
    onSuccess: ({ updated }) => {
      toast.ok(
        updated > 0 ? t.finances.rules.applyDone(updated) : t.finances.rules.applyNothing,
      );
      if (updated > 0) void qc.invalidateQueries({ queryKey: qk.transactions });
    },
    onError: () => toast.err(t.finances.rules.applyErr),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.transactions }),
  });
  const writeBusy = deleteMutation.isPending || toggleMutation.isPending || applyMutation.isPending;
  const writable = rulesQuery.isSuccess && dropped === 0 && !writeBusy;

  async function requestApply(ruleId: string | null) {
    if (!writable) return;
    const ok = await confirm({
      title: t.finances.rules.applyConfirmTitle,
      description: t.finances.rules.applyConfirmBody,
      confirmLabel: t.finances.rules.applyConfirmLabel,
      cancelLabel: t.common.cancel,
    });
    if (ok && writable) applyMutation.mutate(ruleId);
  }

  async function requestDelete(rule: TransactionRule) {
    if (!writable) return;
    const ok = await confirm({
      title: t.finances.rules.deleteConfirmTitle,
      description: t.finances.rules.deleteConfirmBody,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    });
    if (ok && writable) deleteMutation.mutate(rule);
  }

  const activeRules = useMemo(() => usableRules(rules), [rules]);

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 basis-56">
          <CardTitle className="inline-flex items-center gap-1.5">
            <ListFilter className="h-3 w-3" /> {t.finances.rules.title}
          </CardTitle>
          <p className="mt-1 text-xs normal-case tracking-normal text-foreground-subtle">
            {t.finances.rules.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {activeRules.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void requestApply(null)}
              disabled={!writable}
            >
              <ListChecks className="h-3.5 w-3.5" />
              {applyMutation.isPending
                ? t.finances.rules.applying
                : t.finances.rules.apply}
            </Button>
          )}
          <Button size="sm" disabled={!writable} onClick={() => openDraft({ ...emptyDraft })}>
            <Plus className="h-3.5 w-3.5" />
            {t.finances.rules.newRule}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {rulesQuery.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <p>{t.finances.rules.loadErr}</p>
            <Button size="sm" variant="outline" onClick={() => void rulesQuery.refetch()} disabled={rulesQuery.isFetching}>{t.common.retry}</Button>
          </div>
        )}
        {dropped > 0 && (
          <p className="text-xs text-warning">{t.finances.rules.dropped(dropped)}</p>
        )}

        {rules.length === 0 && !rulesQuery.isPending && !rulesQuery.isError ? (
          <div className="rounded-lg border border-dashed border-border-strong bg-surface-muted/30 p-4">
            <p className="text-xs font-medium text-foreground">
              {t.finances.rules.empty}
            </p>
            <p className="mt-1 text-[11px] text-foreground-subtle">
              {t.finances.rules.emptyHint}
            </p>
          </div>
        ) : (
          RULE_STAGES.filter((stage) => rules.some((rule) => rule.stage === stage)).map(
            (stage) => (
              <section
                key={stage}
                aria-label={stageLabel(stage, t)}
                className="space-y-1.5"
              >
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">{stageLabel(stage, t)}</h2>
                <ul className="space-y-1.5">
                  {rules
                    .filter((rule) => rule.stage === stage)
                    .map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        transactions={transactions}
                        projects={projects}
                        subscriptions={subscriptions}
                        onEdit={() => openDraft(toDraft(rule))}
                        onDelete={() => void requestDelete(rule)}
                        onToggle={(enabled) =>
                          toggleMutation.mutate({ rule, enabled })
                        }
                        onApply={() => void requestApply(rule.id)}
                        applying={!writable}
                      />
                    ))}
                </ul>
              </section>
            ),
          )
        )}
      </CardContent>

      {draft && (
        <RuleDialog
          key={draft.seq}
          draft={draft.value}
          onClose={() => setDraft(null)}
          transactions={transactions}
          projects={projects}
          subscriptions={subscriptions}
          onSaved={() => {
            setDraft(null);
            void qc.invalidateQueries({ queryKey: qk.transactionRules });
          }}
          supabase={supabase}
        />
      )}
    </Card>
  );
}

function stageLabel(stage: RuleStage, t: ReturnType<typeof useDict>): string {
  if (stage === "pre") return t.finances.rules.stagePre;
  if (stage === "post") return t.finances.rules.stagePost;
  return t.finances.rules.stageDefault;
}

function fieldLabel(field: RuleField, t: ReturnType<typeof useDict>): string {
  switch (field) {
    case "note":
      return t.finances.rules.fieldNote;
    case "account":
      return t.finances.rules.fieldAccount;
    case "amount":
      return t.finances.rules.fieldAmount;
    case "date":
      return t.finances.rules.fieldDate;
    case "kind":
      return t.finances.rules.fieldKind;
  }
}

function opLabel(op: RuleOp, t: ReturnType<typeof useDict>): string {
  switch (op) {
    case "is":
      return t.finances.rules.opIs;
    case "contains":
      return t.finances.rules.opContains;
    case "not_contains":
      return t.finances.rules.opNotContains;
    case "regex":
      return t.finances.rules.opRegex;
    case "one_of":
      return t.finances.rules.opOneOf;
    case "gt":
      return t.finances.rules.opGt;
    case "gte":
      return t.finances.rules.opGte;
    case "lt":
      return t.finances.rules.opLt;
    case "lte":
      return t.finances.rules.opLte;
    case "between":
      return t.finances.rules.opBetween;
  }
}

function conditionText(condition: RuleCondition, t: ReturnType<typeof useDict>): string {
  const value = Array.isArray(condition.value)
    ? condition.value.join(", ")
    : String(condition.value);
  return `${fieldLabel(condition.field, t)} ${opLabel(condition.op, t)} ${value}`;
}

function actionText(
  actions: RuleActions,
  projects: Project[],
  subscriptions: Subscription[],
  t: ReturnType<typeof useDict>,
): string[] {
  const parts: string[] = [];
  if (actions.category != null) {
    parts.push(`${t.finances.rules.actionCategory}: ${actions.category}`);
  }
  if (actions.project_id != null) {
    const name = projects.find((p) => p.id === actions.project_id)?.name;
    parts.push(`${t.finances.rules.actionProject}: ${name ?? actions.project_id}`);
  }
  if (actions.subscription_id != null) {
    const name = subscriptions.find((s) => s.id === actions.subscription_id)?.name;
    parts.push(
      `${t.finances.rules.actionSubscription}: ${name ?? actions.subscription_id}`,
    );
  }
  if (actions.note != null) {
    parts.push(`${t.finances.rules.actionNote}: ${actions.note}`);
  }
  const labels = { category: t.finances.rules.actionCategory, project_id: t.finances.rules.actionProject,
    subscription_id: t.finances.rules.actionSubscription, note: t.finances.rules.actionNote };
  for (const key of RULE_ACTION_KEYS) {
    if (key in actions && actions[key] === null) parts.push(`${labels[key]}: ${t.finances.rules.clearValue}`);
  }
  return parts;
}

/* --------------------------------- one row -------------------------------- */

function RuleRow({
  rule,
  transactions,
  projects,
  subscriptions,
  onEdit,
  onDelete,
  onToggle,
  onApply,
  applying,
}: {
  rule: TransactionRule;
  transactions: Transaction[];
  projects: Project[];
  subscriptions: Subscription[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onApply: () => void;
  applying: boolean;
}) {
  const t = useDict();
  const switchId = useId();
  const matched = useMemo(
    () => transactions.filter((tx) => ruleMatches(tx, rule)).length,
    [transactions, rule],
  );
  const actions = actionText(rule.actions, projects, subscriptions, t);

  return (
    <li className="rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {rule.name.trim() || t.finances.rules.unnamed}
          </p>
          <ul className="mt-1 space-y-0.5">
            {rule.conditions.map((condition, index) => (
              <li key={index} className="text-[11px] text-foreground-muted">
                {conditionText(condition, t)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-foreground-subtle">
            {actions.length > 0 ? actions.join(" · ") : t.finances.rules.actionsNone}
          </p>
          <p className="mt-1 text-[11px] tabular text-foreground-subtle">
            {t.finances.rules.matchesLoaded(matched, transactions.length)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Switch
            id={switchId}
            checked={rule.enabled}
            onCheckedChange={onToggle}
            disabled={applying}
            aria-label={`${rule.enabled ? t.finances.rules.enabled : t.finances.rules.disabled}: ${rule.name || t.finances.rules.unnamed}`}
          />
          <Tooltip content={t.finances.rules.apply}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onApply}
              disabled={applying}
              aria-label={`${t.finances.rules.apply}: ${rule.name || t.finances.rules.unnamed}`}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.common.edit}>
            <Button size="icon-sm" variant="ghost" onClick={onEdit} disabled={applying} aria-label={`${t.common.edit}: ${rule.name || t.finances.rules.unnamed}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.common.delete}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDelete}
              disabled={applying}
              aria-label={`${t.common.delete}: ${rule.name || t.finances.rules.unnamed}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------- the editor ------------------------------- */

function RuleDialog({
  draft,
  onClose,
  onSaved,
  transactions,
  projects,
  subscriptions,
  supabase,
}: {
  draft: RuleDraft;
  onClose: () => void;
  onSaved: () => void;
  transactions: Transaction[];
  projects: Project[];
  subscriptions: Subscription[];
  supabase: ReturnType<typeof createClient>;
}) {
  const t = useDict();
  const nameId = useId();
  const stageId = useId();
  const enabledId = useId();
  const [form, setForm] = useState<RuleDraft>(draft);
  const [createId] = useState(() => crypto.randomUUID());
  const saveGuard = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [fullCount, setFullCount] = useState<{
    fingerprint: string;
    matched: number;
    changed: number;
    truncated: boolean;
  } | null>(null);

  const conditions = useMemo(() => draftConditions(form), [form]);
  const actions = useMemo(() => chosenActions(form), [form]);
  const previewRule = useMemo(() => draftAsRule(form), [form]);
  const matched = useMemo(
    () => transactions.filter((tx) => ruleMatches(tx, previewRule)).length,
    [transactions, previewRule],
  );

  const invalidPattern = form.conditions.some(
    (condition) =>
      condition.op === "regex" &&
      condition.value.trim() !== "" &&
      safeRegex(condition.value.trim()) === null,
  );
  const completeConditions = conditions.length > 0 && conditions.length === form.conditions.length;
  const canSave = completeConditions && RULE_ACTION_KEYS.some((key) => key in actions);
  const fingerprint = JSON.stringify({ stage: form.stage, conditions, actions });
  const visibleCount = fullCount?.fingerprint === fingerprint ? fullCount : null;

  const checkMutation = useMutation({
    mutationFn: async (snapshot: { stage: RuleStage; conditions: RuleCondition[]; actions: RuleActions; fingerprint: string }) => {
      const res = await fetch("/api/money/rules/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          draft: { stage: snapshot.stage, conditions: snapshot.conditions, actions: snapshot.actions },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const result = await res.json();
      if (!result || !Number.isSafeInteger(result.matched) || result.matched < 0
        || !Number.isSafeInteger(result.changed) || result.changed < 0 || result.changed > result.matched
        || (result.truncated !== undefined && typeof result.truncated !== "boolean")) throw new Error("invalid-rule-preview");
      return result as { matched: number; changed: number; truncated?: boolean };
    },
    onMutate: () => setCheckError(false),
    onSuccess: (result, snapshot) =>
      setFullCount({
        fingerprint: snapshot.fingerprint,
        matched: result.matched,
        changed: result.changed,
        truncated: result.truncated === true,
      }),
    onError: () => setCheckError(true),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canSave || saveGuard.current) throw new Error("invalid-or-pending");
      saveGuard.current = true;
      try {
        const userId = await currentUserId(supabase);
        if (!userId) throw new Error("no-user");
        const payload = { name: form.name.trim(), stage: form.stage, conditions, actions, enabled: form.enabled };
        if (form.id) {
          const { data, error } = await supabase.from("transaction_rules").update(payload)
            .eq("id", form.id).eq("updated_at", form.expectedUpdatedAt).select("id").single();
          if (error || data?.id !== form.id) throw new Error("rule-save-not-confirmed");
        } else {
          // A retry after an ambiguous response must not create another rule.
          const { data, error } = await supabase.from("transaction_rules").upsert(
            { ...payload, id: createId, user_id: userId }, { onConflict: "id", ignoreDuplicates: true },
          ).select("id");
          if (error || !Array.isArray(data) || data.length > 1) throw new Error("rule-create-not-confirmed");
          if (data.length === 1) {
            if (data[0].id !== createId) throw new Error("rule-create-not-confirmed");
          } else {
            const existing = await supabase.from("transaction_rules").select("name,stage,conditions,actions,enabled")
              .eq("id", createId).eq("user_id", userId).single();
            if (existing.error || !existing.data || existing.data.name !== payload.name || existing.data.stage !== payload.stage
              || existing.data.enabled !== payload.enabled || JSON.stringify(parseConditions(existing.data.conditions)) !== JSON.stringify(conditions)
              || RULE_ACTION_KEYS.some(key => (key in existing.data.actions) !== (key in actions) || existing.data.actions[key] !== actions[key])) {
              throw new Error("rule-create-not-confirmed");
            }
          }
        }
      } finally { saveGuard.current = false; }
    },
    onMutate: () => setSaveError(false),
    onSuccess: onSaved,
    onError: () => setSaveError(true),
  });
  const busy = saveMutation.isPending || checkMutation.isPending;
  function actionLabel(key: RuleActionKey, label: string) {
    const id = `${nameId}-action-${key}`;
    return <div className="flex min-h-11 items-center gap-2 md:min-h-6">
      <Checkbox id={id} checked={form.enabledActions.includes(key)} onCheckedChange={checked => setForm(prev => ({
        ...prev, enabledActions: checked === true ? [...new Set([...prev.enabledActions, key])] : prev.enabledActions.filter(value => value !== key),
      }))} />
      <Label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-center md:min-h-6">{label}</Label>
    </div>;
  }

  function updateCondition(index: number, patch: Partial<ConditionDraft>) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition,
      ),
    }));
    setFullCount(null);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl" showClose={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>
            {form.id ? t.finances.rules.editRule : t.finances.rules.newRule}
          </DialogTitle>
          <DialogDescription>{t.finances.rules.stageHint}</DialogDescription>
        </DialogHeader>

        <fieldset disabled={busy} aria-busy={busy} className="mt-4 min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor={nameId}>{t.finances.rules.ruleName}</Label>
              <Input
                id={nameId}
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t.finances.rules.ruleNamePlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={stageId}>{t.finances.rules.stage}</Label>
              <SimpleSelect
                id={stageId}
                aria-label={t.finances.rules.stage}
                value={form.stage}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, stage: value as RuleStage }))
                }
                options={RULE_STAGES.map((stage) => ({
                  value: stage,
                  label: stageLabel(stage, t),
                }))}
                className="sm:w-36"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                id={enabledId}
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
              />
              <Label htmlFor={enabledId}>{t.finances.rules.enabled}</Label>
            </div>
          </div>

          {/* Conditions */}
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-foreground-muted">
              {t.finances.rules.conditions}
            </legend>
            {form.conditions.map((condition, index) => (
              <div
                key={index}
                className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,10rem)_minmax(0,1fr)_auto]"
              >
                <SimpleSelect
                  aria-label={`${t.finances.rules.field} ${index + 1}`}
                  value={condition.field}
                  onValueChange={(value) =>
                    updateCondition(index, { field: value as RuleField })
                  }
                  options={RULE_FIELDS.map((field) => ({
                    value: field,
                    label: fieldLabel(field, t),
                  }))}
                />
                <SimpleSelect
                  aria-label={`${t.finances.rules.operator} ${index + 1}`}
                  value={condition.op}
                  onValueChange={(value) =>
                    updateCondition(index, { op: value as RuleOp })
                  }
                  options={RULE_OPS.map((op) => ({ value: op, label: opLabel(op, t) }))}
                />
                <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:contents">
                  {condition.op === "between" ? (
                    <div className="flex gap-2">
                      <Input
                        aria-label={`${t.finances.rules.betweenFrom} ${index + 1}`}
                        placeholder={t.finances.rules.betweenFrom}
                        inputMode="decimal"
                        value={condition.from}
                        onChange={(e) => updateCondition(index, { from: e.target.value })}
                      />
                      <Input
                        aria-label={`${t.finances.rules.betweenTo} ${index + 1}`}
                        placeholder={t.finances.rules.betweenTo}
                        inputMode="decimal"
                        value={condition.to}
                        onChange={(e) => updateCondition(index, { to: e.target.value })}
                      />
                    </div>
                  ) : condition.field === "kind" && condition.op === "is" ? (
                    <SimpleSelect
                      aria-label={`${t.finances.rules.value} ${index + 1}`}
                      value={condition.value}
                      onValueChange={(value) => updateCondition(index, { value })}
                      options={[
                        { value: "expense", label: t.finances.rules.kindExpense },
                        { value: "income", label: t.finances.rules.kindIncome },
                      ]}
                    />
                  ) : (
                    <Input
                      aria-label={`${t.finances.rules.value} ${index + 1}`}
                      placeholder={
                        condition.op === "one_of"
                          ? t.finances.rules.oneOfHint
                          : condition.field === "date"
                            ? "2026-01-31"
                            : t.finances.rules.value
                      }
                      inputMode={
                        NUMERIC_OPS.has(condition.op) && condition.field === "amount"
                          ? "decimal"
                          : undefined
                      }
                      value={condition.value}
                      onChange={(e) => updateCondition(index, { value: e.target.value })}
                    />
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t.finances.rules.removeCondition} ${index + 1}`}
                    disabled={form.conditions.length === 1}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        conditions: prev.conditions.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  conditions: [...prev.conditions, { ...emptyCondition }],
                }))
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t.finances.rules.addCondition}
            </Button>
            {invalidPattern && (
              <p className="text-[11px] text-destructive">
                {t.finances.rules.regexInvalid}
              </p>
            )}
            {!completeConditions && (
              <p className="text-[11px] text-foreground-subtle">
                {t.finances.rules.needsCondition}
              </p>
            )}
          </fieldset>

          {/* Actions */}
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-foreground-muted">
              {t.finances.rules.actions}
            </legend>
            <p className="text-xs text-foreground-subtle">{t.finances.rules.actionsHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                {actionLabel("category", t.finances.rules.actionCategory)}
                {form.enabledActions.includes("category") && (
                  <CategorySelect
                    value={form.category}
                    onChange={(category) => setForm((prev) => ({ ...prev, category }))}
                    used={transactions.map((tx) => tx.category)}
                    ariaLabel={t.finances.rules.actionCategory}
                  />
                )}
              </div>
              <div className="space-y-1">
                {actionLabel("project_id", t.finances.rules.actionProject)}
                {form.enabledActions.includes("project_id") && (
                  <SimpleSelect
                    aria-label={t.finances.rules.actionProject}
                    value={form.project_id}
                    onValueChange={(project_id) =>
                      setForm((prev) => ({ ...prev, project_id }))
                    }
                    options={[
                      { value: "", label: t.finances.noneOption },
                      ...projects.map((project) => ({
                        value: project.id,
                        label: project.name,
                      })),
                    ]}
                  />
                )}
              </div>
              <div className="space-y-1">
                {actionLabel("subscription_id", t.finances.rules.actionSubscription)}
                {form.enabledActions.includes("subscription_id") && (
                  <SimpleSelect
                    aria-label={t.finances.rules.actionSubscription}
                    value={form.subscription_id}
                    onValueChange={(subscription_id) =>
                      setForm((prev) => ({ ...prev, subscription_id }))
                    }
                    options={[
                      { value: "", label: t.finances.noneOption },
                      ...subscriptions.map((subscription) => ({
                        value: subscription.id,
                        label: subscription.name,
                      })),
                    ]}
                  />
                )}
              </div>
              <div className="space-y-1">
                {actionLabel("note", t.finances.rules.actionNote)}
                {form.enabledActions.includes("note") && (
                  <Input
                    aria-label={t.finances.rules.actionNote}
                    placeholder={t.finances.rules.actionNotePlaceholder}
                    value={form.note}
                    onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  />
                )}
              </div>
            </div>
            {!RULE_ACTION_KEYS.some((key) => key in actions) && (
              <p className="text-[11px] text-foreground-subtle">
                {t.finances.rules.needsAction}
              </p>
            )}
          </fieldset>

          {/* Match preview */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted/30 p-3">
            <p className="flex-1 text-xs tabular text-foreground-muted" aria-live="polite">
              {t.finances.rules.matchesLoaded(matched, transactions.length)}
              {visibleCount && (
                <>
                  {" · "}
                  {t.finances.rules.checkedResult(visibleCount.matched, visibleCount.changed)}
                  {visibleCount.truncated && ` ${t.finances.rules.truncated}`}
                </>
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkMutation.mutate({ stage: form.stage, conditions, actions, fingerprint })}
              disabled={busy || !completeConditions}
            >
              {checkMutation.isPending
                ? t.finances.rules.checking
                : t.finances.rules.checkAll}
            </Button>
          </div>

          {saveError && <p role="alert" className="text-xs text-destructive">{t.finances.rules.saveErr}</p>}
          {checkError && <p role="alert" className="text-xs text-destructive">{t.finances.rules.applyErr}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || busy}
            >
              {t.common.save}
            </Button>
          </div>
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
