"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListFilter, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/ui/page-header";
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

/** Actions the owner actually asked for: a field left blank is not an action. */
function chosenActions(draft: RuleDraft): RuleActions {
  const actions = draftActions(draft);
  const chosen: RuleActions = {};
  if (actions.category != null) chosen.category = actions.category;
  if (actions.project_id != null) chosen.project_id = actions.project_id;
  if (actions.subscription_id != null) chosen.subscription_id = actions.subscription_id;
  if (actions.note != null) chosen.note = actions.note;
  return chosen;
}

function toDraft(rule: TransactionRule): RuleDraft {
  return {
    id: rule.id,
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
  return {
    id: draft.id ?? "draft",
    user_id: "",
    name: draft.name,
    stage: draft.stage,
    conditions: draftConditions(draft),
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
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transaction_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.transactionRules }),
    onError: () => toast.err(t.finances.rules.saveErr),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("transaction_rules")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.transactionRules }),
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
      return (await res.json()) as { updated: number };
    },
    onSuccess: ({ updated }) => {
      toast.ok(
        updated > 0 ? t.finances.rules.applyDone(updated) : t.finances.rules.applyNothing,
      );
      if (updated > 0) void qc.invalidateQueries({ queryKey: qk.transactions });
    },
    onError: () => toast.err(t.finances.rules.applyErr),
  });

  async function requestApply(ruleId: string | null) {
    const ok = await confirm({
      title: t.finances.rules.applyConfirmTitle,
      description: t.finances.rules.applyConfirmBody,
      confirmLabel: t.finances.rules.applyConfirmLabel,
      cancelLabel: t.common.cancel,
    });
    if (ok) applyMutation.mutate(ruleId);
  }

  async function requestDelete(id: string) {
    const ok = await confirm({
      title: t.finances.rules.deleteConfirmTitle,
      description: t.finances.rules.deleteConfirmBody,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    });
    if (ok) deleteMutation.mutate(id);
  }

  const activeRules = useMemo(() => usableRules(rules), [rules]);

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
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
              disabled={applyMutation.isPending}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {applyMutation.isPending
                ? t.finances.rules.applying
                : t.finances.rules.apply}
            </Button>
          )}
          <Button size="sm" onClick={() => openDraft({ ...emptyDraft })}>
            <Plus className="h-3.5 w-3.5" />
            {t.finances.rules.newRule}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {rulesQuery.isError && (
          <p className="text-xs text-destructive">{t.finances.rules.loadErr}</p>
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
                <SectionLabel>{stageLabel(stage, t)}</SectionLabel>
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
                        onDelete={() => void requestDelete(rule.id)}
                        onToggle={(enabled) =>
                          toggleMutation.mutate({ id: rule.id, enabled })
                        }
                        onApply={() => void requestApply(rule.id)}
                        applying={applyMutation.isPending}
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
            aria-label={rule.enabled ? t.finances.rules.enabled : t.finances.rules.disabled}
          />
          <Tooltip content={t.finances.rules.apply}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onApply}
              disabled={applying}
              aria-label={t.finances.rules.apply}
            >
              <Wand2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.common.edit}>
            <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={t.common.edit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.common.delete}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDelete}
              aria-label={t.common.delete}
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
  const toast = useToast();
  const nameId = useId();
  const stageId = useId();
  const enabledId = useId();
  const [form, setForm] = useState<RuleDraft>(draft);
  const [fullCount, setFullCount] = useState<{
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
  const canSave =
    conditions.length > 0 && RULE_ACTION_KEYS.some((key) => key in actions);

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/money/rules/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          draft: { stage: form.stage, conditions, actions },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as {
        matched: number;
        changed: number;
        truncated?: boolean;
      };
    },
    onSuccess: (result) =>
      setFullCount({
        matched: result.matched,
        changed: result.changed,
        truncated: result.truncated === true,
      }),
    onError: () => toast.err(t.finances.rules.applyErr),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const payload = {
        user_id: userId,
        name: form.name.trim(),
        stage: form.stage,
        conditions,
        actions,
        enabled: form.enabled,
      };
      const { error } = form.id
        ? await supabase.from("transaction_rules").update(payload).eq("id", form.id)
        : await supabase.from("transaction_rules").insert(payload);
      if (error) throw error;
    },
    onSuccess: onSaved,
    onError: () => toast.err(t.finances.rules.saveErr),
  });

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {form.id ? t.finances.rules.editRule : t.finances.rules.newRule}
          </DialogTitle>
          <DialogDescription>{t.finances.rules.stageHint}</DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
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
                className="grid gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,10rem)_minmax(0,1fr)_auto]"
              >
                <SimpleSelect
                  aria-label={t.finances.rules.field}
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
                  aria-label={t.finances.rules.operator}
                  value={condition.op}
                  onValueChange={(value) =>
                    updateCondition(index, { op: value as RuleOp })
                  }
                  options={RULE_OPS.map((op) => ({ value: op, label: opLabel(op, t) }))}
                />
                {condition.op === "between" ? (
                  <div className="flex gap-2">
                    <Input
                      aria-label={t.finances.rules.betweenFrom}
                      placeholder={t.finances.rules.betweenFrom}
                      inputMode="decimal"
                      value={condition.from}
                      onChange={(e) => updateCondition(index, { from: e.target.value })}
                    />
                    <Input
                      aria-label={t.finances.rules.betweenTo}
                      placeholder={t.finances.rules.betweenTo}
                      inputMode="decimal"
                      value={condition.to}
                      onChange={(e) => updateCondition(index, { to: e.target.value })}
                    />
                  </div>
                ) : condition.field === "kind" && condition.op === "is" ? (
                  <SimpleSelect
                    aria-label={t.finances.rules.value}
                    value={condition.value}
                    onValueChange={(value) => updateCondition(index, { value })}
                    options={[
                      { value: "expense", label: t.finances.rules.kindExpense },
                      { value: "income", label: t.finances.rules.kindIncome },
                    ]}
                  />
                ) : (
                  <Input
                    aria-label={t.finances.rules.value}
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
                  aria-label={t.finances.rules.removeCondition}
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
            {conditions.length === 0 && (
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t.finances.rules.actionCategory}</Label>
                <CategorySelect
                  value={form.category}
                  onChange={(category) => setForm((prev) => ({ ...prev, category }))}
                  used={transactions.map((tx) => tx.category)}
                  ariaLabel={t.finances.rules.actionCategory}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.finances.rules.actionProject}</Label>
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
              </div>
              <div className="space-y-1">
                <Label>{t.finances.rules.actionSubscription}</Label>
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
              </div>
              <div className="space-y-1">
                <Label>{t.finances.rules.actionNote}</Label>
                <Input
                  aria-label={t.finances.rules.actionNote}
                  placeholder={t.finances.rules.actionNotePlaceholder}
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                />
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
              {fullCount && (
                <>
                  {" · "}
                  {t.finances.rules.checkedResult(fullCount.matched, fullCount.changed)}
                  {fullCount.truncated && ` ${t.finances.rules.truncated}`}
                </>
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || conditions.length === 0}
            >
              {checkMutation.isPending
                ? t.finances.rules.checking
                : t.finances.rules.checkAll}
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
            >
              {t.common.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
