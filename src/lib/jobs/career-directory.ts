import { createClient } from "@/lib/supabase/client";

export type CareerCompany = {
  id: string; name: string; url: string; category: string;
  country: string; notes: string; checked_on: string | null;
};

export async function fetchCareerCompanies(userId: string, signal?: AbortSignal): Promise<CareerCompany[]> {
  const query = createClient().from("career_companies")
    .select("id,name,url,category,country,notes,checked_on")
    .eq("user_id", userId).order("name").limit(1000);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return (data ?? []) as CareerCompany[];
}
