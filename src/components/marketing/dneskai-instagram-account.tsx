'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { qk } from '@/lib/queries/keys';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import { loadMarketingAccounts, marketingTokenState, MarketingAccountRequestError, setMarketingAccountEnabled, setMarketingAccountEngagement, marketingCommentSubscription, verifyMarketingAccount, type MarketingAccountStatus, type MarketingAccountVerifyResponse } from '@/lib/marketing/accounts-client';

type Lang = 'en' | 'cs';
type Props = { lang: Lang; disabled?: boolean; now?: Date };

/** Owner check of the @dneskai Instagram connection (#121). It never shows or receives a token. */
export function DneskaiInstagramAccount({ lang, disabled = false, now = new Date() }: Props) {
  const t = dneskaiAccount[lang];
  const client = useQueryClient();
  const query = useQuery({ queryKey: qk.marketingAccounts, enabled: !disabled, retry: false, staleTime: 30000, queryFn: ({ signal }) => loadMarketingAccounts(signal) });
  const verify = useMutation({ mutationFn: () => verifyMarketingAccount('dneskai', 'instagram'), onSettled: () => client.invalidateQueries({ queryKey: qk.marketingAccounts }) });
  const account = query.data?.find(value => value.brand === 'dneskai' && value.platform === 'instagram') ?? null;
  return <section aria-labelledby="dneskai-account-title" className="min-w-0 space-y-4" data-testid="dneskai-instagram-account">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="dneskai-account-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
      <Button variant="outline" className="min-h-11" disabled={disabled || verify.isPending} aria-busy={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? t.verifying : t.verify}</Button></div>
    <div aria-live="polite">{verify.isSuccess ? <p role="status" className="text-sm text-success">{verificationMessage(verify.data, lang)}</p> : verify.isError ? <p role="alert" className="text-sm text-risk">{verificationError(verify.error, lang)}</p> : null}</div>
    {disabled ? <p role="status" className="text-sm text-foreground-muted">{t.preview}</p> : query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p> : <><DneskaiInstagramAccountRecord account={account} lang={lang} now={now} />{account ? <DneskaiPublishingSwitch account={account} lang={lang} now={now} /> : null}{account?.engagement ? <DneskaiEngagementSwitch account={account} lang={lang} now={now} /> : null}</>}
  </section>;
}

export function verificationMessage(result: MarketingAccountVerifyResponse, lang: Lang): string {
  const t = dneskaiAccount[lang];
  const message = !result.tokenStored ? t.keptNewer : result.account.enabled ? t.verifiedEnabled : t.verifiedNow;
  return result.page ? `${message} ${t.page(result.page.name)}` : message;
}
export function verificationError(error: unknown, lang: Lang): string {
  const t = dneskaiAccount[lang];
  const code = error instanceof MarketingAccountRequestError ? error.code : '';
  const http = /^meta-http-(\d{3})$/.exec(code);
  return http ? t.metaHttp(http[1]!) : t.errors[code] ?? t.failed;
}

