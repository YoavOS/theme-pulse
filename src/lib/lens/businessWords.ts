import type { LensPayload } from "@/lib/lens/types";

/**
 * What a company sells and what its costs are, in plain words, by industry — so explanations can say
 * "making the chips cost $54B" instead of "cost of revenue was $54B". Matched on the company's industry,
 * Damodaran group and sector. Falls back to neutral words.
 */
export interface Words {
  /** what it sells, as a noun phrase: "chips and computing systems" */
  sells: string;
  /** what cost of revenue is for this business */
  cost: string;
  /** what R&D buys here */
  rnd: string;
  /** what selling, general & administrative covers here */
  sga: string;
  /** what its capital is tied up in */
  capital: string;
  /** what capex buys */
  capex: string;
}
interface Entry { re: RegExp; en: Words; he: Words }

const E = (re: RegExp, en: Words, he: Words): Entry => ({ re, en, he });
const W = (sells: string, cost: string, rnd: string, sga: string, capital: string, capex: string): Words => ({ sells, cost, rnd, sga, capital, capex });

const TABLE: Entry[] = [
  E(/semiconductor equipment|semi.*equip|wafer fab/i,
    W("machines that chip factories use", "building the machines — parts, assembly and installation", "developing the next generation of machines", "selling teams, service network and administration", "factories, inventory of parts and customer contracts", "factories and test equipment"),
    W("מכונות שמפעלי שבבים משתמשים בהן", "בניית המכונות — חלקים, הרכבה והתקנה", "פיתוח הדור הבא של המכונות", "צוותי שיווק, רשת שירות ומטה", "מפעלים, מלאי חלקים וחוזי לקוחות", "מפעלים וציוד בדיקה")),
  E(/semiconductor|chip/i,
    W("chips and computing systems", "making the chips — wafers from the factories that produce them, memory, packaging and testing", "designing the next generations of chips and software", "selling, marketing and administration", "chip designs, inventory and equipment", "equipment, data centers and buildings"),
    W("שבבים ומערכות מחשוב", "ייצור השבבים — פרוסות סיליקון מהמפעלים שמייצרים אותם, זיכרון, אריזה ובדיקות", "תכנון הדורות הבאים של שבבים ותוכנה", "שיווק ומטה", "תכנוני שבבים, מלאי וציוד", "ציוד, מרכזי נתונים ומבנים")),
  E(/software|saas|application|information technology services|it services/i,
    W("software and subscriptions", "running the service — cloud hosting, support staff and licences", "engineers building new features and products", "selling teams, marketing and administration", "acquired companies, capitalized software and data centers", "servers, data centers and offices"),
    W("תוכנה ומנויים", "הפעלת השירות — אחסון בענן, צוותי תמיכה ורישיונות", "מהנדסים שבונים פיצ'רים ומוצרים חדשים", "צוותי שיווק ומטה", "חברות שנרכשו, תוכנה מהוונת ומרכזי נתונים", "שרתים, מרכזי נתונים ומשרדים")),
  E(/internet|online|interactive media|search|social/i,
    W("online services and advertising", "running the platforms — data centers, content and payment fees", "engineers building and improving the products", "marketing, selling and administration", "data centers, servers and acquired companies", "data centers and servers"),
    W("שירותים מקוונים ופרסום", "הפעלת הפלטפורמות — מרכזי נתונים, תוכן ועמלות תשלום", "מהנדסים שבונים ומשפרים את המוצרים", "שיווק ומטה", "מרכזי נתונים, שרתים וחברות שנרכשו", "מרכזי נתונים ושרתים")),
  E(/apparel|clothing|footwear|textile|fashion|luxury/i,
    W("clothes, shoes and accessories", "the clothes themselves — buying or making them, shipping them to stores", "designing new collections", "stores, staff, rent and marketing", "inventory on shelves and in warehouses, and stores", "new stores and distribution centers"),
    W("בגדים, נעליים ואביזרים", "הבגדים עצמם — קנייה או ייצור ושילוח לחנויות", "עיצוב קולקציות חדשות", "חנויות, עובדים, שכירות ושיווק", "מלאי על המדפים ובמחסנים, וחנויות", "חנויות חדשות ומרכזי הפצה")),
  E(/grocery|food retail|supermarket|drug ?stor|pharmacy/i,
    W("groceries and everyday goods", "the goods on the shelves — buying them from suppliers and getting them to stores", "technology and store systems", "store staff, rent, utilities and marketing", "stores, warehouses and inventory", "new stores, refits and warehouses"),
    W("מזון ומוצרים יומיומיים", "הסחורה על המדפים — קנייה מספקים והובלה לחנויות", "טכנולוגיה ומערכות לחנויות", "עובדי חנויות, שכירות, חשמל ושיווק", "חנויות, מחסנים ומלאי", "חנויות חדשות, שיפוצים ומחסנים")),
  E(/retail|department store|e-?commerce|specialty stores|home improvement/i,
    W("goods sold in stores and online", "the goods themselves — buying them from suppliers and shipping them", "technology for the stores and website", "store staff, rent, delivery and marketing", "stores, warehouses and inventory", "stores, warehouses and technology"),
    W("סחורה שנמכרת בחנויות ובאינטרנט", "הסחורה עצמה — קנייה מספקים ושילוח", "טכנולוגיה לחנויות ולאתר", "עובדי חנויות, שכירות, משלוחים ושיווק", "חנויות, מחסנים ומלאי", "חנויות, מחסנים וטכנולוגיה")),
  E(/restaurant|dining|fast food/i,
    W("meals and drinks", "food, packaging and the staff who cook and serve", "menu and technology development", "marketing, franchise support and administration", "restaurants, kitchens and equipment", "new restaurants and remodels"),
    W("ארוחות ומשקאות", "מזון, אריזות והעובדים שמבשלים ומגישים", "פיתוח תפריט וטכנולוגיה", "שיווק, תמיכה בזכיינים ומטה", "מסעדות, מטבחים וציוד", "מסעדות חדשות ושיפוצים")),
  E(/bank|money center|thrift|savings/i,
    W("loans and banking services", "interest paid on deposits and borrowing", "technology", "salaries, branches, technology and other running costs", "loans to customers and securities, funded by deposits", "branches and technology"),
    W("הלוואות ושירותים בנקאיים", "ריבית ששולמה על פיקדונות והלוואות", "טכנולוגיה", "שכר, סניפים, טכנולוגיה ועלויות שוטפות", "הלוואות ללקוחות וניירות ערך, במימון פיקדונות", "סניפים וטכנולוגיה")),
  E(/insurance|reinsurance/i,
    W("insurance policies", "claims paid to customers", "technology", "agents' commissions, staff and administration", "investments that back the policies", "technology and offices"),
    W("פוליסות ביטוח", "תביעות ששולמו ללקוחות", "טכנולוגיה", "עמלות סוכנים, עובדים ומטה", "השקעות שמגבות את הפוליסות", "טכנולוגיה ומשרדים")),
  E(/asset management|brokerage|investment banking|capital markets|financial (svcs|services)|exchange/i,
    W("financial services — trading, advice and managing money", "transaction and clearing costs", "technology", "staff pay, technology and administration", "client funds, trading positions and technology", "technology and offices"),
    W("שירותים פיננסיים — מסחר, ייעוץ וניהול כספים", "עלויות עסקה וסליקה", "טכנולוגיה", "שכר עובדים, טכנולוגיה ומטה", "כספי לקוחות, פוזיציות מסחר וטכנולוגיה", "טכנולוגיה ומשרדים")),
  E(/pharma|drug/i,
    W("medicines", "manufacturing the medicines and royalties", "clinical trials and research on new drugs", "selling reps, marketing to doctors and administration", "drug patents, acquired companies and factories", "factories and labs"),
    W("תרופות", "ייצור התרופות ותמלוגים", "ניסויים קליניים ומחקר על תרופות חדשות", "נציגי שיווק לרופאים ומטה", "פטנטים, חברות שנרכשו ומפעלים", "מפעלים ומעבדות")),
  E(/biotech/i,
    W("biotech therapies (some still in development)", "manufacturing the therapies", "lab research and clinical trials", "launch costs, marketing and administration", "research, patents and labs", "labs and manufacturing sites"),
    W("טיפולים ביוטכנולוגיים (חלקם עדיין בפיתוח)", "ייצור הטיפולים", "מחקר מעבדתי וניסויים קליניים", "עלויות השקה, שיווק ומטה", "מחקר, פטנטים ומעבדות", "מעבדות ואתרי ייצור")),
  E(/medical|health ?care (equipment|supplies|products)|devices|diagnostic/i,
    W("medical devices and supplies", "making the devices — parts, assembly and quality checks", "developing new devices and getting them approved", "selling reps who visit hospitals, marketing and administration", "factories, inventory and acquired companies", "factories and equipment"),
    W("ציוד ואביזרים רפואיים", "ייצור המכשירים — חלקים, הרכבה ובקרת איכות", "פיתוח מכשירים חדשים וקבלת אישורים", "נציגים שמבקרים בבתי חולים, שיווק ומטה", "מפעלים, מלאי וחברות שנרכשו", "מפעלים וציוד")),
  E(/hospital|health ?care (facilities|services|support)|managed care|health insurance/i,
    W("health care services", "doctors, nurses, medical supplies and claims", "technology", "administration and marketing", "hospitals, clinics and equipment", "facilities and equipment"),
    W("שירותי בריאות", "רופאים, אחיות, ציוד רפואי ותביעות", "טכנולוגיה", "מטה ושיווק", "בתי חולים, מרפאות וציוד", "מתקנים וציוד")),
  E(/oil|gas|petroleum|energy|exploration|drilling|refin/i,
    W("oil, gas and fuels", "pumping, refining and transporting the oil and gas", "technology", "administration", "wells, pipelines, refineries and reserves in the ground", "drilling new wells and maintaining fields"),
    W("נפט, גז ודלקים", "שאיבה, זיקוק והובלה של הנפט והגז", "טכנולוגיה", "מטה", "בארות, צינורות, בתי זיקוק ועתודות באדמה", "קידוח בארות חדשות ותחזוקת שדות")),
  E(/utilit|power|electric (util|power)|water/i,
    W("electricity, gas or water to homes and businesses", "fuel and power bought to supply customers", "technology", "running the network and administration", "power plants, grids and pipes", "new plants and grid upgrades"),
    W("חשמל, גז או מים לבתים ולעסקים", "דלק וחשמל שנקנים כדי לספק ללקוחות", "טכנולוגיה", "הפעלת הרשת ומטה", "תחנות כוח, רשתות וצנרת", "תחנות חדשות ושדרוג הרשת")),
  E(/auto|vehicle|car ?maker|truck manufactur/i,
    W("cars and vehicles", "building the vehicles — parts, batteries, factory labor", "engineering new models and technology", "dealer support, marketing and administration", "factories, tooling and inventory", "factories and tooling for new models"),
    W("מכוניות וכלי רכב", "בניית הרכבים — חלקים, סוללות ועבודת מפעל", "הנדסת דגמים וטכנולוגיה חדשים", "תמיכה בסוכנויות, שיווק ומטה", "מפעלים, כלי ייצור ומלאי", "מפעלים וכלי ייצור לדגמים חדשים")),
  E(/air ?line|airline|air transport/i,
    W("flights", "fuel, crews, airport fees and aircraft maintenance", "technology", "revenue, distribution and administration", "aircraft and airport facilities", "new aircraft"),
    W("טיסות", "דלק, צוותים, אגרות שדה ותחזוקת מטוסים", "טכנולוגיה", "הכנסות, הפצה ומטה", "מטוסים ומתקני שדה תעופה", "מטוסים חדשים")),
  E(/telecom|wireless|cable|communication services/i,
    W("phone, internet and TV service", "running the network — towers, cables and content", "technology", "stores, customer service, marketing and administration", "networks, spectrum licences and cables", "network upgrades and new towers"),
    W("שירותי טלפון, אינטרנט וטלוויזיה", "הפעלת הרשת — אנטנות, כבלים ותוכן", "טכנולוגיה", "חנויות, שירות לקוחות, שיווק ומטה", "רשתות, רישיונות תדרים וכבלים", "שדרוגי רשת ואנטנות חדשות")),
  E(/entertainment|media|broadcast|movies|publishing|music|gaming|video game/i,
    W("shows, games and media", "making and licensing the content", "developing new games and technology", "marketing and administration", "content libraries, studios and acquired companies", "studios and technology"),
    W("סדרות, משחקים ומדיה", "הפקת התוכן ורישוי שלו", "פיתוח משחקים וטכנולוגיה חדשים", "שיווק ומטה", "ספריות תוכן, אולפנים וחברות שנרכשו", "אולפנים וטכנולוגיה")),
  E(/reit|real estate|property/i,
    W("space rented to tenants", "running the buildings — upkeep, taxes and staff", "technology", "administration", "buildings and land", "new buildings and renovations"),
    W("שטחים שמושכרים לשוכרים", "הפעלת המבנים — תחזוקה, מסים ועובדים", "טכנולוגיה", "מטה", "מבנים וקרקעות", "מבנים חדשים ושיפוצים")),
  E(/homebuild|residential construction/i,
    W("new homes", "land, materials and contractors who build the homes", "design", "selling offices, marketing and administration", "land and homes under construction", "equipment and model homes"),
    W("בתים חדשים", "קרקע, חומרים וקבלנים שבונים את הבתים", "תכנון", "משרדי שיווק ומטה", "קרקעות ובתים בבנייה", "ציוד ודירות לדוגמה")),
  E(/aerospace|defense/i,
    W("aircraft, defense systems and parts", "building the systems — parts, materials and skilled labor", "engineering new systems", "program management and administration", "factories, long contracts and inventory", "factories and tooling"),
    W("מטוסים, מערכות ביטחון וחלקים", "בניית המערכות — חלקים, חומרים ועבודה מקצועית", "הנדסת מערכות חדשות", "ניהול פרויקטים ומטה", "מפעלים, חוזים ארוכים ומלאי", "מפעלים וכלי ייצור")),
  E(/machinery|industrial|electrical equipment|engineering|construction/i,
    W("machines, equipment and industrial products", "making the products — parts, steel and factory labor", "engineering new products", "revenue, service and administration", "factories, inventory and equipment", "factories and equipment"),
    W("מכונות, ציוד ומוצרים תעשייתיים", "ייצור המוצרים — חלקים, פלדה ועבודת מפעל", "הנדסת מוצרים חדשים", "הכנסות, שירות ומטה", "מפעלים, מלאי וציוד", "מפעלים וציוד")),
  E(/chemical|materials|steel|metal|mining|gold|silver|copper|paper|packaging|forest/i,
    W("raw materials and chemicals", "mining or producing the materials — energy, equipment and labor", "process research", "revenue and administration", "mines, plants and equipment", "mines, plants and equipment"),
    W("חומרי גלם וכימיקלים", "כרייה או ייצור החומרים — אנרגיה, ציוד ועבודה", "מחקר תהליכים", "שיווק ומטה", "מכרות, מפעלים וציוד", "מכרות, מפעלים וציוד")),
  E(/beverage|drink|brew|distill|soft drink/i,
    W("drinks", "ingredients, bottles and cans, and bottling", "new flavors and products", "marketing, distribution and administration", "brands, bottling plants and trucks", "plants and equipment"),
    W("משקאות", "רכיבים, בקבוקים ופחיות ומילוי", "טעמים ומוצרים חדשים", "שיווק, הפצה ומטה", "מותגים, מפעלי מילוי ומשאיות", "מפעלים וציוד")),
  E(/food|packaged|agri|farm/i,
    W("packaged food", "ingredients, packaging and the factories that make the food", "new products", "marketing, distribution and administration", "brands, factories and inventory", "factories and equipment"),
    W("מזון ארוז", "רכיבים, אריזות והמפעלים שמייצרים את המזון", "מוצרים חדשים", "שיווק, הפצה ומטה", "מותגים, מפעלים ומלאי", "מפעלים וציוד")),
  E(/household|personal products|cosmetic|tobacco/i,
    W("household and personal products", "making the products — ingredients, packaging and factories", "new products", "advertising, distribution and administration", "brands, factories and inventory", "factories and equipment"),
    W("מוצרים לבית ולטיפוח", "ייצור המוצרים — רכיבים, אריזות ומפעלים", "מוצרים חדשים", "פרסום, הפצה ומטה", "מותגים, מפעלים ומלאי", "מפעלים וציוד")),
  E(/hotel|casino|leisure|cruise|travel/i,
    W("trips, stays and entertainment", "running the hotels, ships or casinos — staff, food and upkeep", "technology", "marketing, bookings and administration", "hotels, ships and resorts", "new properties and renovations"),
    W("טיולים, לינה ובידור", "הפעלת המלונות, האוניות או הקזינו — עובדים, מזון ותחזוקה", "טכנולוגיה", "שיווק, הזמנות ומטה", "מלונות, אוניות ואתרי נופש", "נכסים חדשים ושיפוצים")),
  E(/transport|trucking|railroad|shipping|logistics|delivery|freight/i,
    W("moving goods for customers", "fuel, drivers, crews and maintenance", "technology", "revenue and administration", "trucks, trains, ships and terminals", "new vehicles and terminals"),
    W("הובלת סחורות ללקוחות", "דלק, נהגים, צוותים ותחזוקה", "טכנולוגיה", "שיווק ומטה", "משאיות, רכבות, אוניות ומסופים", "כלי רכב ומסופים חדשים")),
  E(/computer|hardware|electronic|storage|peripheral|technology hardware/i,
    W("computers, devices and electronics", "making the devices — components, assembly and shipping", "designing new devices", "selling, marketing and administration", "inventory, factories and equipment", "equipment and factories"),
    W("מחשבים, מכשירים ואלקטרוניקה", "ייצור המכשירים — רכיבים, הרכבה ומשלוח", "תכנון מכשירים חדשים", "שיווק ומטה", "מלאי, מפעלים וציוד", "ציוד ומפעלים")),
  E(/business services|consulting|staffing|advertising|education|services/i,
    W("services to other businesses", "the staff who deliver the service", "technology", "revenue and administration", "people, technology and acquired companies", "offices and technology"),
    W("שירותים לעסקים אחרים", "העובדים שנותנים את השירות", "טכנולוגיה", "שיווק ומטה", "אנשים, טכנולוגיה וחברות שנרכשו", "משרדים וטכנולוגיה")),
];

