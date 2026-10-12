import json
import urllib.request
from pathlib import Path


COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5"
SOURCE = f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/{COMMIT}/dist/exercises.json"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "free-exercise-db.json"

# Workouts record sets × reps × weight, so stretches and timed cardio are left out.
CATEGORIES = {"strength", "powerlifting", "olympic weightlifting", "strongman", "plyometrics"}
EQUIPMENT = {
    "barbell": "barbell",
    "dumbbell": "dumbbell",
    "machine": "machine",
    "cable": "cable",
    "kettlebells": "kettlebell",
    "bands": "band",
    "body only": "bodyweight",
    "e-z curl bar": "ez-bar",
    "medicine ball": "medicine-ball",
    "exercise ball": "exercise-ball",
    "foam roll": "foam-roll",
    "other": "other",
}

with urllib.request.urlopen(SOURCE) as response:
    source = json.load(response)

exercises = [
    {
        "id": exercise["id"],
        "name": exercise["name"].strip(),
        "primaryMuscles": exercise["primaryMuscles"],
        "secondaryMuscles": [muscle for muscle in exercise["secondaryMuscles"] if muscle not in exercise["primaryMuscles"]],
        "equipment": EQUIPMENT[exercise["equipment"]] if exercise["equipment"] else None,
    }
    for exercise in source
    if exercise["category"] in CATEGORIES and exercise["primaryMuscles"]
]
exercises.sort(key=lambda exercise: exercise["name"].lower())

OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps({"commit": COMMIT, "exercises": exercises}, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Wrote {len(exercises)} exercises to {OUTPUT}")
