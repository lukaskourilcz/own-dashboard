"use client";

import { useMemo, useState } from "react";
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
import { todayKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
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
  const toast = useToast();
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

  async function addBook(e: React.FormEvent) {
    e.preventDefault();
    if (!newBook.title.trim()) {
      toast.err("Title is required.");
      return;
    }
    const target = newBook.target_pages ? Number(newBook.target_pages) : null;
    if (target !== null && (Number.isNaN(target) || target <= 0)) {
      toast.err("Target pages must be a positive number.");
      return;
    }
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
    if (error || !data) {
      toast.err(error?.message ?? "Could not add book.");
      return;
    }
    setBooks((prev) => [data, ...prev]);
    setNewBook(emptyBook);
    setShowNew(false);
    toast.ok(`Added "${data.title}".`);
  }

  async function logPages(book: Book) {
    const buf = bufFor(book.id);
    const n = Number(buf.pages);
    if (!buf.pages || Number.isNaN(n) || n <= 0) {
      toast.err("Pages must be a positive number.");
      return;
    }
    const today = todayKey();
    const existing = pages.find(
      (p) =>
        p.book_id === book.id && p.user_id === userId && p.log_date === today,
    );

    if (existing) {
      const merged = {
        pages: existing.pages + n,
        note: buf.note || existing.note,
      };
      setPages((prev) =>
        prev.map((p) =>
          p.id === existing.id
            ? { ...p, pages: merged.pages, note: merged.note ?? p.note }
            : p,
        ),
      );
      const { error } = await supabase
        .from("book_pages")
        .update({ pages: merged.pages, note: merged.note })
        .eq("id", existing.id);
      if (error) {
        setPages((prev) =>
          prev.map((p) => (p.id === existing.id ? existing : p)),
        );
        toast.err(error.message);
        return;
      }
    } else {
      const tentativeId = `tmp-${++tentativeBookPageCounter}`;
      const tentative: BookPage = {
        id: tentativeId,
        book_id: book.id,
        user_id: userId,
        log_date: today,
        pages: n,
        note: buf.note || null,
        created_at: "",
      };
      setPages((prev) => [tentative, ...prev]);
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
      if (error || !data) {
        setPages((prev) => prev.filter((p) => p.id !== tentativeId));
        toast.err(error?.message ?? "Could not log pages.");
        return;
      }
      setPages((prev) => prev.map((p) => (p.id === tentativeId ? data : p)));
    }
    setBuf(book.id, { pages: "", note: "" });
    toast.ok(`+${n} page${n === 1 ? "" : "s"} on "${book.title}"`);
  }

  async function changeStatus(book: Book, status: BookStatus) {
    setBooks((prev) =>
      prev.map((b) => (b.id === book.id ? { ...b, status } : b)),
    );
    const { error } = await supabase
      .from("books")
      .update({ status })
      .eq("id", book.id);
    if (error) {
      setBooks((prev) =>
        prev.map((b) => (b.id === book.id ? { ...b, status: book.status } : b)),
      );
      toast.err(error.message);
    }
  }

  async function deleteBook(book: Book) {
    const ok = window.confirm(
      `Delete "${book.title}" and all its page logs?`,
    );
    if (!ok) return;
    setBooks((prev) => prev.filter((b) => b.id !== book.id));
    setPages((prev) => prev.filter((p) => p.book_id !== book.id));
    const { error } = await supabase.from("books").delete().eq("id", book.id);
    if (error) toast.err(error.message);
  }

  return (
    <div>
      <PageHeader
        title="Books"
        description="What you're reading, page by page."
        action={
          <Button
            size="sm"
            variant={showNew ? "outline" : "default"}
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? "Cancel" : <><Plus className="h-3.5 w-3.5" /> New book</>}
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
                <Label htmlFor="book-title">Title</Label>
                <Input
                  id="book-title"
                  value={newBook.title}
                  onChange={(e) =>
                    setNewBook({ ...newBook, title: e.target.value })
                  }
                  placeholder="Untitled novel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="book-target">Target pages</Label>
                <Input
                  id="book-target"
                  type="number"
                  min={1}
                  value={newBook.target_pages}
                  onChange={(e) =>
                    setNewBook({ ...newBook, target_pages: e.target.value })
                  }
                  placeholder="300"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="book-start">Start date</Label>
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
                  Co-read with {partnerName}
                </label>
              )}
              <Button type="submit" className="sm:col-span-1">
                <Plus className="h-3.5 w-3.5" /> Add book
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
                title="No active book"
                description={`Click "New book" to start one.`}
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
              <CardTitle>Past and paused</CardTitle>
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
                          {book.status} · {total} pages
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => changeStatus(book, "active")}
                        >
                          Resume
                        </Button>
                        <Tooltip content="Delete">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => deleteBook(book)}
                            aria-label="Delete"
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
      buckets.set(key, { date: format(d, "MMM d"), me: 0, partner: 0 });
    }
    for (const p of pages) {
      const b = buckets.get(p.log_date);
      if (!b) continue;
      if (p.user_id === userId) b.me += p.pages;
      else if (partnerId && p.user_id === partnerId) b.partner += p.pages;
    }
    return [...buckets.values()];
  }, [pages, userId, partnerId]);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-base tracking-tight inline-flex items-center gap-2">
              {book.title}
              {isShared && (
                <SectionLabel className="!text-[9px] text-success">
                  shared
                </SectionLabel>
              )}
            </h3>
            <p className="text-xs text-foreground-subtle tabular mt-0.5">
              {book.target_pages
                ? `${total} / ${book.target_pages} pages`
                : `${total} pages`}
              {book.started_on ? ` · started ${book.started_on}` : ""}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Tooltip content="Mark as done">
              <Button size="sm" variant="outline" onClick={() => onStatus("done")}>
                <Check className="h-3.5 w-3.5" /> Done
              </Button>
            </Tooltip>
            <Tooltip content="Pause">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onStatus("paused")}
                aria-label="Pause book"
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Delete">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onDelete}
                aria-label="Delete book"
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
              {percent}% of target
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Stat
            label={`${userName} (you)`}
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
              Solo book
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
                    `${value} pages`,
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
            <Label htmlFor={`pages-${book.id}`}>Pages today</Label>
            <Input
              id={`pages-${book.id}`}
              type="number"
              min={1}
              value={logBuf.pages}
              onChange={(e) => onBufChange({ pages: e.target.value })}
              placeholder="3"
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-40">
            <Label htmlFor={`note-${book.id}`}>Note</Label>
            <Textarea
              id={`note-${book.id}`}
              rows={1}
              value={logBuf.note}
              onChange={(e) => onBufChange({ note: e.target.value })}
              placeholder="Optional"
              className="min-h-9 py-1.5"
            />
          </div>
          <Button onClick={onLog}>
            <Pencil className="h-3.5 w-3.5" /> Log
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
  return (
    <div className="rounded-md border border-border bg-surface-muted/40 p-3">
      <SectionLabel className="truncate">{label}</SectionLabel>
      <p className="mt-1 text-xl font-semibold tabular tracking-tight">
        {value}
      </p>
      <p className="text-[11px] text-foreground-subtle tabular">
        today {todayDelta > 0 ? `+${todayDelta}` : "0"}
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
