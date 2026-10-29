import { expect, it } from "vitest";
import { MAX_TASK_MINUTES, isTaskMinutes, parseTimeToMinutes, formatMinutes } from "@/lib/task-meta";
import { parseNeeded } from "@/lib/needed";
import type { GithubRepo } from "@/lib/github";
it("retains documented minute/hour markers within the actual database range", () => {
  for(const [raw,expected] of [["30m",30],["2h",120],["1h30m",90],[" 1h 30m ",90],["45",45],["100000",MAX_TASK_MINUTES],["1666h40m",MAX_TASK_MINUTES],["0h1m",1]] as const) expect(parseTimeToMinutes(raw)).toBe(expected);
});
it("rejects overbound, fractional, zero and non-finite estimates rather than breaking the database batch", () => {
  for(const raw of ["100001","100001m","1667h","0","0h0m","-1","1.5m","Infinity","1e5","9".repeat(1000)," "]) expect(parseTimeToMinutes(raw)).toBeNull();
  for(const value of [0,-1,1.5,100001,Infinity,NaN,"30"]) expect(isTaskMinutes(value)).toBe(false);
});
it("formats only whole supported estimates with the existing compact duration labels", () => {
  expect(formatMinutes(45)).toBe("45m"); expect(formatMinutes(90)).toBe("1h 30m"); expect(formatMinutes(120)).toBe("2h");
  for(const value of [0,-1,.5,100001,Infinity,NaN]) expect(formatMinutes(value)).toBe("");
});
it("keeps an imported task and its other metadata when only its optional time is invalid", () => {
  const repo={id:42,owner:"owner",name:"fixture",full_name:"owner/fixture",html_url:"https://github.com/owner/fixture"} as GithubRepo;
  const rows=parseNeeded("- [ ] Keep this task [time:100001] [owner:ai] [kind:deploy]\n- [ ] Valid task [time:30m] [owner:ai]",repo,repo.html_url);
  expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({text:"Keep this task",estimatedMinutes:null,kind:"deploy"});expect(rows[1].estimatedMinutes).toBe(30);expect(rows[0].raw).toContain("[time:100001]");
});