export function DneskaiInstagramAccountRecord({ account, lang, now }: { account: MarketingAccountStatus | null; lang: Lang; now: Date }) {
  const t = dneskaiAccount[lang];
  const format = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const at = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{format.format(new Date(value))}</time> : t.notRecorded;
  if (!account) return <div className="space-y-2 border-t border-border pt-3"><StatusBadge value="unverified" label={t.notVerified} tone="neutral" /><p className="text-sm text-foreground-muted">{t.noAccount}</p></div>;
  const tokenState = marketingTokenState(account.token, now);
  const tokenTone = tokenState === 'valid' ? 'success' : tokenState === 'expiring' ? 'warning' : tokenState === 'expired' ? 'risk' : 'neutral';
  return <div className="min-w-0 space-y-3 border-t border-border pt-3">
    <div className="flex flex-wrap gap-2">
      <StatusBadge value={account.verifiedAt ? 'verified' : 'unverified'} label={account.verifiedAt ? t.verified : t.notVerified} tone={account.verifiedAt ? 'success' : 'neutral'} />
      <StatusBadge value={account.enabled ? 'enabled' : 'disabled'} label={account.enabled ? t.publishingOn : t.publishingOff} tone={account.enabled ? 'information' : 'neutral'} />
      <StatusBadge value={`token-${tokenState}`} label={t.token[tokenState]} tone={tokenTone} />
    </div>
    {t.tokenHelp[tokenState] && <p className={tokenState === 'expired' ? 'text-sm text-risk' : 'text-sm text-foreground-muted'}>{t.tokenHelp[tokenState]}</p>}
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
      <div className="min-w-0"><dt className="text-foreground-muted">{t.account}</dt><dd className="break-words">@{account.handle.replace(/^@/, '')}</dd></div>
      <div><dt className="text-foreground-muted">{t.verifiedAt}</dt><dd className="tabular">{at(account.verifiedAt)}</dd></div>
      <div><dt className="text-foreground-muted">{t.publishing}</dt><dd>{account.enabled ? t.publishingOn : t.publishingOff}</dd></div>
      <div><dt className="text-foreground-muted">{t.tokenExpires}</dt><dd className="tabular">{at(account.token?.expiresAt)}</dd></div>
      <div><dt className="text-foreground-muted">{t.tokenRefreshed}</dt><dd className="tabular">{at(account.token?.refreshedAt)}</dd></div>
      <div><dt className="text-foreground-muted">{t.loginMode}</dt><dd>{account.token ? t.loginModes[account.token.loginMode] : t.notRecorded}</dd></div>
      <div className="min-w-0"><dt className="text-foreground-muted">{t.scopes}</dt><dd className="break-words font-mono">{account.token?.scopes.length ? account.token.scopes.join(', ') : t.notRecorded}</dd></div>
    </dl>
  </div>;
}

/** The owner's account switch for publishing. Enabling needs a verified account and a valid stored token and asks first. */
export function DneskaiPublishingSwitch({ account, lang, now }: { account: MarketingAccountStatus; lang: Lang; now: Date }) {
  const t = dneskaiAccount[lang];
  const client = useQueryClient();
  const toggle = useMutation({ mutationFn: (enabled: boolean) => setMarketingAccountEnabled(account.id, enabled), onSettled: () => client.invalidateQueries({ queryKey: qk.marketingAccounts }) });
  const tokenUsable = ['valid', 'expiring'].includes(marketingTokenState(account.token, now));
  const canEnable = !account.enabled && !!account.verifiedAt && tokenUsable;
  const onClick = () => {
    if (account.enabled) { toggle.mutate(false); return; }
    if (typeof window !== 'undefined' && !window.confirm(t.confirmEnable)) return;
    toggle.mutate(true);
  };
  return <div className="space-y-2 border-t border-border pt-3" data-testid="dneskai-publishing-switch">
    <p className="text-sm text-foreground-muted">{t.enableHelp}</p>
    <Button variant={account.enabled ? 'outline' : 'default'} className="min-h-11" disabled={toggle.isPending || (!account.enabled && !canEnable)} aria-busy={toggle.isPending} onClick={onClick}>
      {toggle.isPending ? t.switching : account.enabled ? t.disable : t.enable}
    </Button>
    <div aria-live="polite">{toggle.isSuccess ? <p role="status" className="text-sm text-success">{toggle.data.enabled ? t.enabledNow : t.disabledNow}</p>
      : toggle.isError ? <p role="alert" className="text-sm text-risk">{verificationError(toggle.error, lang)}</p> : null}</div>
  </div>;
}

/**
 * #160: replies to keyword comments for this account, shown while the server runs the comment watcher. A block
 * (messaging switched off for connected tools) says what to change in the Instagram app; turning replies on clears it.
 */
