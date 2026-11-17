import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// At 00:00 UTC on 1 January every year, download that year's public holidays
// for every configured country from Nager — so each new year self-populates.
crons.cron(
  "load holidays for the new year",
  "0 0 1 1 *",
  internal.holidays.importYearForAllCountries,
  {},
);

// Public demo deployments rebuild their fictional workspace every night. The
// handler refuses to run unless DEMO_MODE=true, so this schedule is inert on
// a real workspace.
crons.cron(
  "reset the public demo",
  "15 1 * * *",
  internal.demo.nightlyReset,
  {},
);

// Every morning, roll unused statutory leave into the new period for anyone
// whose leave year opened today. Daily rather than annual because countries in
// anniversary mode reset each person on their own hire date, not on 1 January.
crons.cron(
  "apply leave carryover for periods starting today",
  "30 0 * * *",
  internal.carryover.runDailyResets,
  {},
);

export default crons;
