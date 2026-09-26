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
    value = row["teneur"].replace(",", ".")
    try:
        amount = float(value)
    except ValueError:
        continue
    if amount >= 0:
        food["nutrientsPer100"][nutrient] = amount

OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps({"version": "2025", "foods": list(foods.values())}, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Wrote {len(foods)} foods to {OUTPUT}")
