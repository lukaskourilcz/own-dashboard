"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BookOpen,
  Check,
  CircleSlash,
  Pause,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { todayKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
import { useDict, useDateLocale } from "@/lib/i18n";
import type { Book, BookPage, BookStatus, Profile, Updater } from "@/lib/types";
import { partnerDisplayName, type CoupleContext } from "@/lib/couple";

let tentativeBookPageCounter = 0;

type NewBookForm = {
  title: string;
  target_pages: string;
  started_on: string;
  shareWithPartner: boolean;
};

const emptyBook: NewBookForm = {
  title: "",
  target_pages: "",
  started_on: todayKey(),
  shareWithPartner: true,
};

export function BooksPanel({
  books,
  setBooks,
  pages,
  setPages,
  userId,
  userName,
  ctx,
}: {
  books: Book[];
  setBooks: Updater<Book[]>;
  pages: BookPage[];
  setPages: Updater<BookPage[]>;
  userId: string;
  userName: string;
  ctx: CoupleContext;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const [newBook, setNewBook] = useState<NewBookForm>(emptyBook);
  const [logBuf, setLogBuf] = useState<
    Record<string, { pages: string; note: string }>
  >({});
  const [showNew, setShowNew] = useState(false);

  const { partnerProfile } = ctx;
  const partnerName = partnerDisplayName(partnerProfile);

  const activeBooks = books.filter((b) => b.status === "active");
  const otherBooks = books.filter((b) => b.status !== "active");

  function bufFor(bookId: string) {
    return logBuf[bookId] ?? { pages: "", note: "" };
  }

  function setBuf(
    bookId: string,
    patch: Partial<{ pages: string; note: string }>,
  ) {
    setLogBuf((prev) => ({
      ...prev,
      [bookId]: { ...bufFor(bookId), ...patch },
    }));
  }

  // CREATE: needs the server-generated id, so apply state in onSuccess.
  const addMutation = useMutation({
    mutationFn: async (target: number | null) => {
      const { data, error } = await supabase
        .from("books")
        .insert({
          user_id: userId,
          couple_id:
            newBook.shareWithPartner && ctx.couple ? ctx.couple.id : null,
          title: newBook.title.trim(),
          target_pages: target,
          started_on: newBook.started_on || null,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error(t.books.couldNotAddBook);
      return data as Book;
    },
    onSuccess: (data) => {
      setBooks((prev) => [data, ...prev]);
      setNewBook(emptyBook);
      setShowNew(false);
      toast.ok(t.books.addedToast(data.title));
      void qc.invalidateQueries({ queryKey: qk.books });
    },
    onError: (e) => {
      toast.err(e instanceof Error ? e.message : t.books.couldNotAddBook);
    },
  });

  // Logging a page either updates an existing same-day row (optimistic, state
  // changed before the await) or inserts a brand-new one (needs the server id,
  // so a tentative row is swapped in onSuccess). Both branches live in one
  // book_pages mutation and reconcile via invalidate once settled.
  const logMutation = useMutation({
    mutationFn: async ({
      book,
      n,
      buf,
      today,
      existing,
    }: {
      book: Book;
      n: number;
      buf: { pages: string; note: string };
      today: string;
      existing: BookPage | undefined;
      tentativeId: string;
    }) => {
      if (existing) {
        const merged = {
          pages: existing.pages + n,
          note: buf.note || existing.note,
        };
        const { error } = await supabase
          .from("book_pages")
          .update({ pages: merged.pages, note: merged.note })
          .eq("id", existing.id);
        if (error) throw error;
        return null;
      }
      const { data, error } = await supabase
        .from("book_pages")
        .insert({
          book_id: book.id,
          user_id: userId,
          log_date: today,
          pages: n,
          note: buf.note || null,
        })
        .select()
        .single();
      if (error || !data)
        throw error ?? new Error(t.books.couldNotLogPages);
      return data as BookPage;
    },
    onMutate: async ({ book, n, buf, today, existing, tentativeId }) => {
      await qc.cancelQueries({ queryKey: qk.bookPages });
      const prev = qc.getQueryData<BookPage[]>(qk.bookPages);
      if (existing) {
        const merged = {
          pages: existing.pages + n,
          note: buf.note || existing.note,
        };
        setPages((old) =>
          old.map((p) =>
            p.id === existing.id
              ? { ...p, pages: merged.pages, note: merged.note ?? p.note }
              : p,
          ),
        );
      } else {
        const tentative: BookPage = {
          id: tentativeId,
          book_id: book.id,
          user_id: userId,
          log_date: today,
          pages: n,
          note: buf.note || null,
          created_at: "",
        };
        setPages((old) => [tentative, ...old]);
      }
      return { prev, existing, tentativeId };
    },
    onSuccess: (data, { book, n, tentativeId }, ctx2) => {
      // Insert branch: swap the tentative row for the server row.
      if (!ctx2?.existing && data) {
        setPages((prev) => prev.map((p) => (p.id === tentativeId ? data : p)));
      }
      setBuf(book.id, { pages: "", note: "" });
      toast.ok(t.books.loggedToast(n, book.title));
    },
    onError: (e, _vars, ctx2) => {
      if (ctx2?.prev) qc.setQueryData(qk.bookPages, ctx2.prev);
      if (ctx2?.existing) {
        const existing = ctx2.existing;
        setPages((prev) => prev.map((p) => (p.id === existing.id ? existing : p)));
      } else if (ctx2?.tentativeId) {
        const tentativeId = ctx2.tentativeId;
        setPages((prev) => prev.filter((p) => p.id !== tentativeId));
      }
      toast.err(e instanceof Error ? e.message : t.books.couldNotLogPages);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.bookPages }),
  });

  // Optimistic status change: state flips before the await.
  const statusMutation = useMutation({
    mutationFn: async ({ book, status }: { book: Book; status: BookStatus }) => {
      const { error } = await supabase
        .from("books")
        .update({ status })
        .eq("id", book.id);
      if (error) throw error;
    },
    onMutate: async ({ book, status }) => {
      await qc.cancelQueries({ queryKey: qk.books });
      const prev = qc.getQueryData<Book[]>(qk.books);
      setBooks((old) =>
        old.map((b) => (b.id === book.id ? { ...b, status } : b)),
      );
      return { prev };
    },
    onError: (e, { book }, ctx2) => {
      if (ctx2?.prev) qc.setQueryData(qk.books, ctx2.prev);
      setBooks((prev) =>
        prev.map((b) => (b.id === book.id ? { ...b, status: book.status } : b)),
      );
      toast.err(e instanceof Error ? e.message : t.books.couldNotAddBook);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.books }),
  });

  // Optimistic delete: removes the book and its pages before the await. The
  // book row lives under qk.books while its logs live under qk.bookPages, so
  // both caches are snapshotted, updated, rolled back, and invalidated.
  const deleteMutation = useMutation({
    mutationFn: async (book: Book) => {
      const { error } = await supabase.from("books").delete().eq("id", book.id);
      if (error) throw error;
    },
    onMutate: async (book) => {
      await qc.cancelQueries({ queryKey: qk.books });
      await qc.cancelQueries({ queryKey: qk.bookPages });
      const prevBooks = qc.getQueryData<Book[]>(qk.books);
      const prevPages = qc.getQueryData<BookPage[]>(qk.bookPages);
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
      setPages((prev) => prev.filter((p) => p.book_id !== book.id));
      return { prevBooks, prevPages };
    },
    onError: (e, _book, ctx2) => {
      if (ctx2?.prevBooks) qc.setQueryData(qk.books, ctx2.prevBooks);
      if (ctx2?.prevPages) qc.setQueryData(qk.bookPages, ctx2.prevPages);
      toast.err(e instanceof Error ? e.message : t.books.couldNotAddBook);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.books });
      void qc.invalidateQueries({ queryKey: qk.bookPages });
    },
  });

  function addBook(e: React.FormEvent) {
    e.preventDefault();
    if (!newBook.title.trim()) {
      toast.err(t.books.titleRequiredToast);
      return;
    }
    const target = newBook.target_pages ? Number(newBook.target_pages) : null;
    if (target !== null && (Number.isNaN(target) || target <= 0)) {
      toast.err(t.books.targetPagesPositiveToast);
      return;
    }
    addMutation.mutate(target);
  }

  function logPages(book: Book) {
    const buf = bufFor(book.id);
    const n = Number(buf.pages);
    if (!buf.pages || Number.isNaN(n) || n <= 0) {
      toast.err(t.books.pagesPositiveToast);
      return;
    }
    const today = todayKey();
    const existing = pages.find(
      (p) =>
        p.book_id === book.id && p.user_id === userId && p.log_date === today,
    );
    const tentativeId = `tmp-${++tentativeBookPageCounter}`;
    logMutation.mutate({ book, n, buf, today, existing, tentativeId });
  }

  function changeStatus(book: Book, status: BookStatus) {
    statusMutation.mutate({ book, status });
  }

  function deleteBook(book: Book) {
    const ok = window.confirm(t.books.deleteConfirm(book.title));
    if (!ok) return;
    deleteMutation.mutate(book);
  }

  return (
    <div>
      <PageHeader
        title={t.books.title}
        description={t.books.description}
        action={
          <Button
            size="sm"
            variant={showNew ? "outline" : "default"}
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? (
              t.books.cancel
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> {t.books.newBook}
              </>
            )}
          </Button>
        }
      />

      {showNew && (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <form
              onSubmit={addBook}
              className="grid gap-3 sm:grid-cols-4 items-end"
            >
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="book-title">{t.books.formTitle}</Label>
                <Input
                  id="book-title"
                  value={newBook.title}
                  onChange={(e) =>
                    setNewBook({ ...newBook, title: e.target.value })
                  }
                  placeholder={t.books.titlePlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="book-target">{t.books.targetPages}</Label>
                <Input
                  id="book-target"
                  type="number"
                  min={1}
                  value={newBook.target_pages}
                  onChange={(e) =>
                    setNewBook({ ...newBook, target_pages: e.target.value })
                  }
                  placeholder={t.books.targetPagesPlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="book-start">{t.books.startDate}</Label>
                <Input
                  id="book-start"
                  type="date"
                  value={newBook.started_on}
                  onChange={(e) =>
                    setNewBook({ ...newBook, started_on: e.target.value })
                  }
                />
              </div>
              {ctx.couple && (
                <label className="inline-flex items-center gap-2 text-xs text-foreground-muted sm:col-span-3">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border-strong"
                    checked={newBook.shareWithPartner}
                    onChange={(e) =>
                      setNewBook({
                        ...newBook,
                        shareWithPartner: e.target.checked,
                      })
                    }
                  />
                  {t.books.coReadWith(partnerName)}
                </label>
              )}
              <Button type="submit" className="sm:col-span-1">
                <Plus className="h-3.5 w-3.5" /> {t.books.addBook}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {activeBooks.length === 0 && !showNew ? (
          <Card>
            <CardContent className="pt-5">
              <EmptyState
                icon={BookOpen}
                title={t.books.noActiveBook}
                description={t.books.noActiveBookDescription}
              />
            </CardContent>
          </Card>
        ) : (
          activeBooks.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              pages={pages.filter((p) => p.book_id === book.id)}
              userId={userId}
              userName={userName}
              partnerProfile={partnerProfile}
              partnerName={partnerName}
              isShared={book.couple_id !== null}
              logBuf={bufFor(book.id)}
              onBufChange={(patch) => setBuf(book.id, patch)}
              onLog={() => logPages(book)}
              onStatus={(s) => changeStatus(book, s)}
              onDelete={() => deleteBook(book)}
            />
          ))
        )}

        {otherBooks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t.books.pastAndPaused}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="-mx-2 divide-y divide-border">
                {otherBooks.map((book) => {
                  const bookPages = pages.filter((p) => p.book_id === book.id);
                  const total = bookPages.reduce((s, p) => s + p.pages, 0);
                  return (
                    <li
                      key={book.id}
                      className="group flex items-center justify-between gap-3 px-2 py-2.5 row-hover"
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium truncate",
                            book.status === "done" &&
                              "line-through text-foreground-subtle",
                          )}
                        >
                          {book.title}
                        </p>
                        <p className="text-[11px] text-foreground-subtle tabular">
                          {t.books.statusLabel[book.status]} ·{" "}
                          {t.books.pagesCount(total)}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => changeStatus(book, "active")}
                        >
                          {t.books.resume}
                        </Button>
                        <Tooltip content={t.books.delete}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => deleteBook(book)}
                            aria-label={t.books.delete}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </Tooltip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function BookRow({
  book,
  pages,
  userId,
  userName,
  partnerProfile,
  partnerName,
  isShared,
  logBuf,
  onBufChange,
  onLog,
  onStatus,
  onDelete,
}: {
  book: Book;
  pages: BookPage[];
  userId: string;
  userName: string;
  partnerProfile: Profile | null;
  partnerName: string;
  isShared: boolean;
  logBuf: { pages: string; note: string };
  onBufChange: (patch: Partial<{ pages: string; note: string }>) => void;
  onLog: () => void;
  onStatus: (s: BookStatus) => void;
  onDelete: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const today = todayKey();
  const totals = pages.reduce(
    (acc, p) => {
      const mine = p.user_id === userId;
      if (mine) {
        acc.me += p.pages;
        if (p.log_date === today) acc.todayMe += p.pages;
      } else {
        acc.partner += p.pages;
        if (p.log_date === today) acc.todayPartner += p.pages;
      }
      return acc;
    },
    { me: 0, partner: 0, todayMe: 0, todayPartner: 0 },
  );
  const total = totals.me + totals.partner;
  const percent = book.target_pages
    ? Math.min(100, Math.round((total / book.target_pages) * 100))
    : null;
  const partnerId = partnerProfile?.id ?? null;

  const last14 = useMemo(() => {
    const buckets = new Map<
      string,
      { date: string; me: number; partner: number }
    >();
    for (let i = 13; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const key = format(d, "yyyy-MM-dd");
      buckets.set(key, {
        date: format(d, t.books.chartDateFormat, { locale }),
        me: 0,
        partner: 0,
      });
    }
    for (const p of pages) {
      const b = buckets.get(p.log_date);
      if (!b) continue;
      if (p.user_id === userId) b.me += p.pages;
      else if (partnerId && p.user_id === partnerId) b.partner += p.pages;
    }
    return [...buckets.values()];
  }, [pages, userId, partnerId, t, locale]);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-base tracking-tight inline-flex items-center gap-2">
              {book.title}
              {isShared && (
                <SectionLabel className="!text-[9px] text-success">
                  {t.books.shared}
                </SectionLabel>
              )}
            </h3>
            <p className="text-xs text-foreground-subtle tabular mt-0.5">
              {book.target_pages
                ? t.books.pagesProgress(total, book.target_pages)
                : t.books.pagesCount(total)}
              {book.started_on ? ` · ${t.books.startedOn(book.started_on)}` : ""}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Tooltip content={t.books.markAsDone}>
              <Button size="sm" variant="outline" onClick={() => onStatus("done")}>
                <Check className="h-3.5 w-3.5" /> {t.books.done}
              </Button>
            </Tooltip>
            <Tooltip content={t.books.pause}>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onStatus("paused")}
                aria-label={t.books.pauseBook}
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t.books.delete}>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onDelete}
                aria-label={t.books.deleteBook}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {percent !== null && (
          <div className="mb-4">
            <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
              <div
                className="h-full bg-foreground transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-[10px] text-foreground-subtle mt-1 tabular">
              {t.books.percentOfTarget(percent)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Stat
            label={t.books.youSuffix(userName)}
            value={totals.me}
            todayDelta={totals.todayMe}
          />
          {isShared ? (
            <Stat
              label={partnerName}
              value={totals.partner}
              todayDelta={totals.todayPartner}
            />
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 flex flex-col justify-center text-xs text-foreground-subtle">
              <CircleSlash className="h-3.5 w-3.5 mb-1" />
              {t.books.solo}
            </div>
          )}
        </div>

        {last14.some((d) => d.me + d.partner > 0) && (
          <div className="h-28 mb-4 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--foreground-subtle)"
                />
                <YAxis
                  fontSize={10}
                  width={24}
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--foreground-subtle)"
                />
                <RTooltip
                  cursor={{ fill: "var(--surface-hover)" }}
                  formatter={(value, name) => [
                    t.books.pagesTooltip(Number(value)),
                    name === "me" ? userName : partnerName,
                  ]}
                  contentStyle={chartTooltipStyle}
                />
                <Legend
                  iconType="circle"
                  iconSize={6}
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(name) => (name === "me" ? userName : partnerName)}
                />
                <Bar
                  dataKey="me"
                  stackId="a"
                  fill="var(--foreground)"
                  radius={[2, 2, 0, 0]}
                />
                {isShared && (
                  <Bar
                    dataKey="partner"
                    stackId="a"
                    fill="var(--foreground-subtle)"
                    radius={[2, 2, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Log row */}
        <div className="flex flex-wrap gap-2 items-end pt-3 border-t border-border">
          <div className="space-y-1.5 w-24">
            <Label htmlFor={`pages-${book.id}`}>{t.books.pagesToday}</Label>
            <Input
              id={`pages-${book.id}`}
              type="number"
              min={1}
              value={logBuf.pages}
              onChange={(e) => onBufChange({ pages: e.target.value })}
              placeholder={t.books.pagesTodayPlaceholder}
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-40">
            <Label htmlFor={`note-${book.id}`}>{t.books.note}</Label>
            <Textarea
              id={`note-${book.id}`}
              rows={1}
              value={logBuf.note}
              onChange={(e) => onBufChange({ note: e.target.value })}
              placeholder={t.books.notePlaceholder}
              className="min-h-9 py-1.5"
            />
          </div>
          <Button onClick={onLog}>
            <Pencil className="h-3.5 w-3.5" /> {t.books.log}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  todayDelta,
}: {
  label: string;
  value: number;
  todayDelta: number;
}) {
  const t = useDict();
  return (
    <div className="rounded-md border border-border bg-surface-muted/40 p-3">
      <SectionLabel className="truncate">{label}</SectionLabel>
      <p className="mt-1 text-xl font-semibold tabular tracking-tight">
        {value}
      </p>
      <p className="text-[11px] text-foreground-subtle tabular">
        {t.books.todayDelta(todayDelta)}
      </p>
    </div>
  );
}

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "var(--shadow-card)",
  padding: "6px 10px",
};
