// Refresh scraper/config/challenger-calendar.json from atptour.com.
//   pnpm scraper:challenger-calendar
import { fetchChallengerCalendar, saveChallengerEvents } from "./sources/atp-challenger-calendar";

const events = await fetchChallengerCalendar();
const total = saveChallengerEvents(events);
console.log(`[challenger-calendar] fetched ${events.length} events; ${total} stored`);
process.exit(0);
