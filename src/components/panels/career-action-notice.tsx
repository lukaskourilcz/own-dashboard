import type {ReactNode} from 'react';

export function CareerActionNotice({message,children}:{message:string;children:ReactNode}){
 return <div className="mx-auto mb-4 flex w-full max-w-3xl flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:w-fit sm:flex-row sm:items-center sm:justify-between">
  <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">{message}</p>
  {children}
 </div>;
}
