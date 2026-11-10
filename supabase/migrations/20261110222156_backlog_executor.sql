-- The same task is read by Backlog, Home, Tasks and its project Strategy.
alter table public.backlog_items add column if not exists executor text not null default 'ai';
alter table public.backlog_items add constraint backlog_items_executor_check check (executor in ('me', 'ai'));
comment on column public.backlog_items.executor is 'me = owner decision/identity; ai = work executable in terminal or Chrome. Does not authorize publishing or paid runs.';
