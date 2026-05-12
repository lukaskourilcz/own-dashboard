"use client";

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Book, BookPage, BookStatus, Profile } from "@/lib/types";
import type { CoupleContext } from "@/lib/couple";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

let tentativeBookPageCounter = 0;

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

type NewBookForm = {
  title: string;
  target_pages: string;
  started_on: string;
  shareWithPartner: boolean;
};

const emptyBook: NewBookForm = {
  title: "",
  target_pages: "",
  started_on: todayStr(),
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

  const partnerProfile: Profile | null = ctx.partnerProfile;
  const partnerName =
    partnerProfile?.display_name ?? partnerProfile?.email ?? "Partner";

  const activeBooks = books.filter((b) => b.status === "active");
  const otherBooks = books.filter((b) => b.status !== "active");

  function bufFor(bookId: string) {
    return logBuf[bookId] ?? { pages: "", note: "" };
  }

  function setBuf(bookId: string, patch: Partial<{ pages: string; note: string }>) {
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
    const target = newBook.target_pages
      ? Number(newBook.target_pages)
      : null;
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
    const today = todayStr();
    const existing = pages.find(
      (p) =>
        p.book_id === book.id && p.user_id === userId && p.log_date === today,
    );

    if (existing) {
      // Add to today's existing row.
      const merged = { pages: existing.pages + n, note: buf.note || existing.note };
      setPages((prev) =>
        prev.map((p) =>
          p.id === existing.id ? { ...p, pages: merged.pages, note: merged.note ?? p.note } : p,
        ),
      );
      const { error } = await supabase
        .from("book_pages")
        .update({ pages: merged.pages, note: merged.note })
        .eq("id", existing.id);
      if (error) {
        setPages((prev) => prev.map((p) => (p.id === existing.id ? existing : p)));
        toast.err(error.message);
        return;
      }
    } else {
      // Optimistic insert.
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
      `Delete "${book.title}" and all its page logs? This cannot be undone.`,
    );
    if (!ok) return;
    setBooks((prev) => prev.filter((b) => b.id !== book.id));
    setPages((prev) => prev.filter((p) => p.book_id !== book.id));
    const { error } = await supabase.from("books").delete().eq("id", book.id);
    if (error) {
      toast.err(error.message);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="h-4 w-4" />
              {activeBooks.length === 0
                ? "Start a book"
                : activeBooks.length === 1
                  ? "Current book"
                  : "Current books"}
            </span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowNew((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {showNew ? "Cancel" : "New book"}
          </Button>
        </CardHeader>
        <CardContent>
          {showNew && (
            <form
              onSubmit={addBook}
              className="mb-4 rounded-md border border-zinc-200 dark:border-zinc-800 p-3 space-y-2"
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
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
                <div className="space-y-1">
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
              </div>
              <div className="grid gap-2 sm:grid-cols-2 items-end">
                <div className="space-y-1">
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
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300"
                      checked={newBook.shareWithPartner}
                      onChange={(e) =>
                        setNewBook({
                          ...newBook,
                          shareWithPartner: e.target.checked,
                        })
                      }
                    />
                    Co-write with {partnerName}
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  <Plus className="h-4 w-4" /> Add book
                </Button>
              </div>
            </form>
          )}

          {activeBooks.length === 0 && !showNew ? (
            <p className="text-sm text-zinc-500">
              No active book. Click <span className="font-medium">New book</span> to
              start one.
            </p>
          ) : (
            <ul className="space-y-4">
              {activeBooks.map((book) => (
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
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {otherBooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past and paused</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {otherBooks.map((book) => {
                const bookPages = pages.filter((p) => p.book_id === book.id);
                const total = bookPages.reduce((s, p) => s + p.pages, 0);
                return (
                  <li
                    key={book.id}
                    className="flex items-center justify-between py-2.5 gap-3"
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium truncate",
                          book.status === "done" && "line-through text-zinc-400",
                        )}
                      >
                        {book.title}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {book.status} · {total} pages logged
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
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteBook(book)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
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
  const today = todayStr();
  const myTotal = pages
    .filter((p) => p.user_id === userId)
    .reduce((s, p) => s + p.pages, 0);
  const partnerTotal = pages
    .filter((p) => p.user_id !== userId)
    .reduce((s, p) => s + p.pages, 0);
  const total = myTotal + partnerTotal;
  const todayMine = pages
    .filter((p) => p.user_id === userId && p.log_date === today)
    .reduce((s, p) => s + p.pages, 0);
  const todayPartner = pages
    .filter((p) => p.user_id !== userId && p.log_date === today)
    .reduce((s, p) => s + p.pages, 0);
  const percent = book.target_pages
    ? Math.min(100, Math.round((total / book.target_pages) * 100))
    : null;
  const partnerId = partnerProfile?.id ?? null;

  const last14 = useMemo(() => {
    const buckets = new Map<string, { date: string; me: number; partner: number }>();
    for (let i = 13; i >= 0; i--) {
      const key = format(subDays(new Date(), i), "yyyy-MM-dd");
      buckets.set(key, { date: format(subDays(new Date(), i), "MMM d"), me: 0, partner: 0 });
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
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate inline-flex items-center gap-2">
            {book.title}
            {isShared && (
              <span className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium">
                shared
              </span>
            )}
          </p>
          <p className="text-xs text-zinc-500">
            {book.target_pages
              ? `${total} / ${book.target_pages} pages`
              : `${total} pages`}
            {book.started_on ? ` · started ${book.started_on}` : ""}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onStatus("done")}
            title="Mark book as done"
          >
            <Check className="h-3.5 w-3.5" /> Done
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onStatus("paused")}
            aria-label="Pause book"
          >
            <Pause className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label="Delete book"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      {percent !== null && (
        <div>
          <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">{percent}% of target</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
          <p className="text-xs text-zinc-500">{userName} (you)</p>
          <p className="text-lg font-semibold">{myTotal}</p>
          <p className="text-[11px] text-zinc-500">
            today {todayMine > 0 ? `+${todayMine}` : "0"}
          </p>
        </div>
        {isShared ? (
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
            <p className="text-xs text-zinc-500">{partnerName}</p>
            <p className="text-lg font-semibold">{partnerTotal}</p>
            <p className="text-[11px] text-zinc-500">
              today {todayPartner > 0 ? `+${todayPartner}` : "0"}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 p-2 inline-flex flex-col justify-center text-xs text-zinc-400">
            <CircleSlash className="h-3.5 w-3.5 mb-1" />
            Solo book
          </div>
        )}
      </div>

      {last14.some((d) => d.me + d.partner > 0) && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={last14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" fontSize={10} />
              <YAxis fontSize={10} width={28} />
              <Tooltip
                formatter={(value, name) => [
                  `${value} pages`,
                  name === "me" ? userName : partnerName,
                ]}
              />
              <Legend
                formatter={(name) => (name === "me" ? userName : partnerName)}
              />
              <Bar dataKey="me" stackId="a" fill="#10b981" />
              {isShared && <Bar dataKey="partner" stackId="a" fill="#6366f1" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end pt-1 border-t border-zinc-100 dark:border-zinc-800">
        <div className="space-y-1 w-24">
          <Label htmlFor={`pages-${book.id}`} className="text-xs">
            Pages today
          </Label>
          <Input
            id={`pages-${book.id}`}
            type="number"
            min={1}
            value={logBuf.pages}
            onChange={(e) => onBufChange({ pages: e.target.value })}
            placeholder="3"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-40">
          <Label htmlFor={`note-${book.id}`} className="text-xs">
            Note
          </Label>
          <Textarea
            id={`note-${book.id}`}
            rows={1}
            value={logBuf.note}
            onChange={(e) => onBufChange({ note: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <Button onClick={onLog}>
          <Pencil className="h-4 w-4" />
          Log
        </Button>
      </div>
    </li>
  );
}
