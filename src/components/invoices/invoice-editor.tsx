"use client";

import { useState, type ComponentProps } from "react";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { SupplierSettings } from "@/components/invoices/supplier-settings";
import type { InvoiceSettings } from "@/lib/types";

/** Keep the document mounted while editing its supplier defaults. Returning
 * from settings must not discard the buyer, line items or an unsaved number.
 */
export function InvoiceEditor({ onSettingsSaved, ...props }:
  Omit<ComponentProps<typeof InvoiceForm>, "onEditSupplier"> & {
    onSettingsSaved: (settings: InvoiceSettings) => void;
  }) {
  const [editingSupplier, setEditingSupplier] = useState(false);
  return <>
    <div hidden={editingSupplier}>
      <InvoiceForm {...props} onEditSupplier={() => setEditingSupplier(true)} />
    </div>
    {editingSupplier && <SupplierSettings settings={props.settings} userId={props.userId}
      onSaved={onSettingsSaved} onBack={() => setEditingSupplier(false)} />}
  </>;
}
