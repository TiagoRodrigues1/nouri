import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


FILES = {"foods": 666252, "values": 666249}
NUTRIENTS = {"328": "kcal", "25000": "proteinG", "31000": "carbsG", "40000": "fatG"}
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "ciqual-2025.json"


def rows(file_id, tag):
    with urllib.request.urlopen(f"https://entrepot.recherche.data.gouv.fr/api/access/datafile/{file_id}") as response:
        for _, element in ET.iterparse(response, events=("end",)):
            if element.tag == tag:
                yield {child.tag: (child.text or "").strip() for child in element}
                element.clear()


def content(value):
    """A Ciqual content per 100 g. "traces" is 0 and "< 0,5" is half its limit, the usual estimate for a value
    below what the lab can measure, so a banana's fat counts as known. "-" means not measured and stays None."""
    value = value.replace(",", ".").strip()
    if value == "traces":
        return 0.0
    if value.startswith("<"):
        limit = number(value[1:])
        return None if limit is None else round(limit / 2, 3)
    return number(value)


def number(value):
    try:
        return float(value)
    except ValueError:
        return None


foods = {}
for row in rows(FILES["foods"], "ALIM"):
    foods[row["alim_code"]] = {
        "id": row["alim_code"],
        "nameFr": row["alim_nom_fr"],
        "nameEn": row["alim_nom_eng"],
        "nutrientsPer100": {name: None for name in NUTRIENTS.values()},
    }

for row in rows(FILES["values"], "COMPO"):
    nutrient = NUTRIENTS.get(row["const_code"])
    food = foods.get(row["alim_code"])
    if nutrient is None or food is None:
        continue
    amount = content(row["teneur"])
    if amount is not None and amount >= 0:
        food["nutrientsPer100"][nutrient] = amount

OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps({"version": "2025", "foods": list(foods.values())}, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Wrote {len(foods)} foods to {OUTPUT}")
