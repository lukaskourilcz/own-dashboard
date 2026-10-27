'use client';
import { useState } from 'react';
import {useNow} from '@/lib/use-now';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { qk } from '@/lib/queries/keys';
import { dneskaiAccount } from '@/lib/i18n/sections/dneskai-account';
import { loadMarketingAccounts, marketingTokenState, MarketingAccountRequestError, marketingCommentSubscription, verifyMarketingAccount, submitMarketingAccountControl, applyMarketingAccountControlReceipt, type MarketingAccountStatus, type MarketingAccountVerifyResponse } from '@/lib/marketing/accounts-client';
import type { MarketingAccountSwitch } from '@/lib/marketing/account-control-contracts';
import { useAccountActionScope } from './use-account-action-scope';
type Lang = 'en' | 'cs';
type Props = {
    lang: Lang;
    disabled?: boolean;
    now?: Date;
    embedded?: boolean;
};
/** The connection view retains confirmed details when a refresh is unavailable. */
export function DneskaiInstagramAccount({ lang, disabled = false, now: suppliedNow, embedded = false }: Props) {
    const clock=useNow(),now=suppliedNow??clock??new Date();
    const t = dneskaiAccount[lang], client = useQueryClient(), owner = useOwnerPreferences(), scope = useAccountActionScope();
    const [verification, setVerification] = useState<{
        data?: MarketingAccountVerifyResponse;
        error?: unknown;
    }>({}), [hold, setHold] = useState(false),[recoveryGeneration,setRecoveryGeneration]=useState(0),[action,setAction]=useState<'reload'|'verify'|null>(null);
    const query = useQuery({
        queryKey: qk.marketingAccounts, enabled: !disabled && !!owner, retry: false, staleTime: 0, queryFn: ({ signal }) => {
            const original = owner!.capture();
            return loadMarketingAccounts(AbortSignal.any([signal, original.signal]));
        }
    });
    const account = query.data?.find(value => value.brand === 'dneskai' && value.platform === 'instagram') ?? null;
    async function reload() {
        const operation = scope.capture();
        if (!operation)
            return;
        setAction('reload');
        try {
            const result = await query.refetch();
            if (!operation.signal.aborted && !result.isError) {
                setHold(false);
                setVerification({});
                setRecoveryGeneration(value=>value+1);
            }
        }
        finally {
            scope.release(operation);
        }
    }
    async function verify() {
        if (disabled || hold || query.isError || query.isFetching)
            return;
        const operation = scope.capture();
        if (!operation)
            return;
        setAction('verify');
        setVerification({});
        try {
            const result = await verifyMarketingAccount('dneskai', 'instagram', operation.signal);
            if (operation.signal.aborted)
                return;
            setVerification({ data: result });
            await client.cancelQueries({ queryKey: qk.marketingAccounts, exact: true });
            if (!operation.signal.aborted)
                void client.invalidateQueries({ queryKey: qk.marketingAccounts, exact: true });
        }
        catch (error) {
            if (!operation.signal.aborted) {
                setVerification({ error });
                setHold(true);
            }
        }
        finally {
            scope.release(operation);
        }
    }
    const blocked = disabled || !scope.available || query.isError || query.isFetching || hold || scope.pending;
    return <section aria-labelledby={embedded ? undefined : 'dneskai-account-title'} aria-label={embedded ? t.title : undefined} className="mx-auto min-w-0 w-full max-w-3xl space-y-4" data-testid="dneskai-instagram-account">
  <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">{!embedded && <h2 id="dneskai-account-title" className="text-sm font-semibold">{t.title}</h2>}<details className="max-w-3xl text-xs text-foreground-muted"><summary className="min-h-11 cursor-pointer py-3 focus-ring md:min-h-8">{t.details}</summary><p>{t.intro}</p></details></div><Button variant="outline" className="min-h-11 w-40 shrink-0" disabled={blocked} aria-busy={scope.pending} onClick={() => void verify()}>{scope.pending && action==='verify' ? t.verifying : t.verify}</Button></div>
  <div aria-live="polite">{verification.data ? <p role="status" className="text-sm text-success">{verificationMessage(verification.data, lang)}</p> : verification.error ? <p role="alert" className="text-sm text-risk">{verificationError(verification.error, lang)}</p> : null}</div>
  {disabled ? <p role="status" className="text-sm text-foreground-muted">{t.preview}</p> : <>
   {(query.isError || hold || !scope.available) && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3" data-testid="dneskai-account-recovery"><p role="alert" className="min-w-0 flex-1 text-sm text-warning">{query.isError ? (query.data ? t.cachedUnavailable : t.unavailable) : t.recovery}</p><Button variant="outline" className="min-h-11 w-full shrink-0 sm:w-40" disabled={!scope.available || scope.pending || query.isFetching} onClick={() => void reload()}>{query.isFetching ? t.reloading : t.reload}</Button></div>}
   {query.isPending && !query.data ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p> : query.data ? <><DneskaiInstagramAccountRecord account={account} lang={lang} now={now}/>{account && <DneskaiPublishingSwitch key={'publishing/' + account.id+'/'+recoveryGeneration} account={account} lang={lang} now={now} disabled={blocked} onHold={() => setHold(true)}/>} {account?.engagement && <DneskaiEngagementSwitch key={'engagement/' + account.id+'/'+recoveryGeneration} account={account} lang={lang} now={now} disabled={blocked} onHold={() => setHold(true)}/>}</> : null}
  </>}
 </section>;
}
export function verificationMessage(result: MarketingAccountVerifyResponse, lang: Lang) {
    const t = dneskaiAccount[lang], message = !result.tokenStored ? t.keptNewer : result.account.enabled ? t.verifiedEnabled : t.verifiedNow;
    return result.page ? `${message} ${t.page(result.page.name)}` : message;
}
export function verificationError(error: unknown, lang: Lang) {
    const t = dneskaiAccount[lang], code = error instanceof MarketingAccountRequestError ? error.code : '', http = /^meta-http-(\d{3})$/.exec(code);
    return http ? t.metaHttp(http[1]!) : t.errors[code] ?? t.failed;
}
export function DneskaiInstagramAccountRecord({ account, lang, now }: {
    account: MarketingAccountStatus | null;
    lang: Lang;
    now: Date;
}) {
    const t = dneskaiAccount[lang], format = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), at = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{format.format(new Date(value))}</time> : t.notRecorded;
    if (!account)
        return <div className="space-y-2 border-t border-border pt-3"><StatusBadge value="unverified" label={t.notVerified} tone="neutral"/><p className="text-sm text-foreground-muted">{t.noAccount}</p></div>;
    const tokenState = marketingTokenState(account.token, now), tone = tokenState === 'valid' ? 'success' : tokenState === 'expiring' ? 'warning' : tokenState === 'expired' ? 'risk' : 'neutral';
    return <div className="min-w-0 space-y-3 border-t border-border pt-3">
  <div className="flex flex-wrap gap-2"><StatusBadge value={account.verifiedAt ? 'verified' : 'unverified'} label={account.verifiedAt ? t.verified : t.notVerified} tone={account.verifiedAt ? 'success' : 'neutral'}/><StatusBadge value={account.enabled ? 'enabled' : 'disabled'} label={account.enabled ? t.publishingOn : t.publishingOff} tone={account.enabled ? 'information' : 'neutral'}/><StatusBadge value={'token-' + tokenState} label={t.token[tokenState]} tone={tone}/></div>
  {t.tokenHelp[tokenState] && <p className={tokenState === 'expired' ? 'text-sm text-risk' : 'text-sm text-foreground-muted'}>{t.tokenHelp[tokenState]}</p>}
  <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-xs"><div className="flex min-w-0 flex-wrap gap-x-2"><dt className="text-foreground-muted">{t.account}</dt><dd className="min-w-0 max-w-full break-words">@{account.handle.replace(/^@/, '')}</dd></div><div className="flex min-w-0 flex-wrap gap-x-2"><dt className="text-foreground-muted">{t.loginMode}</dt><dd>{account.token ? t.loginModes[account.token.loginMode] : t.notRecorded}</dd></div></dl>
  <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">{[[t.verifiedAt, account.verifiedAt], [t.tokenExpires, account.token?.expiresAt], [t.tokenRefreshed, account.token?.refreshedAt]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-foreground-muted">{label}</dt><dd className="tabular">{at(value)}</dd></div>)}</dl>
  <details className="min-w-0 text-xs"><summary className="min-h-11 cursor-pointer py-3 text-foreground-muted focus-ring md:min-h-8">{t.scopes}</summary><p className="break-words font-mono">{account.token?.scopes.length ? account.token.scopes.join(', ') : t.notRecorded}</p></details>
 </div>;
}
type SwitchProps = {
    account: MarketingAccountStatus;
    lang: Lang;
    now: Date;
    disabled?: boolean;
    onHold?: () => void;
};
function useAccountControl(account: MarketingAccountStatus, kind: MarketingAccountSwitch, onHold?: () => void) {
    const scope = useAccountActionScope(), client = useQueryClient(), [result, setResult] = useState<{
        saved?: boolean;
        error?: string;
    }>({}), [blocked, setBlocked] = useState(false);
    async function toggle(enabled: boolean, confirm?: () => boolean) {
        if (blocked || !account.updatedAt)
            return;
        const operation = scope.capture();
        if (!operation)
            return;
        const intent = { ownerId: operation.ownerId, accountId: account.id, expectedVersion: account.updatedAt, enabled };
        try {
            if (confirm && !confirm())
                return;
            if (operation.signal.aborted)
                return;
            setResult({});
            const receipt = await submitMarketingAccountControl(intent, kind, operation.signal);
            if (operation.signal.aborted)
                return;
            if (receipt.kind !== 'saved') {
                setResult({ error: receipt.kind === 'blocked' ? receipt.code : receipt.kind === 'changed' ? 'account-changed' : 'account-unavailable' });
                setBlocked(true);
                onHold?.();
                return;
            }
            await client.cancelQueries({ queryKey: qk.marketingAccounts, exact: true });
            if (operation.signal.aborted)
                return;
            const applied = applyMarketingAccountControlReceipt(client.getQueryData<MarketingAccountStatus[]>(qk.marketingAccounts), intent, kind, receipt);
            if (applied.reconcile) {
                setResult({ error: 'account-changed' });
                setBlocked(true);
                onHold?.();
                return;
            }
            client.setQueryData(qk.marketingAccounts, applied.accounts);
            setResult({ saved: enabled });
        }
        catch (error) {
            if (!operation.signal.aborted) {
                setResult({ error: error instanceof MarketingAccountRequestError ? error.code : 'account-request-failed' });
                setBlocked(true);
                onHold?.();
            }
        }
        finally {
            scope.release(operation);
        }
    }
    return { ...scope, result, blocked, toggle };
}
export function DneskaiPublishingSwitch({ account, lang, now, disabled = false, onHold }: SwitchProps) {
    const t = dneskaiAccount[lang], control = useAccountControl(account, 'publishing', onHold), usable = ['valid', 'expiring'].includes(marketingTokenState(account.token, now)), canEnable = !!account.verifiedAt && usable;
    return <div className="space-y-2 border-t border-border pt-3" data-testid="dneskai-publishing-switch"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="min-w-0 flex-1 text-sm text-foreground-muted">{t.enableHelp}</p><Button variant={account.enabled ? 'outline' : 'default'} className="min-h-11 w-full shrink-0 sm:w-40" disabled={disabled || control.pending || control.blocked || !control.available || !account.updatedAt || (!account.enabled && !canEnable)} aria-busy={control.pending} onClick={() => void control.toggle(!account.enabled, account.enabled ? undefined : () => window.confirm(t.confirmEnable))}>{control.pending ? t.switching : account.enabled ? t.disable : t.enable}</Button></div><div aria-live="polite">{control.result.saved !== undefined ? <p role="status" className="text-sm text-success">{control.result.saved ? t.enabledNow : t.disabledNow}</p> : control.result.error ? <p role="alert" className="text-sm text-risk">{control.result.error === 'account-changed' ? t.changed : t.errors[control.result.error] ?? t.operationFailed}</p> : null}</div></div>;
}
export function DneskaiEngagementSwitch({ account, lang, now, disabled = false, onHold }: SwitchProps) {
    const t = dneskaiAccount[lang], e = t.engagement, control = useAccountControl(account, 'engagement', onHold), state = account.engagement!, usable = ['valid', 'expiring'].includes(marketingTokenState(account.token, now)), on = state.enabled && !state.blockedCode;
    return <div className="space-y-2 border-t border-border pt-3" data-testid="dneskai-engagement-switch"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{e.title}</h3><p className="mt-1 text-sm text-foreground-muted">{e.help}</p></div><Button variant={on ? 'outline' : 'default'} className="min-h-11 w-full shrink-0 sm:w-40" disabled={disabled || control.pending || control.blocked || !control.available || !account.updatedAt || (!on && (!account.verifiedAt || !usable))} aria-busy={control.pending} onClick={() => void control.toggle(!on)}>{control.pending ? t.switching : on ? e.disable : e.enable}</Button></div><StatusBadge value={on ? 'engagement-on' : state.blockedCode ? 'engagement-blocked' : 'engagement-off'} label={on ? e.on : state.blockedCode ? e.blocked : e.off} tone={on ? 'information' : state.blockedCode ? 'warning' : 'neutral'}/>{state.blockedCode && <p className="text-sm text-warning" data-testid="dneskai-engagement-blocked">{e.blockedHelp}</p>}<div aria-live="polite">{control.result.saved !== undefined ? <p role="status" className="text-sm text-success">{control.result.saved ? e.enabledNow : e.disabledNow}</p> : control.result.error ? <p role="alert" className="text-sm text-risk">{control.result.error === 'account-changed' ? t.changed : e.errors[control.result.error] ?? t.errors[control.result.error] ?? t.operationFailed}</p> : null}</div>{state.webhook && <DneskaiCommentSubscription key={account.id} account={account} lang={lang} disabled={disabled} onHold={onHold}/>}</div>;
}
export function DneskaiCommentSubscription({ account, lang, disabled = false, onHold }: {
    account: MarketingAccountStatus;
    lang: Lang;
    disabled?: boolean;
    onHold?: () => void;
}) {
    const t = dneskaiAccount[lang], e = t.engagement, client = useQueryClient(), owner = useOwnerPreferences(), scope = useAccountActionScope(), key = [...qk.marketingAccounts, 'comment-subscription', account.id] as const, [failure, setFailure] = useState<unknown>(null), [blocked, setBlocked] = useState(false);
    const status = useQuery({
        queryKey: key, enabled: !disabled && !!owner, retry: false, staleTime: 0, queryFn: ({ signal }) => {
            const original = owner!.capture();
            return marketingCommentSubscription(account.id, 'status', AbortSignal.any([signal, original.signal]));
        }
    });
    async function subscribe() {
        if (blocked || disabled || status.isError || status.isFetching || status.data !== false)
            return;
        const operation = scope.capture();
        if (!operation)
            return;
        setFailure(null);
        try {
            const subscribed = await marketingCommentSubscription(account.id, 'subscribe', operation.signal);
            if (operation.signal.aborted)
                return;
            await client.cancelQueries({ queryKey: key, exact: true });
            if (!operation.signal.aborted)
                client.setQueryData(key, subscribed);
        }
        catch (error) {
            if (!operation.signal.aborted) {
                setFailure(error);
                setBlocked(true);
                onHold?.();
            }
        }
        finally {
            scope.release(operation);
        }
    }
    async function reload() {
        const operation = scope.capture();
        if (!operation)
            return;
        try {
            const result = await status.refetch();
            if (!operation.signal.aborted && !result.isError) {
                setBlocked(false);
                setFailure(null);
            }
        }
        finally {
            scope.release(operation);
        }
    }
    const error = failure ?? (status.isError ? status.error : null), message = error ? (error instanceof MarketingAccountRequestError ? e.errors[error.code] ?? t.errors[error.code] ?? (/^meta-http-(\d{3})$/.test(error.code) ? t.metaHttp(error.code.slice(-3)) : undefined) : undefined) ?? t.operationFailed : null;
    return <div className="space-y-2" data-testid="dneskai-comment-subscription"><p className="text-sm">{status.isPending ? e.webhookChecking : status.data === true ? e.webhookOn : status.data === false ? e.webhookOff : t.unavailable}</p>{status.data === false && !error && <Button variant="outline" className="min-h-11 w-full shrink-0 sm:w-40" disabled={disabled || scope.pending || !scope.available || status.isFetching} aria-busy={scope.pending} onClick={() => void subscribe()}>{scope.pending ? t.switching : e.webhookSubscribe}</Button>}{message && <div className="flex flex-wrap items-center justify-between gap-3"><p role="alert" className="min-w-0 flex-1 text-sm text-risk">{message}</p><Button variant="outline" className="min-h-11" disabled={scope.pending || status.isFetching || !scope.available} onClick={() => void reload()}>{status.isFetching ? t.reloading : t.reload}</Button></div>}</div>;
}
