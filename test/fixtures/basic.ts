// A typed recipe scaler. This comment says interface and "string" but is not code.
import type { Unit } from "./units";
import { readFile } from "node:fs/promises";

/* Block comment
   across lines */
export interface Ingredient {
  readonly name: string;
  amount: number;
  unit?: Unit;
}

type Pair<T> = [T, T];
enum Meal { Breakfast, Lunch = 2, Dinner }

declare const VERSION: string;

export abstract class Recipe<T extends object> implements Iterable<Ingredient> {
  private items: Ingredient[] = [];
  protected static count = 0;

  constructor(public readonly title: string, private extra?: Partial<T>) {}

  abstract serves(): number;

  scale(ratio: number): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of this.items) {
      result[item.name] = item.amount * ratio / 2;
    }
    return result;
  }

  *[Symbol.iterator](): Iterator<Ingredient> {
    yield* this.items;
  }
}

function isIngredient(value: unknown): value is Ingredient {
  return typeof (value as Ingredient).name === "string";
}

const type = "pancake";
const settings = { readonly: true, type, meal: Meal.Breakfast satisfies Meal };
const first = document.querySelector("#title")!.textContent;
const half = settings.meal! / 2;
const pair: Pair<boolean> = [true, false];

async function load(file: string): Promise<Ingredient[]> {
  const text = await readFile(file, "utf8");
  return JSON.parse(text) as Ingredient[];
}

export { load, isIngredient, pair, half, first, VERSION };
