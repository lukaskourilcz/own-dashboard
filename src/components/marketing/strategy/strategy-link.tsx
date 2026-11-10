'use client';
import { Button } from '@/components/ui/button';
import { marketingStrategy } from '@/lib/i18n/sections/marketing-strategy';
import { openStrategyHref } from '@/lib/marketing/strategy/client';
import type { PublishingBrand } from '@/lib/publishing-calendar';

/** Return to the same brand's strategy from its production and delivery surfaces. */
export function StrategyLink({ brand, lang, disabled = false, onOpen }: { brand: PublishingBrand; lang: 'en' | 'cs'; disabled?: boolean; onOpen?: () => void }) {
  return <Button variant="outline" size="sm" disabled={disabled} onClick={() => { onOpen?.(); openStrategyHref(`/projects/${brand}?projectTab=strategy`); }}>{marketingStrategy[lang].tab}</Button>;
}
