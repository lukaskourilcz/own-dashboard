'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { qk } from '@/lib/queries/keys';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import { loadMarketingAccounts, marketingTokenState, MarketingAccountRequestError, verifyMarketingAccount, type MarketingAccountStatus, type MarketingAccountVerifyResponse } from '@/lib/marketing/accounts-client';

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
      : query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p> : <DneskaiInstagramAccountRecord account={account} lang={lang} now={now} />}
  </section>;
}

export function verificationMessage(result: MarketingAccountVerifyResponse, lang: Lang): string {
  const t = dneskaiAccount[lang];
  return !result.tokenStored ? t.keptNewer : result.account.enabled ? t.verifiedEnabled : t.verifiedNow;
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
      <div className="min-w-0"><dt className="text-foreground-muted">{t.scopes}</dt><dd className="break-words font-mono">{account.token?.scopes.length ? account.token.scopes.join(', ') : t.notRecorded}</dd></div>
    </dl>
  </div>;
}
