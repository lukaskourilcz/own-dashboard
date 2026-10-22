'use client';

import { DNESKAI_TOPIC_STATUSES, type DneskaiTopic, type DneskaiTopicActionResult, type DneskaiTopicsRead, type DneskaiTopicStatus } from '@/lib/marketing/dneskai-topics';
import type { DneskaiTopicsApi } from '@/lib/marketing/dneskai-topics-client';
import { createDneskaiTopicsFixture } from './dneskai-topics-fixtures';

/**
 * The deterministic stand-in for /api/marketing/dneskai/topics in `/dev-preview` (#154). It keeps the fixture topics
 * in memory and applies approve, reject, restore and edit with the transitions of 20261023100000; nothing reaches a
 * server.
 */
let store: DneskaiTopicsRead | null = null;
const read = () => (store ??= createDneskaiTopicsFixture(new Date()));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function resetDemoDneskaiTopics() { store = null; }

const all = (value: DneskaiTopicsRead) => (['news', 'education'] as const).flatMap((kind) => DNESKAI_TOPIC_STATUSES.flatMap((status) => value.groups[kind][status]));
function move(topic: DneskaiTopic, status: DneskaiTopicStatus, patch: Partial<DneskaiTopic> = {}) {
  const value = read();
  if (status === topic.status) {
    const next = { ...topic, ...patch, updatedAt: new Date().toISOString() };
    value.groups[topic.kind][status] = value.groups[topic.kind][status].map((item) => item.id === topic.id ? next : item);
    return next;
  }
  value.groups[topic.kind][topic.status] = value.groups[topic.kind][topic.status].filter((item) => item.id !== topic.id);
  const next = { ...topic, ...patch, status, updatedAt: new Date().toISOString() };
  value.groups[topic.kind][status] = [next, ...value.groups[topic.kind][status]];
  return next;
}
const FROM: Record<'approve' | 'reject' | 'restore', { from: readonly DneskaiTopicStatus[]; to: DneskaiTopicStatus }> = {
  approve: { from: ['proposed'], to: 'approved' },
  reject: { from: ['proposed', 'approved'], to: 'rejected' },
  restore: { from: ['rejected', 'expired'], to: 'proposed' },
};

export const demoDneskaiTopicsApi: DneskaiTopicsApi = {
  preview: true,
  async loadTopics() { await pause(80); return structuredClone(read()); },
  async act(action): Promise<DneskaiTopicActionResult> {
    await pause(80);
    if (action.action === 'approve' || action.action === 'reject' || action.action === 'restore') {
      const rule = FROM[action.action];
      return { ok: true, results: [...new Set(action.topicIds)].map((topicId) => {
        const topic = all(read()).find((item) => item.id === topicId);
        if (!topic) return { id: topicId, error: 'topic-unavailable' };
        if (!rule.from.includes(topic.status)) return { id: topicId, error: 'topic-status-changed' };
        const next = move(topic, rule.to, { approvedAt: rule.to === 'approved' ? new Date().toISOString() : null });
        return { id: next.id, status: next.status };
      }) };
    }
    if (action.action === 'edit') {
      const topic = all(read()).find((item) => item.id === action.topicId);
      if (!topic) return { ok: true, results: [{ id: action.topicId, error: 'topic-unavailable' }] };
      const next = move(topic, topic.status, { title: action.title, keyword: action.keyword });
      return { ok: true, results: [{ id: next.id, status: next.status }] };
    }
    return { ok: true, results: [] };
  },
};
