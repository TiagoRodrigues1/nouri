// Portuguese food words and the English words Ciqual uses for them, curated by hand.
// Search translates the query with this; result names stay as Ciqual published them.
// Keys are lower case without accents, with hyphens as spaces. Each value is one reading,
// and every word in it must appear in a matching food's name.
// At least one English reading per term; matching and ranking use all readings.
type Readings = [string, ...string[]];

export const portugueseTerms = {
  // Fruit
  "maca": ["apple"],
  "pera": ["pear"],
  "laranja": ["orange"],
  "limao": ["lemon"],
  "lima": ["lime"],
  "tangerina": ["mandarin", "clementine"],
  "clementina": ["clementine"],
  "uva": ["grape"],
  "passas": ["raisin"],
  "uva passa": ["raisin"],
  "morango": ["strawberry"],
  "framboesa": ["raspberry"],
  "amora": ["blackberry"],
  "mirtilo": ["blueberry"],
  "groselha": ["currant"],
  "cereja": ["cherry"],
  "pessego": ["peach"],
  "nectarina": ["nectarine"],
  "damasco": ["apricot"],
  "alperce": ["apricot"],
  "ameixa": ["plum"],
  "ameixa seca": ["prune"],
  "figo": ["fig"],
  "melao": ["melon"],
  "melancia": ["watermelon"],
  "ananas": ["pineapple"],
  "abacaxi": ["pineapple"],
  "manga": ["mango"],
  "papaia": ["papaya"],
  "abacate": ["avocado"],
  "maracuja": ["passion fruit"],
  "goiaba": ["guava"],
  "roma": ["pomegranate"],
  "romazeira": ["pomegranate"],
  "diospiro": ["persimmon"],
  "marmelo": ["quince"],
  "marmelada": ["quince"],
  "coco": ["coconut"],
  "tamara": ["date"],
  "castanha": ["chestnut"],
  "fruta": ["fruit"],
  "fruta cristalizada": ["candied fruit"],
  "compota": ["compote", "jam"],
  "doce de fruta": ["jam"],

  // Vegetables
  "legumes": ["vegetable"],
  "vegetais": ["vegetable"],
  "batata": ["potato"],
  "batata doce": ["sweet potato"],
  "batata frita": ["fries", "crisps"],
  "pure": ["mashed", "puree"],
  "tomate": ["tomato"],
  "cebola": ["onion"],
  "chalota": ["shallot"],
  "alho": ["garlic"],
  "alho frances": ["leek"],
  "cenoura": ["carrot"],
  "couve": ["cabbage", "kale"],
  "couve flor": ["cauliflower"],
  "couve galega": ["kale"],
  "couve roxa": ["red cabbage"],
  "couve de bruxelas": ["brussels"],
  "brocolos": ["broccoli"],
  "brocolo": ["broccoli"],
  "grelos": ["turnip"],
  "nabo": ["turnip"],
  "nabica": ["turnip"],
  "espinafre": ["spinach"],
  "alface": ["lettuce"],
  "agriao": ["watercress"],
  "rucula": ["rocket"],
  "pepino": ["cucumber"],
  "pimento": ["sweet pepper"],
  "malagueta": ["chili"],
  "piri piri": ["chili"],
  "beringela": ["eggplant"],
  "curgete": ["courgette", "zucchini"],
  "abobora": ["pumpkin", "squash"],
  "abobrinha": ["zucchini", "courgette"],
  "cogumelo": ["mushroom"],
  "beterraba": ["beetroot"],
  "aipo": ["celery"],
  "funcho": ["fennel"],
  "espargo": ["asparagus"],
  "alcachofra": ["artichoke"],
  "rabanete": ["radish"],
  "milho": ["corn", "maize"],
  "milho doce": ["sweet corn"],
  "ervilha": ["peas"],
  "feijao": ["bean"],
  "feijao verde": ["green bean"],
  "feijao encarnado": ["red kidney bean"],
  "grao": ["chick pea"],
  "grao de bico": ["chick pea"],
  "lentilha": ["lentil"],
  "fava": ["broad bean"],
  "soja": ["soy", "soya"],
  "azeitona": ["olive"],
  "salada": ["salad"],
  "sopa": ["soup"],
  "caldo": ["broth", "soup"],
  "mandioca": ["cassava", "manioc"],
  "inhame": ["yam", "taro"],
  "algas": ["seaweed"],

  // Herbs and seasoning
  "salsa": ["parsley"],
  "coentros": ["coriander"],
  "manjericao": ["basil"],
  "oregaos": ["oregano"],
  "hortela": ["mint"],
  "alecrim": ["rosemary"],
  "tomilho": ["thyme"],
  "louro": ["bay"],
  "canela": ["cinnamon"],
  "gengibre": ["ginger"],
  "cominhos": ["cumin"],
  "caril": ["curry"],
  "sal": ["salt"],
  "pimenta": ["black pepper", "pepper"],
  "mostarda": ["mustard"],
  "vinagre": ["vinegar"],
  "maionese": ["mayonnaise"],
  "molho": ["sauce"],
  "molho de tomate": ["tomato sauce"],

  // Meat
  "carne": ["meat"],
  "frango": ["chicken"],
  "galinha": ["chicken", "hen"],
  "peru": ["turkey"],
  "pato": ["duck"],
  "ganso": ["goose"],
  "codorniz": ["quail"],
  "coelho": ["rabbit"],
  "vaca": ["beef"],
  "novilho": ["beef"],
  "bovino": ["beef"],
  "vitela": ["veal"],
  "porco": ["pork"],
  "suino": ["pork"],
  "borrego": ["lamb"],
  "cordeiro": ["lamb"],
  "cabrito": ["kid"],
  "carneiro": ["mutton"],
  "javali": ["boar"],
  "veado": ["venison"],
  "peito": ["breast"],
  "peito de peru": ["turkey escalope"],
  "coxa": ["leg", "drumstick"],
  "perna": ["leg"],
  "asa": ["wing"],
  "lombo": ["loin"],
  "costeleta": ["chop", "cutlet"],
  "entrecosto": ["spare ribs"],
  "bife": ["steak"],
  "picada": ["minced"],
  "carne picada": ["minced"],
  "figado": ["liver"],
  "rim": ["kidney"],
  "lingua": ["tongue"],
  "dobrada": ["tripe"],
  "tripas": ["tripe"],
  "toucinho": ["bacon", "lard"],
  "presunto": ["cured ham"],
  "fiambre": ["cooked ham", "ham"],
  "chourico": ["chorizo", "sausage"],
  "salsicha": ["sausage"],
  "linguica": ["sausage"],
  "alheira": ["sausage"],
  "farinheira": ["sausage"],
  "morcela": ["black pudding", "blood sausage"],
  "hamburguer": ["burger"],
  "almondegas": ["balls"],

  // Fish and seafood
  "peixe": ["fish"],
  "bacalhau": ["cod"],
  "pescada": ["hake"],
  "sardinha": ["sardine", "pilchard"],
  "carapau": ["mackerel"],
  "cavala": ["mackerel"],
  "salmao": ["salmon"],
  "atum": ["tuna"],
  "dourada": ["seabream", "gilthead"],
  "robalo": ["bass"],
  "linguado": ["sole"],
  "truta": ["trout"],
  "espadarte": ["swordfish"],
  "tamboril": ["anglerfish"],
  "safio": ["eel"],
  "enguia": ["eel"],
  "raia": ["ray"],
  "solha": ["plaice"],
  "pregado": ["turbot"],
  "arenque": ["herring"],
  "anchova": ["anchovy"],
  "biqueirao": ["anchovy"],
  "carpa": ["carp"],
  "marisco": ["seafood"],
  "camarao": ["shrimp", "prawn"],
  "gamba": ["prawn"],
  "lagosta": ["lobster"],
  "lagostim": ["crayfish"],
  "caranguejo": ["crab"],
  "sapateira": ["crab"],
  "ameijoa": ["clam"],
  "mexilhao": ["mussel"],
  "ostra": ["oyster"],
  "vieira": ["scallop"],
  "lula": ["squid"],
  "choco": ["cuttlefish", "squid"],
  "polvo": ["octopus"],
  "caracois": ["snail"],
  "ovas": ["roe"],
  "delicias do mar": ["surimi"],

  // Eggs and dairy
  "ovo": ["egg"],
  "gema": ["yolk"],
  "clara": ["egg white"],
  "omelete": ["omelette"],
  "leite": ["milk"],
  "leite magro": ["milk skimmed"],
  "leite meio gordo": ["milk semi skimmed"],
  "leite gordo": ["milk whole"],
  "leite condensado": ["condensed milk"],
  "natas": ["cream"],
  "nata": ["cream"],
  "queijo": ["cheese"],
  "queijo fresco": ["fresh cheese"],
  "requeijao": ["ricotta", "cottage cheese"],
  "queijo de cabra": ["cheese goat"],
  "queijo de ovelha": ["cheese ewe"],
  "iogurte": ["yogurt", "yoghurt"],
  "iogurte grego": ["greek yogurt"],
  "manteiga": ["butter"],
  "margarina": ["margarine"],
  "gelado": ["ice cream"],
  "pudim": ["custard", "pudding"],
  "leite creme": ["custard"],
  "soro de leite": ["whey"],

  // Grains, bread and pastry
  "pao": ["bread"],
  "pao integral": ["wholemeal bread"],
  "pao de forma": ["sliced bread", "sandwich loaf"],
  "pao de centeio": ["rye bread"],
  "broa": ["corn bread", "maize bread"],
  "tosta": ["toast", "rusk"],
  "torrada": ["toast"],
  "arroz": ["rice"],
  "arroz integral": ["rice wholegrain"],
  "arroz doce": ["rice pudding"],
  "massa": ["pasta"],
  "esparguete": ["spaghetti"],
  "macarrao": ["pasta"],
  "lasanha": ["lasagna"],
  "aveia": ["oat"],
  "flocos de aveia": ["oat flakes"],
  "farinha": ["flour"],
  "trigo": ["wheat"],
  "centeio": ["rye"],
  "cevada": ["barley"],
  "cuscuz": ["couscous"],
  "cereais": ["cereal"],
  "bolacha": ["biscuit", "cracker", "cookie"],
  "biscoito": ["biscuit", "cookie"],
  "bolo": ["cake"],
  "pao de lo": ["sponge cake"],
  "panqueca": ["pancake"],
  "tarte": ["tart", "pie"],
  "empada": ["pie"],
  "sanduiche": ["sandwich"],
  "sande": ["sandwich"],

  // Nuts and seeds
  "amendoa": ["almond"],
  "noz": ["walnut"],
  "nozes": ["walnut"],
  "avela": ["hazelnut"],
  "caju": ["cashew"],
  "amendoim": ["peanut"],
  "manteiga de amendoim": ["peanut butter"],
  "pistacho": ["pistachio"],
  "pinhao": ["pine nut"],
  "sementes": ["seed"],
  "sementes de girassol": ["sunflower seed"],
  "sementes de abobora": ["pumpkin seed"],
  "linhaca": ["flaxseed", "linseed"],
  "sesamo": ["sesame"],
  "frutos secos": ["nut"],

  // Cooking, state and colour
  "cru": ["raw"],
  "cozido": ["cooked", "boiled"],
  "assado": ["roasted", "baked"],
  "no forno": ["baked", "roasted"],
  "grelhado": ["grilled"],
  "frito": ["fried"],
  "estufado": ["stewed", "braised"],
  "guisado": ["stewed"],
  "a vapor": ["steamed"],
  "fumado": ["smoked"],
  "congelado": ["frozen"],
  "enlatado": ["canned"],
  "em lata": ["canned"],
  "conserva": ["canned"],
  "seco": ["dried", "dry"],
  "fresco": ["fresh"],
  "integral": ["wholemeal", "wholegrain", "whole"],
  "magro": ["lean", "low fat"],
  "salgado": ["salted"],
  "natural": ["plain"],
  "picante": ["spicy"],
  "verde": ["green"],
  "vermelho": ["red"],
  "tinto": ["red"],
  "branco": ["white"],
  "preto": ["black"],
  "amarelo": ["yellow"],
  "sem": ["without", "free"],

  // Sweets, fats and drinks
  "acucar": ["sugar"],
  "mel": ["honey"],
  "cacau": ["cocoa"],
  "doce": ["jam", "sweet"],
  "rebucado": ["candy"],
  "gomas": ["gum", "jelly"],
  "azeite": ["olive oil"],
  "oleo": ["oil"],
  "banha": ["lard"],
  "agua": ["water"],
  "sumo": ["juice"],
  "cafe": ["coffee"],
  "cha": ["tea"],
  "cerveja": ["beer"],
  "vinho": ["wine"],
  "vinho tinto": ["wine red"],
  "vinho branco": ["wine white"],
  "refrigerante": ["soft drink", "carbonated beverage"],
  "bebida": ["drink", "beverage"],
  "batido": ["milkshake", "smoothie"],
} satisfies Record<string, Readings>;