const FALLBACK: Entry = E(/./,
  W("its products and services", "producing what it sells — materials, labor and delivery", "research and development", "selling, marketing and administration", "the assets it runs the business with", "equipment, buildings and technology"),
  W("המוצרים והשירותים שלה", "ייצור מה שהיא מוכרת — חומרים, עבודה ואספקה", "מחקר ופיתוח", "שיווק ומטה", "הנכסים שבעזרתם היא מנהלת את העסק", "ציוד, מבנים וטכנולוגיה"));

/** The words for this company (first matching industry wins: specific groups are listed before broad ones). */
export function businessWords(p: Pick<LensPayload, "classification" | "damodaran" | "financial">, he = false): Words & { matched: boolean } {
  // most specific field first, so "Semiconductors" (sub-industry) wins over "… & Semiconductor Equipment" (industry)
  const fields = [p.classification?.subIndustry, p.damodaran?.name, p.classification?.industry, p.damodaran?.from, p.classification?.sector].filter((x): x is string => !!x);
  let hit: Entry | undefined;
  for (const f of fields) { hit = TABLE.find((e) => e.re.test(f)); if (hit) break; }
  hit ??= p.financial ? TABLE.find((e) => /bank/.test(e.re.source)) : undefined;
  const e = hit ?? FALLBACK;
  return { ...(he ? e.he : e.en), matched: !!hit };
}
