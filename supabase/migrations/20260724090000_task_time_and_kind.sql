-- Richer task metadata for the Tasks section: an estimated time-to-complete
-- (minutes) and a work-kind classification. Both are optional; NEEDED.md tasks
-- carry them from `[time:N]` / `[kind:…]` markers on their source line, and
-- manual tasks can set them by hand. These power the Time and Category filters
-- and the per-task tags shown wherever a task is rendered.

alter table public.todos
  add column if not exists estimated_minutes integer
  check (estimated_minutes is null or estimated_minutes between 1 and 100000);

-- Work kind — a small, fixed vocabulary that covers the owner-rollout tasks the
-- repos actually carry: setup (secrets/env/third-party wiring), deploy
-- (deploy/migrations/verification), legal (privacy/terms/licensing), content
-- (media/copy/assets), decision (owner choices/approvals).
alter table public.todos
  add column if not exists task_kind text
  check (
    task_kind is null
    or task_kind in ('setup', 'deploy', 'legal', 'content', 'decision')
  );

create index if not exists todos_user_kind_idx
  on public.todos (user_id, task_kind)
  where task_kind is not null;
