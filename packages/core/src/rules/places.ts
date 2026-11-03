// Place vocabulary for the pre-filter (S5). It is a whitelist of places we KNOW are outside LATAM:
// anything not listed here is "unknown" and makes the job pass. All entries are normalized
// (lowercase, no accents, no dots), see `normalizeText`.

/** Lowercase, strips accents and dots ("D.C." -> "dc", "São Paulo" -> "sao paulo"), unifies dashes and spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const list = (text: string): string[] =>
  text
    .split(",")
    .map((item) => normalizeText(item))
    .filter((item) => item !== "");

/** Countries outside LATAM (plus the usual aliases). */
export const NON_LATAM_COUNTRIES: ReadonlySet<string> = new Set(
  list(
    `united states, united states of america, usa, us, united kingdom, uk, great britain, england, scotland, wales,
    northern ireland, ireland, canada, australia, new zealand, india, china, japan, korea, south korea, taiwan,
    singapore, hong kong, malaysia, indonesia, philippines, thailand, vietnam, pakistan, bangladesh, sri lanka,
    nepal, uae, united arab emirates, saudi arabia, qatar, kuwait, bahrain, oman, israel, jordan, lebanon, egypt,
    turkey, turkiye, germany, france, spain, portugal, italy, netherlands, belgium, luxembourg, switzerland,
    austria, sweden, norway, denmark, finland, iceland, poland, czechia, czech republic, slovakia, hungary,
    romania, bulgaria, croatia, slovenia, serbia, bosnia and herzegovina, greece, cyprus, malta, estonia, latvia,
    lithuania, ukraine, georgia, armenia, kazakhstan, morocco, tunisia, algeria, nigeria, kenya, ghana, south africa,
    ethiopia, uganda, tanzania, senegal`,
  ),
);

/** Broad regions that are clearly not LATAM. "north america", "americas" and "global" are deliberately absent. */
export const NON_LATAM_REGIONS: ReadonlySet<string> = new Set(
  list(`emea, apac, asia pacific, europe, asia, middle east, dach, nordics, benelux, eu, anz`),
);

/** Cities that exist only outside LATAM (ambiguous names such as Santiago, San Jose or Valencia are left out on purpose). */
export const NON_LATAM_CITIES: ReadonlySet<string> = new Set(
  list(
    `new york, new york city, nyc, brooklyn, san francisco, san francisco bay area, bay area, palo alto, mountain view,
    san mateo, sunnyvale, oakland, los angeles, san diego, seattle, portland, denver, boulder, austin,
    dallas, houston, plano, chicago, boston, cambridge, atlanta, miami, orlando, tampa, raleigh, charlotte,
    philadelphia, pittsburgh, washington, minneapolis, detroit, columbus, cleveland, nashville, salt lake city,
    lehi, omaha, phoenix, las vegas, kansas city, st louis, baltimore, toronto, vancouver, montreal, ottawa,
    calgary, waterloo, london, manchester, edinburgh, glasgow, bristol, leeds, maidstone, dublin, cork, paris,
    lyon, berlin, munich, hamburg, frankfurt, cologne, dusseldorf, stuttgart, amsterdam, rotterdam, apeldoorn,
    utrecht, eindhoven, brussels, antwerp, madrid, barcelona, bcn, lisbon, porto, rome, milan, turin,
    zurich, geneva, basel, vienna, stockholm, gothenburg, oslo, copenhagen, helsinki, warsaw, krakow, wroclaw,
    gdansk, prague, budapest, bucharest, cluj, sofia, belgrade, zagreb, athens, istanbul, ankara, tel aviv,
    dubai, abu dhabi, riyadh, doha, cairo, lagos, nairobi, cape town, johannesburg, mumbai, bengaluru, bangalore,
    hyderabad, pune, chennai, delhi, new delhi, gurgaon, gurugram, noida, kolkata, ahmedabad, tokyo, osaka,
    kyoto, seoul, beijing, shanghai, shenzhen, guangzhou, hangzhou, taipei, hong kong, singapore, kuala lumpur,
    jakarta, bangkok, manila, quezon city, metro manila, ho chi minh city, hanoi, sydney, melbourne, brisbane,
    perth, auckland`,
  ),
);

/** US states and Canadian provinces by full name. */
export const NON_LATAM_SUBDIVISIONS: ReadonlySet<string> = new Set(
  list(
    `alabama, alaska, arizona, arkansas, california, colorado, connecticut, delaware, florida, hawaii, idaho,
    illinois, indiana, iowa, kansas, kentucky, louisiana, maine, maryland, massachusetts, michigan, minnesota,
    mississippi, missouri, montana, nebraska, nevada, new hampshire, new jersey, new mexico, north carolina,
    north dakota, ohio, oklahoma, oregon, pennsylvania, rhode island, south carolina, south dakota, tennessee,
    texas, utah, vermont, virginia, west virginia, wisconsin, wyoming, district of columbia, ontario, quebec,
    british columbia, alberta, manitoba, saskatchewan, nova scotia, new brunswick, maharashtra, karnataka,
    telangana, tamil nadu, haryana, uttar pradesh, bavaria, catalonia`,
  ),
);

/** Neutral words that appear around places ("Office Based - London") and say nothing about remote work. */
export const LOCATION_FILLER: ReadonlySet<string> = new Set(
  list(`office based, office, headquarters, hq, greater, area, metropolitan area, metro area`),
);

/** ISO alpha-2 codes of LATAM countries (ADR 0004). A two-letter code that matches one is never read as a US state. */
export const LATAM_ISO2: ReadonlySet<string> = new Set(
  "ar bo br bz cl co cr cu do ec gt gy hn ht mx ni pa pe py sr sv uy ve".split(" "),
);

/**
 * LATAM names. Only used to BLOCK a discard (title or location mentions the region): over-including is safe,
 * under-including is not.
 */
export const LATAM_TERMS: readonly string[] = list(
  `argentina, bolivia, brasil, brazil, belize, chile, colombia, costa rica, cuba, dominican republic,
  republica dominicana, ecuador, el salvador, salvador, guatemala, guyana, honduras, haiti, mexico, nicaragua,
  panama, paraguay, peru, suriname, uruguay, venezuela, puerto rico, bogota, medellin, cali, barranquilla,
  cartagena, cdmx, ciudad de mexico, guadalajara, monterrey, queretaro, tijuana, puebla, sao paulo,
  rio de janeiro, brasilia, curitiba, porto alegre, belo horizonte, recife, fortaleza, campinas, buenos aires,
  cordoba, santiago, lima, quito, guayaquil, montevideo, caracas, san jose, san salvador, tegucigalpa, asuncion,
  la paz, santo domingo, managua, guatemala city, ciudad de guatemala, caribbean, central america, south america,
  centroamerica, sudamerica, latinoamerica, latam, latin america, americas, amer`,
);
