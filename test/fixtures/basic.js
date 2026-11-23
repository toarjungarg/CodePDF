#!/usr/bin/env node
// A small recipe scaler. This comment has a "quote" and a /slash/ that are not code.
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/* Block comment
   across lines with a `backtick` */
const SERVINGS = 4;
const flour = 2.5e0, milk = .75, eggs = 0x2, big = 1_000_000n;

class Recipe {
  #steps = [];
  static count = 0;

  constructor(name) {
    this.name = name;
    Recipe.count++;
  }

  get total() {
    return this.#steps.length;
  }

  scale(amount, servings) {
    const ratio = amount / SERVINGS / 2;
    return (amount * servings) / ratio;
  }
}

const card = new Recipe('Pancakes');
const pattern = /\d+ cups?[/a-z]*/gi;
const parts = "flour,milk".split(/,/);
const amounts = `${card.scale(flour, 2).toFixed(1)} cups`;
const label = `Serves ${SERVINGS} with ${amounts} and ${`${eggs} eggs`}`;
const lookup = new Map([["flour", { unit: "cup" }]]);
const note = `${lookup.get("flour").unit}s
on a new line`;

async function load(file) {
  const text = await readFile(path.join(".", file), "utf8");
  return text.match(pattern) ?? [];
}

if (typeof card.name === "string" && !card.total) {
  console.log(label, note, parts, big, milk, Math.max(1, 2));
}

export default card;