// Words a Portuguese query puts between food words ("peito de frango"). Reading skips them.
const connectives = new Set(["a", "o", "as", "os", "ao", "e", "de", "do", "da", "dos", "das", "com", "em", "no", "na"]);

const terms: Map<string, Readings> = new Map(Object.entries(portugueseTerms));

const longestTerm = Math.max(...[...terms.keys()].map((term) => term.split(" ").length));

// A stretch of a query: a word to match as typed, or a Portuguese term with the English readings it stands for.
export type QueryPhrase = { kind: "word"; typed: string } | { kind: "term"; typed: string[]; english: Readings };

// These forms cannot be derived by stripping a plural suffix or changing feminine a to o.
const irregularForms = new Map([["crua", "cru"], ["flores", "flor"]]);

function wordForms(word: string): string[] {
  const singular = word.replace(/(oes|aes|aos)$/, "ao").replace(/s$/, "");

  return [...new Set([word, singular, irregularForms.get(word), irregularForms.get(singular), singular.replace(/a$/, "o")])]
    .filter((form): form is string => form !== undefined);
}

// Try each word's forms independently: changing an adjective must not also change its noun.
function lookup(words: string[]): Readings | undefined {
  let phrases = [""];

  for (const word of words) {
    phrases = phrases.flatMap((prefix) => wordForms(word).map((form) => prefix ? `${prefix} ${form}` : form));
  }

  for (const phrase of phrases) {
    const english = terms.get(phrase);

    if (english) return english;
  }

  return undefined;
}

// Only individual glossary words participate in typo recovery, never fragments of a phrase.
export function nearbyPortugueseReadings(word: string, nearlyMatches: (word: string, term: string) => boolean): string[] {
  return [...terms].filter(([term]) => !term.includes(" ") && nearlyMatches(word, term)).flatMap(([, english]) => english);
}

// Reads normalized query words as Portuguese terms where it can, so "peito de frango" reads as breast and chicken.
// The longest phrase wins, so "couve flor" is cauliflower rather than cabbage and flor.
export function readQuery(words: string[]): QueryPhrase[] {
  const phrases: QueryPhrase[] = [];

  for (let start = 0; start < words.length;) {
    let size = Math.min(longestTerm, words.length - start);

    while (size > 1 && !lookup(words.slice(start, start + size))) size--;

    const typed = words.slice(start, start + size);
    const english = lookup(typed);

    if (english) phrases.push({ kind: "term", typed, english });
    else phrases.push({ kind: "word", typed: typed.join(" ") });

    start += size;
  }

  // A literal English or French query keeps every word, especially English "no".
  return phrases.some((phrase) => phrase.kind === "term")
    ? phrases.filter((phrase) => phrase.kind === "term" || !connectives.has(phrase.typed))
    : phrases;
}