export function DneskaiEngagementSwitch({ account, lang, now }: { account: MarketingAccountStatus; lang: Lang; now: Date }) {
  const t = dneskaiAccount[lang], e = t.engagement;
  const client = useQueryClient();
  const toggle = useMutation({ mutationFn: (enabled: boolean) => setMarketingAccountEngagement(account.id, enabled), onSettled: () => client.invalidateQueries({ queryKey: qk.marketingAccounts }) });
  const state = account.engagement!;
  const tokenUsable = ['valid', 'expiring'].includes(marketingTokenState(account.token, now));
  const on = state.enabled && !state.blockedCode;
  const error = toggle.isError ? (toggle.error instanceof MarketingAccountRequestError ? e.errors[toggle.error.code] : undefined) ?? verificationError(toggle.error, lang) : null;
  return <div className="space-y-2 border-t border-border pt-3" data-testid="dneskai-engagement-switch">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{e.title}</h3>
      <StatusBadge value={on ? 'engagement-on' : state.blockedCode ? 'engagement-blocked' : 'engagement-off'} label={on ? e.on : state.blockedCode ? e.blocked : e.off} tone={on ? 'information' : state.blockedCode ? 'warning' : 'neutral'} /></div>
    <p className="text-sm text-foreground-muted">{e.help}</p>
    {state.blockedCode && <p className="text-sm text-warning" data-testid="dneskai-engagement-blocked">{e.blockedHelp}</p>}
    <Button variant={on ? 'outline' : 'default'} className="min-h-11" disabled={toggle.isPending || (!on && (!account.verifiedAt || !tokenUsable))} aria-busy={toggle.isPending} onClick={() => toggle.mutate(!on)}>
      {toggle.isPending ? t.switching : on ? e.disable : e.enable}
    </Button>
    <div aria-live="polite">{toggle.isSuccess ? <p role="status" className="text-sm text-success">{toggle.data.engagement?.enabled ? e.enabledNow : e.disabledNow}</p>
      : error ? <p role="alert" className="text-sm text-risk">{error}</p> : null}</div>
    {state.webhook ? <DneskaiCommentSubscription account={account} lang={lang} /> : null}
  </div>;
}

/**
 * #161: whether Meta delivers this account's comments to the webhook, read once when the panel opens, and the owner's
 * button to subscribe them. Polling answers comments either way; the webhook only makes replies faster.
 */
export function DneskaiCommentSubscription({ account, lang }: { account: MarketingAccountStatus; lang: Lang }) {
  const t = dneskaiAccount[lang], e = t.engagement;
  const client = useQueryClient();
  const key = [...qk.marketingAccounts, 'comment-subscription', account.id] as const;
  const status = useQuery({ queryKey: key, retry: false, staleTime: 5 * 60_000, queryFn: ({ signal }) => marketingCommentSubscription(account.id, 'status', signal) });
  const subscribe = useMutation({ mutationFn: () => marketingCommentSubscription(account.id, 'subscribe'), onSuccess: (subscribed) => client.setQueryData(key, subscribed) });
  const failure = status.isError ? status.error : subscribe.isError ? subscribe.error : null;
  const message = failure ? (failure instanceof MarketingAccountRequestError ? e.errors[failure.code] : undefined) ?? verificationError(failure, lang) : null;
  return <div className="space-y-2" data-testid="dneskai-comment-subscription">
    <p className="text-sm">{status.isPending ? e.webhookChecking : status.data ? e.webhookOn : e.webhookOff}</p>
    {status.data === false && <Button variant="outline" className="min-h-11" disabled={subscribe.isPending} aria-busy={subscribe.isPending} onClick={() => subscribe.mutate()}>
      {subscribe.isPending ? t.switching : e.webhookSubscribe}</Button>}
    <div aria-live="polite">{subscribe.isSuccess ? <p role="status" className="text-sm text-success">{e.webhookOn}</p> : message ? <p role="alert" className="text-sm text-risk">{message}</p> : null}</div>
  </div>;
}
